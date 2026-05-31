/**
 * POST /api/nexyfab/reverse-engineer
 *
 * Mesh reverse-engineering: user uploads a scanned STL (e.g. from a 3D scan
 * or an imported part with no source CAD), heuristic shape classifier
 * proposes the most likely IntentInput(s). Pure CPU pipeline — no AI call.
 *
 * Caller flow: POST { stlBase64 } → receive { ok, candidates, observedStats,
 * topScad? }. Push the top candidate into the /verify-spec textarea, or
 * pipe `topScad` straight to /api/nexyfab/openscad-render to round-trip.
 *
 * Pro+ gated because mesh processing (genus, dihedral, wall sampling) is
 * server-side CPU work. Free users see PLAN_LOCKED.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPlan, consumeMonthlyMetricSlot } from '@/lib/plan-guard';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { captureServerError } from '@/lib/error-capture';
import { CadAuditAction, logCadPipelineAudit } from '@/lib/enterprise-cad-audit';
import { reverseEngineerWithWallThickness } from '@/lib/ai/scad-agent/reverseEngineer';
import { parseStlBufferToGeometry } from '@/lib/ai/scad-agent/renderToGeometry';
import { intentToScad } from '@/lib/openscad-render/intentToScad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Per (ip,user) hourly cap. Mesh parse is cheaper than vision but still CPU-bound. */
const RATE_LIMIT_PER_HOUR = 30;
/** Decoded STL size cap. 8 MB binary STL ≈ 165k triangles — well above any
 *  realistic hand-scanned part; larger uploads point at malformed input. */
const STL_MAX_BYTES = 8 * 1024 * 1024;

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
  // diagnostics block includes min-wall sampling.
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
      },
      ip,
    });
  } catch { /* never block on audit */ }

  return NextResponse.json({
    ok: true,
    candidates: result.candidates,
    observedStats: result.observedStats,
    ...(topScad ? { topScad } : {}),
    ...(usage ? { usage } : {}),
  });
}
