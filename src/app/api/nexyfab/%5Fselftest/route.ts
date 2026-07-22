/**
 * GET /api/nexyfab/_selftest — token-gated OPS PROBE (on-disk folder `%5Fselftest`
 * so Next.js routes it under the underscore URL segment; the leading-underscore
 * private-folder convention would otherwise make it non-routable).
 *
 * WHY A ROUTE (honest constraint): the gmsh mesher, the FEA precise path, the
 * reconstruction fleet AND the forward generation path (OpenSCAD render + LLM)
 * all need binaries/keys that exist ONLY in the deployed container. This route is
 * the only way to run them THERE and read back real numbers:
 *   (A) `?what=fea`      — the gmsh certification-grade FEA A5 result (real Kt/err,
 *                          and whether gmsh actually ran vs the octree fallback).
 *   (B) `?what=fleet`    — the AI RECONSTRUCTION fleet pass-rate on a TINY sample
 *                          (n<=5 — a sample, NOT a statistical rate).
 *   (C) `?what=generate` — the AI GENERATION ("말로 설계") pass-rate on a TINY
 *                          sample. THE ACTUAL PRODUCT: prompt -> LLM agentic build
 *                          (runScadAgent, wrapped in runRepairLoop) -> OpenSCAD
 *                          render -> measured geometry, judged against what the
 *                          PROMPT asked for (not the AI's own parsed intent).
 *
 * AUTH: the token IS the auth. `?token=` (or `x-selftest-token`) must equal
 * `process.env.SELFTEST_TOKEN`. If the env var is unset OR the token mismatches we
 * return 404 — the endpoint is invisible unless someone holds the secret. No
 * plan/session auth: this is an internal ops probe, not a user feature.
 *
 * SAFETY: best-effort try/catch throughout; `what=fea` is bounded and always
 * returns; `what=fleet` and `what=generate` respect a hard overall time budget and
 * return PARTIAL results with `timedOut:true` rather than hanging. The route is
 * fully inert (404 on every request) unless SELFTEST_TOKEN is set.
 */
import { NextRequest, NextResponse } from 'next/server';
import { feaFromStlAsync } from '@/app/[lang]/shape-generator/analysis/feaPackage';
import { renderFixtureStl, PLATE_HOLE_A5, type FixtureName } from './fixtures';
import {
  GEN_FIXTURES,
  builtSignatureFromSession,
  compareGenSignature,
  type GenFailReason,
} from './genFixtures';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A single precise FEA can take ~25-60s; a fleet or generation run minutes. Headroom.
export const maxDuration = 300;

// ─── bounds (so the probe can never become an unbounded DoS surface) ──────────
const FLEET_DEFAULT_N = 3;
const FLEET_MAX_N = 5;
const FLEET_DEFAULT_ATTEMPTS = 2;
const FLEET_MAX_ATTEMPTS = 3;
const FLEET_DEFAULT_BUDGET_MS = 240_000; // 4 min overall hard cap
const FLEET_MAX_BUDGET_MS = 480_000;
const FLEET_PER_PART_MAX_MS = 150_000;
/** Fleet fixtures in run order — sliced to n. */
const FLEET_PARTS: FixtureName[] = ['box', 'cylinder', 'plateHole', 'lBracket'];

// ─── GENERATION bounds — each prompt is an LLM + render call, so cap hard. ────
const GEN_DEFAULT_N = 8;
const GEN_MAX_N = GEN_FIXTURES.length; // never run more prompts than exist
// Default 1 attempt = FIRST-PASS generation (a floor). The production route runs
// up to 2-3 repair attempts; allow up to 2 here so cost stays bounded but the
// caller can measure whether the repair loop lifts the rate.
const GEN_DEFAULT_ATTEMPTS = 1;
const GEN_MAX_ATTEMPTS = 2;
const GEN_DEFAULT_BUDGET_MS = 240_000; // 4 min overall hard cap
const GEN_MAX_BUDGET_MS = 480_000;
const GEN_PER_PROMPT_MAX_MS = 90_000;
// Tight per-attempt budget slice (mirrors the route's free-tier caps) so a single
// prompt can't burn the whole overall budget on one runaway agent loop.
const GEN_TOKENS_CAP = 30_000;
const GEN_TURNS_CAP = 6;
const GEN_TOOL_CALLS_CAP = 12;

/** Constant-time-ish string compare (token check shouldn't leak length via ===). */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function clampInt(raw: string | null, def: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 300);

