/**
 * POST /api/nexyfab/reverse-engineer
 *
 * Mesh reverse-engineering. Two modes:
 *
 *   - DEFAULT (cheap, no AI): heuristic shape classifier proposes the most
 *     likely IntentInput(s). Pure CPU pipeline — no model call. Covers ~6
 *     primitive classes; the top candidate is rendered + gate-verified against
 *     the SOURCE mesh so the caller sees a measured round-trip.
 *
 *   - AI-FLEET (opt-in, Pro-gated, expensive): body flag `{ mode: 'ai-fleet' }`.
 *     Runs the RECONSTRUCTION FLEET (lever F) for parts the heuristic can't do:
 *     source STL -> IR -> LLM proposes parametric SCAD -> the deterministic
 *     reconstruction gate verifies each proposal against the source -> gate
 *     feedback + series-switch drive the next attempt -> accept ONLY a
 *     gate-verified reconstruction. Honest non-pass on exhaustion — never a
 *     fabricated pass. Because the fleet is expensive (LLM + render per
 *     attempt) it costs against the user's daily AI budget and one monthly slot.
 *
 * Caller flow: POST { stlBase64, mode? } → receive { ok, candidates,
 * observedStats, topScad?, reconstructionGate?, aiFleet? }.
 *
 * Pro+ gated because mesh processing (genus, dihedral, wall sampling) is
 * server-side CPU work; the AI-fleet mode is additionally LLM-metered.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPlan, consumeMonthlyMetricSlot } from '@/lib/plan-guard';
import { checkUserBudget } from '@/lib/ai/userBudget';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { captureServerError } from '@/lib/error-capture';
import { CadAuditAction, logCadPipelineAudit } from '@/lib/enterprise-cad-audit';
import { reverseEngineerWithWallThickness } from '@/lib/ai/scad-agent/reverseEngineer';
import { parseStlBufferToGeometry } from '@/lib/ai/scad-agent/renderToGeometry';
import { intentToScad } from '@/lib/openscad-render/intentToScad';
import { renderScadToStl } from '@/lib/openscad-render/renderStl';
import { stlToIr, gateScadStl } from '@/lib/cad-ir';
import { makeTools } from '@/lib/ai/scad-agent/tools';
import { SERVER_HOST_ADAPTERS } from '@/lib/ai/scad-agent/serverAdapters';
import { makeServerAiFamilies, makeVisionCritic } from '@/lib/ai/scad-agent/repairLoop';
import { reconstructWithFleet } from '@/lib/ai/scad-agent/reconstructFleet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Per (ip,user) hourly cap. Mesh parse is cheaper than vision but still CPU-bound. */
const RATE_LIMIT_PER_HOUR = 30;
/** Decoded STL size cap. 8 MB binary STL ≈ 165k triangles — well above any
 *  realistic hand-scanned part; larger uploads point at malformed input. */
const STL_MAX_BYTES = 8 * 1024 * 1024;
/** AI-fleet attempt cap — the fleet's OWN budget guard on top of the route's
 *  rate-limit / monthly-slot / daily-$ gates. Each attempt is one agent run
 *  (LLM + render), so this bounds the worst-case cost of an opt-in fleet call. */
const FLEET_MAX_ATTEMPTS = 3;

/** Decode either a data URL or bare base64 into a Buffer. Returns null on
 *  parse failure so the caller can return a friendly 400 instead of throwing. */