// ─── (A) FEA A5 — production precise path (gmsh-when-present) ──────────────────
async function handleFea(): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  // Render the A5 plate-with-hole via the production OpenSCAD path (container binary).
  const stl = await renderFixtureStl('plateHole');
  const nominal = PLATE_HOLE_A5.nominalMPa();
  // Run the PRODUCTION precise path: it PREFERS an out-of-process gmsh
  // boundary-conforming mesh (certification-candidate) and falls back to the
  // in-repo octree-snap engineering mesh only when gmsh is absent/unusable.
  const out = await feaFromStlAsync({
    stl,
    materialKey: 'steel',
    loadN: PLATE_HOLE_A5.totalLoadN,
    precise: true,
    loadNote: 'self-test A5 Kirsch plate-with-hole (uniaxial tension across the net section)',
  });
  const r = out.result;
  const kt = nominal > 0 ? r.maxStress / nominal : NaN;
  const meshMode = out.raiser?.meshMode ?? 'screening';
  const gmshUsed = meshMode === 'gmsh-conforming';
  return {
    what: 'fea',
    meshMode,
    grade: out.raiser?.grade ?? 'screening',
    gmshUsed,
    kt: Number.isFinite(kt) ? +kt.toFixed(4) : null,
    ktRefKirsch: 3.0,
    errPctVsKirsch: Number.isFinite(kt) ? +(Math.abs(kt - 3.0) / 3.0 * 100).toFixed(2) : null,
    dofCount: out.raiser?.dofCount ?? r.dofCount,
    wallMs: out.raiser?.wallMs ?? (Date.now() - t0),
    converged: r.converged,
    raiserDetected: out.raiser?.detected ?? false,
    raiserApplied: out.raiser?.applied ?? false,
    maxStressMPa: Number.isFinite(r.maxStress) ? +r.maxStress.toFixed(3) : null,
    nominalMPa: +nominal.toFixed(3),
    method: r.method,
    note: out.raiser?.note ?? 'no curved stress-raiser detected on the plate-with-hole (unexpected)',
    totalWallMs: Date.now() - t0,
  };
}