function decodeStlBase64(input: string): Buffer | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  let payload = input;
  // data:application/octet-stream;base64,XXXX  OR  data:model/stl;base64,XXXX
  const m = /^data:[^;]*;base64,(.*)$/.exec(input);
  if (m) payload = m[1]!;
  try {
    const bytes = Buffer.from(payload, 'base64');
    if (bytes.length === 0) return null;
    return bytes;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // (1) Pro+ gate.
  const planCheck = await checkPlan(req, 'pro');
  if (!planCheck.ok) {
    return NextResponse.json(
      { ok: false, error: 'Reverse engineering requires Pro plan', code: 'PLAN_LOCKED', required: 'pro' },
      { status: 403 },
    );
  }
  const userId = planCheck.userId;
  const plan = planCheck.plan;

  // (2) Rate limit.
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`reverse-engineer:${ip}:${userId}`, RATE_LIMIT_PER_HOUR, 3_600_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Rate limit exceeded — please wait before another upload', code: 'RATE_LIMIT' },
      { status: 429 },
    );
  }

  // (3) Body + decode.
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const stlBase64 = typeof body.stlBase64 === 'string' ? body.stlBase64 : '';
  // Opt-in AI-fleet mode. Default stays the cheap heuristic path.
  const fleetMode = body.mode === 'ai-fleet';
  if (!stlBase64) {
    return NextResponse.json(
      { ok: false, error: 'stlBase64 is required (data URL or raw base64)', code: 'STL_REQUIRED' },
      { status: 400 },
    );
  }
  const decoded = decodeStlBase64(stlBase64);
  if (!decoded) {
    return NextResponse.json(
      { ok: false, error: 'Could not decode stlBase64 (expected data URL or valid base64)', code: 'STL_DECODE_FAILED' },
      { status: 400 },
    );
  }
  if (decoded.length > STL_MAX_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `STL exceeds ${Math.round(STL_MAX_BYTES / 1024 / 1024)} MB (got ${decoded.length} bytes after decoding)`,
        code: 'STL_TOO_LARGE',
      },
      { status: 413 },
    );
  }

  // (3b) AI-fleet is LLM-metered — gate on the shared daily $ budget BEFORE
  // doing any model work. Cheap heuristic mode skips this entirely.
  if (fleetMode) {
    const budget = await checkUserBudget(userId);
    if (!budget.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Daily AI spend limit reached ($${budget.limitUsd}). Try again later.`,
          code: 'COST_BUDGET',
          usedCents: budget.usedCents,
          limitUsd: budget.limitUsd,
          resetAtMs: budget.resetAtMs,
        },
        { status: 429 },
      );
    }
  }

  // (4) Parse STL → geometry. Catch parser errors so a malformed file
  // becomes a clean 422 instead of a 500.
  let geometry;
  try {
    geometry = await parseStlBufferToGeometry(
      new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength),
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `STL parse failed: ${(e as Error).message}`, code: 'STL_PARSE_FAILED' },
      { status: 422 },
    );
  }

  // (5) Run the heuristic classifier — wall-thickness variant so the
  // diagnostics block includes min-wall sampling. Runs in BOTH modes: it is
  // cheap CPU and gives the AI-fleet caller useful context (candidates +
  // observed stats) alongside the verified reconstruction.
  let result;
  try {
    result = await reverseEngineerWithWallThickness({ geometry });
  } catch (e) {
    captureServerError(e instanceof Error ? e : new Error(String(e)), {
      route: '/api/nexyfab/reverse-engineer',
      method: 'POST',
      errorClass: 'classifierThrew',
      userId,
    });
    return NextResponse.json(
      { ok: false, error: `classifier threw: ${(e as Error).message}`, code: 'CLASSIFIER_THREW' },
      { status: 500 },
    );
  }
  if (result.candidates.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: 'mesh produced no candidates — likely empty or unreadable geometry',
        code: 'NO_CANDIDATES',
        observedStats: result.observedStats,
      },
      { status: 422 },
    );
  }

  // (6) Consume monthly slot. Only on success so a failed extraction
  // doesn't burn the user's monthly quota.
  let usage: { used: number; limit: number; remaining: number } | undefined;
  const slot = await consumeMonthlyMetricSlot(userId, plan, 'reverse_engineer');
  if (!slot.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `Monthly reverse-engineer limit reached (${slot.limit}/month).`,
        code: 'MONTHLY_LIMIT',
        limit: slot.limit,
      },
      { status: 429 },
    );
  }
  if (slot.limit > 0) {
    usage = { used: slot.used, limit: slot.limit, remaining: Math.max(0, slot.limit - slot.used) };
  }

  // (7) Render top candidate to SCAD so the caller can immediately verify
  // the round-trip. Failure here doesn't block the response — the user can
  // still see the candidates and apply manually.
  let topScad: string | undefined;
  try {
    const conv = intentToScad(result.candidates[0]!.intent);
    if (conv.ok) topScad = conv.scad;
  } catch { /* non-fatal */ }

  // (7b) VERIFY the reconstruction against the SOURCE mesh — the wedge that a
  // drafting tool can't do: don't just propose a shape, PROVE it matches the
  // original. Render topScad back to STL and gate it (bbox / genus / watertight;
  // units-unknown → aspect-ratio mode) against the uploaded STL's own IR.
  // Honest failure: if OpenSCAD is unavailable or the render/gate fails, report
  // status 'unavailable' with a reason — NEVER fabricate a pass.
  let reconstructionGate:
    | { status: 'pass' | 'fail'; score: number; stage: string; checks: unknown; feedback: string }
    | { status: 'unavailable'; reason: string }
    | undefined;
  if (topScad) {
    try {
      const sourceIr = stlToIr(
        new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength),
        { path: 'upload.stl', name: 'upload.stl' },
      );
      const rendered = await renderScadToStl({ scadSource: topScad, timeoutMs: 20_000 });
      if (!rendered.ok) {
        reconstructionGate = { status: 'unavailable', reason: `render_${rendered.code}` };
      } else {
        const g = gateScadStl(
          new Uint8Array(rendered.bytes.buffer, rendered.bytes.byteOffset, rendered.bytes.byteLength),
          sourceIr,
        );
        reconstructionGate = {
          status: g.passed ? 'pass' : 'fail',
          score: g.score,
          stage: g.stage,
          checks: g.checks,
          feedback: g.feedback,
        };
      }
    } catch (e) {
      reconstructionGate = { status: 'unavailable', reason: `gate_threw_${(e as Error).message.slice(0, 80)}` };
    }
  }

  // (7c) AI-FLEET (lever F) — opt-in, Pro-gated frontier attack for parts the
  // heuristic classifier can't reconstruct. Source STL -> IR, then the fleet
  // proposes parametric SCAD and the deterministic reconstruction gate verifies
  // each proposal against the source; gate feedback + series-switch drive the
  // next attempt. Accept ONLY a gate-verified pass; surface an HONEST non-pass
  // on exhaustion. Failures here never poison the (already computed) heuristic
  // response — they attach an { error } note instead.
  let aiFleet:
    | {
        passed: boolean;
        attemptsUsed: number;
        seriesSwitched: boolean;
        familiesUsed: string[];
        singleFamily: boolean;
        scad: string;
        verified: boolean;
        feedback: string | null;
        note: string;
        referenceCount: number;
      }
    | { error: string }
    | undefined;
  if (fleetMode) {
    try {
      const sourceIr = stlToIr(
        new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength),
        { path: 'upload.stl', name: 'upload.stl' },
      );
      const aiFamilies = await makeServerAiFamilies({ task: 'reconstruct-fleet' });
      if (aiFamilies.length === 0) {
        aiFleet = { error: 'no model family configured — set an AI provider key' };
      } else {
        const fleet = await reconstructWithFleet({
          sourceIr,
          tools: makeTools(SERVER_HOST_ADAPTERS),
          aiFamilies,
          visionCritic: makeVisionCritic(SERVER_HOST_ADAPTERS.vision),
          maxAttempts: FLEET_MAX_ATTEMPTS,
          signal: req.signal,
        });
        aiFleet = {
          passed: fleet.passed,
          attemptsUsed: fleet.attemptsUsed,
          seriesSwitched: fleet.seriesSwitched,
          familiesUsed: fleet.familiesUsed,
          singleFamily: fleet.singleFamily,
          scad: fleet.reconstruction.scad,
          verified: fleet.passed,
          feedback: fleet.verdict?.feedback ?? null,
          note: fleet.note,
          referenceCount: fleet.references.length,
        };
      }
    } catch (e) {
      captureServerError(e instanceof Error ? e : new Error(String(e)), {
        route: '/api/nexyfab/reverse-engineer',
        method: 'POST',
        errorClass: 'fleetThrew',
        userId,
      });
      aiFleet = { error: `ai-fleet failed: ${(e as Error).message.slice(0, 160)}` };
    }
  }

  // (8) Audit — non-blocking. Pro+ only.
  try {
    logCadPipelineAudit({
      userId,
      plan,
      action: CadAuditAction.MESH_REVERSE_ENGINEERED,
      metadata: {
        stlBytes: decoded.length,
        candidateCount: result.candidates.length,
        topShapeId: result.candidates[0]!.intent.shapeId,
        topConfidence: result.candidates[0]!.confidence,
        genus: result.observedStats.genus,
        componentCount: result.observedStats.componentCount,
        mode: fleetMode ? 'ai-fleet' : 'heuristic',
        ...(aiFleet && 'passed' in aiFleet
          ? { fleetPassed: aiFleet.passed, fleetAttempts: aiFleet.attemptsUsed }
          : {}),
      },
      ip,
    });
  } catch { /* never block on audit */ }

  return NextResponse.json({
    ok: true,
    candidates: result.candidates,
    observedStats: result.observedStats,
    ...(topScad ? { topScad } : {}),
    ...(reconstructionGate ? { reconstructionGate } : {}),
    ...(aiFleet ? { aiFleet } : {}),
    ...(usage ? { usage } : {}),
  });
}