// ─── (B) reconstruction FLEET — tiny bounded sample ────────────────────────────
async function handleFleet(n: number, attempts: number, budgetMs: number): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const names = FLEET_PARTS.slice(0, n);

  // Lazy-load the heavy fleet wiring so the fea path (and the 404 path) never pay
  // for it. All server adapters/keys resolve inside the container.
  const [
    { reconstructWithFleet },
    { makeTools },
    { SERVER_HOST_ADAPTERS },
    { makeServerAiFamilies, makeVisionCritic },
    { stlToIr },
    { parseStlBufferToGeometry },
    { reverseEngineerFromGeometry },
  ] = await Promise.all([
      import('@/lib/ai/scad-agent/reconstructFleet'),
      import('@/lib/ai/scad-agent/tools'),
      import('@/lib/ai/scad-agent/serverAdapters'),
      import('@/lib/ai/scad-agent/repairLoop'),
      import('@/lib/cad-ir'),
      import('@/lib/ai/scad-agent/renderToGeometry'),
      import('@/lib/ai/scad-agent/reverseEngineer'),
    ]);

  const aiFamilies = await makeServerAiFamilies({ task: 'reconstruct-fleet' });
  if (aiFamilies.length === 0) {
    return {
      what: 'fleet',
      sample: true,
      error: 'no model family configured — set an AI provider key in the container',
      requested: names.length,
      wallMs: Date.now() - t0,
    };
  }
  const tools = makeTools(SERVER_HOST_ADAPTERS);
  const visionCritic = makeVisionCritic(SERVER_HOST_ADAPTERS.vision);

  type PartRow = {
    name: string;
    passed: boolean;
    kt?: number;
    verdict: string;
    attemptsUsed: number;
    seriesSwitched: boolean;
    familiesUsed?: string[];
    // DIAGNOSTIC — pinpoint where a non-pass breaks (see reconstructWithFleet).
    renderOk?: boolean;
    hasGeometry?: boolean;
    gateStatus?: 'pass' | 'fail' | 'unverified-null';
    gateFeedback?: string | null;
    scadPreview?: string;
    // DIAGNOSTIC — the shape that actually drove the emitted geometry (the
    // proposer's own add_feature_intent shapeId), whether the LLM was truly
    // invoked, and the deterministic seed we handed the proposer.
    intentShapeId?: string | null;
    modelCalled?: boolean;
    seedShape?: string | null;
    wallMs: number;
    error?: boolean;
  };
  const parts: PartRow[] = [];
  let timedOut = false;

  for (const name of names) {
    const elapsed = Date.now() - t0;
    if (elapsed >= budgetMs) { timedOut = true; break; }
    const remaining = budgetMs - elapsed;
    const p0 = Date.now();
    try {
      const stl = await renderFixtureStl(name);
      const sourceIr = stlToIr(stl, { path: `${name}.stl`, name: `${name}.stl` });
      // SEED the fleet with the deterministic classifier's top candidate — the
      // SAME hint the production /reverse-engineer route passes. Previously the
      // selftest omitted this, so a seed added to production never reached the
      // measured path (the prompt got no CLASSIFIER SEED block and the proposer
      // kept defaulting to a box on the shape-less STL IR). Best-effort: a
      // classifier miss just yields no seed (unchanged no-hint behavior).
      let heuristicHint;
      let seedShape = null;
      try {
        const geom = await parseStlBufferToGeometry(stl);
        const top = reverseEngineerFromGeometry({ geometry: geom }).candidates[0];
        if (top) {
          seedShape = top.intent.shapeId;
          heuristicHint = {
            shapeId: top.intent.shapeId,
            params: top.intent.params,
            confidence: top.confidence,
            summary: top.summary,
          };
        }
      } catch { /* no seed — falls back to the unchanged no-hint prompt */ }
      // Per-part hard stop = min(remaining overall budget, per-part cap).
      const ac = new AbortController();
      const perPartMs = Math.min(remaining, FLEET_PER_PART_MAX_MS);
      const timer = setTimeout(() => ac.abort(), perPartMs);
      let fleet;
      try {
        fleet = await reconstructWithFleet({
          sourceIr,
          heuristicHint,
          tools,
          aiFamilies,
          visionCritic,
          maxAttempts: attempts,
          signal: ac.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      parts.push({
        name,
        passed: fleet.passed,
        verdict: fleet.passed ? 'verified' : (fleet.verdict?.feedback ?? 'did-not-verify'),
        attemptsUsed: fleet.attemptsUsed,
        seriesSwitched: fleet.seriesSwitched,
        familiesUsed: fleet.familiesUsed,
        // DIAGNOSTIC — reveal the exact break point on a non-pass:
        //   renderOk=false            -> proposer never produced a valid render
        //   renderOk & !hasGeometry   -> rendered but geometry unmeasurable
        //   gateStatus='unverified-null' -> the "did-not-verify" symptom's root
        //   gateStatus='fail'         -> a real, caught wrong answer (with feedback)
        renderOk: fleet.renderOk,
        hasGeometry: fleet.hasGeometry,
        gateStatus: fleet.gateStatus,
        gateFeedback: fleet.gateFeedback,
        scadPreview: fleet.scadPreview,
        intentShapeId: fleet.intentShapeId,
        modelCalled: fleet.modelCalled,
        seedShape,
        wallMs: Date.now() - p0,
      });
    } catch (e) {
      parts.push({
        name,
        passed: false,
        verdict: `error: ${errMsg(e)}`,
        attemptsUsed: 0,
        seriesSwitched: false,
        wallMs: Date.now() - p0,
        error: true,
      });
    }
    // If we've now exhausted the budget and parts remain, flag a partial result.
    if (Date.now() - t0 >= budgetMs && parts.length < names.length) { timedOut = true; break; }
  }

  const ran = parts.length;
  const passedCount = parts.filter((p) => p.passed).length;
  const passRate = ran > 0 ? +(passedCount / ran).toFixed(3) : 0;
  const meanAttempts = ran > 0 ? +(parts.reduce((s, p) => s + p.attemptsUsed, 0) / ran).toFixed(2) : 0;
  return {
    what: 'fleet',
    sample: true,
    disclaimer: 'TINY SAMPLE (n<=5) — this is NOT a statistical pass-rate; it reports exactly what ran.',
    requested: names.length,
    sampleSize: ran,
    passRate,
    meanAttempts,
    timedOut,
    parts,
    wallMs: Date.now() - t0,
  };
}

// ─── (C) GENERATION ("말로 설계") — tiny bounded sample of the ACTUAL product ──
//
// Runs the SAME production path the /api/nexyfab/scad-agent route runs: the
// model-driven `runScadAgent` loop wrapped in `runRepairLoop`, with the SAME
// server tools/adapters/families and the deterministic spec gate. For each prompt
// we take the FINAL built geometry (session.geometry) and judge it against what
// the PROMPT asked for (genFixtures' human-authored expected signature) — NOT
// against the AI's own parsed intent, so a misparse cannot hide as a pass.
async function handleGenerate(n: number, attempts: number, budgetMs: number): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const fixtures = GEN_FIXTURES.slice(0, n);

  // Lazy-load the heavy agent wiring so the fea / 404 paths never pay for it.
  const [
    { makeTools },
    { SERVER_HOST_ADAPTERS },
    { runRepairLoop, makeServerAiFamilies, makeSpecGateEvaluator },
  ] = await Promise.all([
    import('@/lib/ai/scad-agent/tools'),
    import('@/lib/ai/scad-agent/serverAdapters'),
    import('@/lib/ai/scad-agent/repairLoop'),
  ]);

  const aiFamilies = await makeServerAiFamilies({ task: 'scad-agent-selftest' });
  if (aiFamilies.length === 0) {
    return {
      what: 'generate',
      sample: true,
      error: 'no model family configured — set an AI provider key in the container',
      requested: fixtures.length,
      wallMs: Date.now() - t0,
    };
  }
  const tools = makeTools(SERVER_HOST_ADAPTERS);
  const gate = makeSpecGateEvaluator();

  type GenRow = {
    id: string;
    prompt: string;
    difficulty: string;
    expectFail: boolean;
    // AUTHORITATIVE: did the built geometry match the PROMPT?
    pass: boolean;
    built: boolean;
    builtBbox: [number, number, number] | null;
    expectedBbox: Array<number | null>;
    bboxErrPct: number | null;
    holesBuilt: number;
    holesExpected: number | null;
    fillRatio: number | null;
    intentShapeId: string | null;
    failReason: GenFailReason | null;
    // The repair loop's OWN verdict (spec gate vs intent) — for contrast with our
    // prompt-truth pass. When gatePassed=true but pass=false, the AI verified
    // against its OWN misparse: exactly the hidden failure this probe surfaces.
    gatePassed: boolean;
    attemptsUsed: number;
    notes: string;
    wallMs: number;
    error?: boolean;
  };
  const rows: GenRow[] = [];
  let timedOut = false;

  for (const fx of fixtures) {
    const elapsed = Date.now() - t0;
    if (elapsed >= budgetMs) { timedOut = true; break; }
    const remaining = budgetMs - elapsed;
    const p0 = Date.now();
    try {
      const ac = new AbortController();
      const perPromptMs = Math.min(remaining, GEN_PER_PROMPT_MAX_MS);
      const timer = setTimeout(() => ac.abort(), perPromptMs);
      let result;
      try {
        result = await runRepairLoop({
          userPrompt: fx.prompt,
          aiFamilies,
          tools,
          gate,
          // No vision critic here — cost. The geometric judge is authoritative
          // for this probe anyway.
          maxAttempts: attempts,
          tokensCap: GEN_TOKENS_CAP,
          turnsCap: GEN_TURNS_CAP,
          toolCallsCap: GEN_TOOL_CALLS_CAP,
          visionCallsCap: 0,
          signal: ac.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const built = builtSignatureFromSession(result.session);
      const cmp = compareGenSignature(fx, built);
      rows.push({
        id: fx.id,
        prompt: fx.prompt,
        difficulty: fx.difficulty,
        expectFail: fx.expectFail,
        pass: cmp.pass,
        built: cmp.built,
        builtBbox: cmp.builtBbox,
        expectedBbox: cmp.expectedBbox,
        bboxErrPct: cmp.bboxErrPct,
        holesBuilt: cmp.holesBuilt,
        holesExpected: cmp.holesExpected,
        fillRatio: cmp.fillRatio,
        intentShapeId: cmp.intentShapeId,
        failReason: cmp.failReason,
        gatePassed: result.passed,
        attemptsUsed: result.attemptsUsed,
        notes: cmp.notes,
        wallMs: Date.now() - p0,
      });
    } catch (e) {
      rows.push({
        id: fx.id,
        prompt: fx.prompt,
        difficulty: fx.difficulty,
        expectFail: fx.expectFail,
        pass: false,
        built: false,
        builtBbox: null,
        expectedBbox: fx.expected.bboxMm,
        bboxErrPct: null,
        holesBuilt: 0,
        holesExpected: fx.expected.holesExpected ?? null,
        fillRatio: null,
        intentShapeId: null,
        failReason: 'build-fail',
        gatePassed: false,
        attemptsUsed: 0,
        notes: `error: ${errMsg(e)}`,
        wallMs: Date.now() - p0,
        error: true,
      });
    }
    if (Date.now() - t0 >= budgetMs && rows.length < fixtures.length) { timedOut = true; break; }
  }

  const ran = rows.length;
  const passedCount = rows.filter((r) => r.pass).length;
  const passRate = ran > 0 ? +(passedCount / ran).toFixed(3) : 0;

  // Honest split: rate over the prompts we EXPECTED to pass (excludes the
  // deliberately-hard freeform ones), so a hard failure isn't counted as product
  // regression and an easy failure isn't excused.
  const expectPassRows = rows.filter((r) => !r.expectFail);
  const expectPassRan = expectPassRows.length;
  const expectPassPassed = expectPassRows.filter((r) => r.pass).length;
  const expectPassRate = expectPassRan > 0 ? +(expectPassPassed / expectPassRan).toFixed(3) : 0;

  // Where does it break? Tally the failure attribution so the reader knows WHAT
  // to fix (misparse => prompt understanding; dimension-off => param mapping;
  // build-fail => renderer/agent; no-geometry => the agent never rendered).
  const failBreakdown: Record<GenFailReason, number> = {
    misparse: 0, 'build-fail': 0, 'dimension-off': 0, 'no-geometry': 0,
  };
  for (const r of rows) if (!r.pass && r.failReason) failBreakdown[r.failReason] += 1;

  const byDifficulty: Record<string, { ran: number; passed: number }> = {};
  for (const r of rows) {
    const b = (byDifficulty[r.difficulty] ??= { ran: 0, passed: 0 });
    b.ran += 1;
    if (r.pass) b.passed += 1;
  }

  const meanAttempts = ran > 0 ? +(rows.reduce((s, r) => s + r.attemptsUsed, 0) / ran).toFixed(2) : 0;

  return {
    what: 'generate',
    sample: true,
    disclaimer:
      'TINY SAMPLE (n<=' + GEN_MAX_N + ') of the GENERATION ("말로 설계") path — NOT a statistical '
      + 'pass-rate. PASS = the BUILT geometry matches what the PROMPT asked for (bbox/holes/fill '
      + 'measured off the real STL), NOT what the AI parsed. Default attempts=1 measures FIRST-PASS '
      + 'generation (a floor); the production route runs up to 2-3 repair attempts.',
    attemptsMode: attempts === 1 ? 'first-pass (attempts=1)' : `with-repair (attempts=${attempts})`,
    requested: fixtures.length,
    sampleSize: ran,
    passRate,
    expectPassRate,
    expectPassSample: expectPassRan,
    byDifficulty,
    failBreakdown,
    meanAttempts,
    timedOut,
    rows,
    wallMs: Date.now() - t0,
  };
}

// ─── entry point ───────────────────────────────────────────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  // AUTH = token. Unset env OR missing/mismatched token => 404 (endpoint hidden).
  const expected = process.env.SELFTEST_TOKEN?.trim();
  const url = new URL(req.url);
  const token = (url.searchParams.get('token') ?? req.headers.get('x-selftest-token') ?? '').trim();
  if (!expected || !token || !tokensMatch(token, expected)) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const what = (url.searchParams.get('what') ?? 'fea').toLowerCase();
  try {
    if (what === 'fea') {
      return NextResponse.json(await handleFea());
    }
    if (what === 'fleet') {
      const n = clampInt(url.searchParams.get('n'), FLEET_DEFAULT_N, 1, FLEET_MAX_N);
      const attempts = clampInt(url.searchParams.get('attempts'), FLEET_DEFAULT_ATTEMPTS, 1, FLEET_MAX_ATTEMPTS);
      const budgetMs = clampInt(url.searchParams.get('budgetMs'), FLEET_DEFAULT_BUDGET_MS, 10_000, FLEET_MAX_BUDGET_MS);
      return NextResponse.json(await handleFleet(n, attempts, budgetMs));
    }
    if (what === 'generate') {
      const n = clampInt(url.searchParams.get('n'), GEN_DEFAULT_N, 1, GEN_MAX_N);
      const attempts = clampInt(url.searchParams.get('attempts'), GEN_DEFAULT_ATTEMPTS, 1, GEN_MAX_ATTEMPTS);
      const budgetMs = clampInt(url.searchParams.get('budgetMs'), GEN_DEFAULT_BUDGET_MS, 10_000, GEN_MAX_BUDGET_MS);
      return NextResponse.json(await handleGenerate(n, attempts, budgetMs));
    }
    return NextResponse.json({ ok: false, error: `unknown what="${what}" (use fea|fleet|generate)` }, { status: 400 });
  } catch (e) {
    // Never crash the server — best-effort honest error.
    return NextResponse.json({ ok: false, what, error: errMsg(e) }, { status: 500 });
  }
}
