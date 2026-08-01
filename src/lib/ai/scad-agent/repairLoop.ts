/**
 * repairLoop.ts — self-correcting REPAIR orchestrator (lever A) with an
 * optional vision critic (lever E).
 *
 * Guiding principle (do not violate): the deterministic gate is the source
 * of truth. The LLM only PROPOSES and REPAIRS. This orchestrator wraps the
 * existing model-driven `runScadAgent` loop and adds three things the base
 * loop does not have:
 *
 *   1. Series-switch on repeated failure — when the gate keeps failing with
 *      the same model family, switch to a DIFFERENT available family for the
 *      next attempt. (The user's own layer-2 pilot measured that family
 *      diversity rescued 13-35% of cases that same-model retries could not.)
 *      With only one family configured this is an HONEST logged no-op, never
 *      a fake switch.
 *
 *   2. Structured gate feedback -> repair prompt — the gate's `feedback`
 *      string (axis-flip, dimension mismatch, missing hole, ...) is fed back
 *      VERBATIM as the next attempt's instruction. The gate is pluggable so
 *      the caller can wire the spec-verification gate (default, reachable
 *      from session state) and/or the cad-ir reconstruction gate.
 *
 *   3. Vision as a second critic — after a build renders, an optional vision
 *      critic answers "does this match: <original request>?". A clear NO is a
 *      SEMANTIC fail that feeds the repair loop. But the GEOMETRIC gate stays
 *      authoritative for pass/fail: vision can never flip a measured pass into
 *      a fail on aesthetics — it can only request another repair attempt while
 *      budget remains.
 *
 * Honesty contract: the result exposes attempts-used, whether the series
 * switch fired, which families ran, and the final gate verdict. If retries
 * are exhausted while still failing, we return the BEST attempt WITH an
 * honest "did not pass" verdict + feedback — never a fabricated pass.
 */

import type { AgentSession, AiClient, AgentEvent, ToolExecutorMap, GeometryStats } from './types';
import { runScadAgent } from './runScadAgent';
import { makeInitialBudget } from './budget';
import { verifyAgainstSpec, formatSpecCritique, type ProcessForDfm } from './specVerification';
import { effectiveScadSource } from './composeSource';
import type { VisionAdapter } from './tools';
import { dimensionSentences, dimensionSummary, type DimSentence } from '@/lib/cad-ir/dimensionReport';

// ─── Gate abstraction ──────────────────────────────────────────────────────

export interface GateVerdict {
  /** Deterministic pass/fail. This is the AUTHORITATIVE verdict. */
  passed: boolean;
  /** Verbatim repair instruction — fed to the next attempt on failure. */
  feedback: string;
  /** Confidence / quality in 0..1 for ranking attempts. Optional. */
  score?: number;
  /**
   * Per-dimension comparison, rendered for the END USER (W4, 260801).
   *
   * ⚠ `feedback` above is a REPAIR INSTRUCTION aimed at the next model attempt
   *   ("Correct by 12 units") — it is not something to show a customer. The gate
   *   already computes expected/actual/delta per dimension and this field used to
   *   be thrown away here, leaving the UI with nothing but pass/fail.
   */
  dimensions?: DimSentence[];
  /** One-line summary of `dimensions` — counts ok / off / **not checked** separately. */
  dimensionSummary?: string;
}

/**
 * Evaluate the deterministic gate over a completed session. Returns null
 * when the gate cannot run (no intent / no measurable geometry) — the
 * orchestrator treats that as "unverified", never as a pass.
 */
export type GateEvaluator = (session: AgentSession) => GateVerdict | null | Promise<GateVerdict | null>;

/**
 * Semantic second critic (lever E). Returns whether the render matches the
 * original request, plus a short note. Returns null when vision is
 * unavailable or errors — no signal, never a fail.
 */
export type VisionCritic = (
  session: AgentSession,
  originalRequest: string,
) => Promise<{ match: boolean; note: string } | null>;

// ─── AI family (series-switch unit) ─────────────────────────────────────────

export interface AiFamily {
  /** Human-readable family label, e.g. 'deepseek', 'anthropic', 'gemini'. */
  family: string;
  /** The client that runs this family — forced to a single provider so the
   *  switch is a real model-family change, not a fallback surprise. */
  client: AiClient;
}

// ─── Options / result ────────────────────────────────────────────────────────

export interface RepairLoopOptions {
  /** Original user request — also used as the vision critic's target. */
  userPrompt: string;
  /** Ordered families to use. Attempt 1 uses families[0]; a series-switch
   *  advances to the next. Must contain at least one entry. */
  aiFamilies: AiFamily[];
  tools: ToolExecutorMap;
  /** Deterministic gate — the source of truth. */
  gate: GateEvaluator;
  /** Optional semantic critic (lever E). */
  visionCritic?: VisionCritic;
  /** Max total attempts (>= 1). Default 3. */
  maxAttempts?: number;
  /** Consecutive same-family failures before switching family. Default 1
   *  (switch on the very next attempt), matching the pilot's finding that a
   *  same-model retry rarely rescues what the family already failed. */
  switchAfter?: number;
  /**
   * Treat an UNVERIFIABLE gate result (null verdict = nothing measurable was
   * built) as an actionable failure worth another attempt / series-switch,
   * instead of a silent stop. Default FALSE so the normal generation loop is
   * unchanged: there, a null verdict with no vision signal means "nothing to
   * repair, hand back". The RECONSTRUCTION fleet sets this TRUE — a
   * reconstruction the deterministic gate cannot even measure is NOT a
   * success, so we retry (and, with 2+ families, switch) while budget remains.
   * When true, the repair prompt receives a concrete "you produced nothing
   * measurable — build + render a valid solid" instruction so the next attempt
   * has a real fix to make. */
  retryOnUnverified?: boolean;
  /** Continuation session (or null to start fresh). */
  session?: AgentSession | null;
  /** Per-attempt budget caps (each attempt gets a fresh budget slice so a
   *  long attempt-1 doesn't starve the repair attempts). */
  tokensCap?: number;
  turnsCap?: number;
  toolCallsCap?: number;
  visionCallsCap?: number;
  onEvent?: (ev: AgentEvent) => void;
  /** Optional logger for series-switch decisions (defaults to no-op).
   *  Injectable so tests can assert the single-family no-op path. */
  log?: (msg: string) => void;
  signal?: AbortSignal;
}

export interface AttemptRecord {
  /** 1-indexed attempt number. */
  attempt: number;
  /** Family that ran this attempt. */
  family: string;
  /** Gate verdict (null = unverified). */
  verdict: GateVerdict | null;
  /** Whether the geometric gate passed (verdict.passed === true). */
  geomPassed: boolean;
  /** Vision critic result for this attempt, if run. */
  vision: { match: boolean; note: string } | null;
  /** True when the vision critic returned a clear NO. */
  visionFlagged: boolean;
}

export interface RepairLoopResult {
  /** Best attempt's session (see attempt ranking). */
  session: AgentSession;
  /** AUTHORITATIVE verdict = geometric gate on the best attempt. */
  passed: boolean;
  /** Total attempts actually run. */
  attemptsUsed: number;
  /** True iff the family was switched at least once. */
  seriesSwitched: boolean;
  /** Distinct families that ran, in order first used. */
  familiesUsed: string[];
  /** True when only one family was available (switch was a logged no-op). */
  singleFamily: boolean;
  /** Best attempt's gate verdict (null = unverified). */
  finalVerdict: GateVerdict | null;
  /** True when the vision critic flagged the returned attempt. */
  visionFlagged: boolean;
  /** Per-attempt trace for observability / confidence. */
  attempts: AttemptRecord[];
  /** All agent events across attempts. */
  events: AgentEvent[];
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Repair instruction used when `retryOnUnverified` is set and the gate could
 * not measure the geometry. It states precisely WHY the attempt was not
 * verifiable (no measured solid) and what to do — build AND render a valid
 * solid — so the retry has a concrete fix rather than repeating the miss.
 */
const UNVERIFIED_REPAIR_HINT =
  'The previous attempt produced NO measurable geometry, so the deterministic '
  + 'gate could not verify it. This almost always means a valid solid was never '
  + 'built and rendered. You MUST, in order: (1) build the solid with '
  + 'add_feature_intent (or add_composite_intent / write_scad for shapes that '
  + 'need it); (2) call render and read its result — if it reports errors, fix '
  + 'the SCAD and render again until it succeeds; (3) confirm a bounding box was '
  + 'measured. Do not hand back until render succeeds and geometry is measurable.';

/** Rank an attempt for "best so far" selection. Geometric pass dominates,
 *  then vision match, then gate score. Lexicographic via a single number. */
function rankOf(rec: AttemptRecord): number {
  const geom = rec.geomPassed ? 1 : 0;
  const visionOk = rec.vision ? (rec.vision.match ? 1 : 0) : 0.5; // no critic = neutral
  const score = rec.verdict?.score ?? (rec.geomPassed ? 1 : 0);
  return geom * 1000 + visionOk * 100 + score;
}

/**
 * Run the self-correcting repair loop.
 *
 * The loop is deterministic given deterministic inputs (mock AI + mock gate),
 * which is exactly how the unit tests exercise it — no live LLM/vision calls.
 */
export async function runRepairLoop(opts: RepairLoopOptions): Promise<RepairLoopResult> {
  if (!opts.aiFamilies || opts.aiFamilies.length === 0) {
    throw new Error('runRepairLoop requires at least one AI family');
  }
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const switchAfter = Math.max(1, opts.switchAfter ?? 1);
  const log = opts.log ?? (() => {});
  const families = opts.aiFamilies;
  const singleFamily = families.length <= 1;

  const events: AgentEvent[] = [];
  const emit = (ev: AgentEvent) => {
    events.push(ev);
    opts.onEvent?.(ev);
  };

  const budgetCaps = {
    tokensCap: opts.tokensCap,
    turnsCap: opts.turnsCap,
    toolCallsCap: opts.toolCallsCap,
    visionCallsCap: opts.visionCallsCap,
  };

  let session: AgentSession | null = opts.session ?? null;
  let familyIdx = 0;
  let consecutiveFails = 0;
  let seriesSwitched = false;
  const familiesUsed: string[] = [];
  const attempts: AttemptRecord[] = [];

  // Best attempt is a snapshot so a later (semantic) repair that regresses
  // the geometry cannot lose an earlier geometric pass.
  let best: { session: AgentSession; rec: AttemptRecord } | null = null;

  let nextPrompt = opts.userPrompt;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal?.aborted) break;
    const family = families[familyIdx];
    if (!familiesUsed.includes(family.family)) familiesUsed.push(family.family);

    // Each attempt gets a fresh budget slice, but keeps the accumulated
    // conversation memory (history / geometry / scad) for continuity. The
    // repair prompt below tells the model precisely what to fix.
    if (session) session.budget = makeInitialBudget(budgetCaps);

    let run: Awaited<ReturnType<typeof runScadAgent>>;
    try {
      run = await runScadAgent({
        userPrompt: nextPrompt,
        // Deterministic dimension reconcile (add_feature_intent) always reads the
        // user's ORIGINAL request — never the repair feedback that nextPrompt
        // carries on attempt >= 2 — so restated gate numbers can't skew it.
        originalPrompt: opts.userPrompt,
        session,
        ai: family.client,
        tools: opts.tools,
        // Disable the deterministic fast-path on repair attempts — the repair
        // prompt is free text that would never match a catalog pattern anyway,
        // and we always want the model to actually re-reason on a fix.
        fastPath: attempt === 1 ? undefined : false,
        onEvent: emit,
        signal: opts.signal,
        ...budgetCaps,
      });
    } catch (e) {
      // A THROWN error here (provider outage/cooldown, network failure) is
      // distinct from a normal failed-gate attempt: `chatCompletion` locks to
      // a single provider once a family requests one explicitly (no in-call
      // fallback — see src/lib/ai/index.ts resolveChain), so a family that's
      // mid-cooldown throws outright instead of returning a bad session. Left
      // unhandled, that exception propagated out of this whole function,
      // discarding `best` — an EARLIER attempt's genuinely passing result —
      // just because a LATER attempt hit a transient provider hiccup. Treat it
      // as a recorded, retryable failure instead: series-switch still applies,
      // and only exhausting every attempt with nothing to show for it is a
      // real (thrown) failure.
      const message = e instanceof Error ? e.message : String(e);
      emit({ type: 'error', message: `attempt ${attempt} (${family.family}): ${message}` });
      const rec: AttemptRecord = {
        attempt, family: family.family, verdict: null, geomPassed: false, vision: null, visionFlagged: false,
      };
      attempts.push(rec);
      if (!best && attempt === maxAttempts) throw e; // truly nothing to return, ever
      if (attempt < maxAttempts) {
        consecutiveFails += 1;
        if (consecutiveFails >= switchAfter && !singleFamily) {
          const from = family.family;
          familyIdx = (familyIdx + 1) % families.length;
          seriesSwitched = true;
          consecutiveFails = 0;
          log(`series-switch: ${from} -> ${families[familyIdx].family} after a provider error`);
        }
      }
      continue;
    }
    session = run.session;

    // ── Deterministic gate (source of truth) ──
    const verdict = await opts.gate(session);
    const geomPassed = verdict?.passed === true;
    /**
     * W4 — 치수 대조를 **사용자에게** 흘린다. 지금까지 이 값은 여기서 계산되고
     * 감사 로그에만 남아, 화면에는 통과/실패만 갔다.
     * ⚠ 게이트가 아예 못 돈 경우(`verdict === null`)에는 아무것도 보내지 않는다 —
     *   빈 목록을 보내면 「검사했는데 지적 없음」으로 읽힌다.
     */
    if (verdict?.dimensions?.length) {
      opts.onEvent?.({
        type: 'dimension_check',
        passed: verdict.passed,
        summary: verdict.dimensionSummary ?? dimensionSummary(verdict.dimensions, 'ko'),
        dimensions: verdict.dimensions,
      });
    }

    // ── Vision critic (lever E) — semantic second opinion ──
    let vision: { match: boolean; note: string } | null = null;
    if (opts.visionCritic) {
      try {
        vision = await opts.visionCritic(session, opts.userPrompt);
      } catch {
        vision = null; // vision failure is never a hard fail
      }
    }
    const visionFlagged = vision !== null && vision.match === false;

    const rec: AttemptRecord = {
      attempt,
      family: family.family,
      verdict,
      geomPassed,
      vision,
      visionFlagged,
    };
    attempts.push(rec);

    // Update best (snapshot so it survives later mutation).
    if (!best || rankOf(rec) > rankOf(best.rec)) {
      best = { session: structuredClone(session), rec };
    }

    // Actionable failure signals:
    //   - geometric gate returned a definite fail, OR
    //   - vision critic said clear NO (semantic mismatch the geometric gate
    //     is blind to, e.g. right bbox but wrong shape).
    const geomFailed = verdict?.passed === false;
    // A null verdict means the gate could not measure the geometry (nothing
    // built / render failed / not verifiable). Normally that is "nothing to
    // repair"; the reconstruction fleet opts INTO treating it as a retry so an
    // unverifiable proposal gets another family/approach, not a silent stop.
    const gateUnverified = verdict == null;
    const retryUnverified = opts.retryOnUnverified === true && gateUnverified;
    const needsRepair = geomFailed || visionFlagged || retryUnverified;

    if (!needsRepair) {
      // Either a clean geometric pass, or unverified with no vision signal —
      // in both cases there is nothing actionable to repair. Stop.
      break;
    }

    if (attempt === maxAttempts) break; // exhausted — return best honestly.

    // Build the repair prompt from the gate feedback (verbatim) plus any
    // vision note. This is the "gate feedback -> repair prompt" wiring.
    const parts: string[] = [];
    if (verdict && !verdict.passed) parts.push(verdict.feedback);
    if (visionFlagged && vision) parts.push(`Vision critic (semantic check): ${vision.note}`);
    if (retryUnverified) parts.push(UNVERIFIED_REPAIR_HINT);
    nextPrompt =
      'The previous attempt did NOT pass verification. Fix EXACTLY the issues '
      + 'below and regenerate the model. Do not change anything that was already '
      + 'correct.\n\n'
      + parts.join('\n\n');

    // ── Series-switch decision ──
    consecutiveFails += 1;
    if (consecutiveFails >= switchAfter) {
      if (!singleFamily) {
        const from = family.family;
        familyIdx = (familyIdx + 1) % families.length;
        seriesSwitched = true;
        consecutiveFails = 0;
        log(`series-switch: ${from} -> ${families[familyIdx].family} after ${switchAfter} failure(s)`);
      } else {
        log('single-family, no switch (only one model family configured)');
      }
    }
  }

  // best is always set because the loop runs at least once.
  const chosen = best!;
  return {
    session: chosen.session,
    passed: chosen.rec.geomPassed,
    attemptsUsed: attempts.length,
    seriesSwitched,
    familiesUsed,
    singleFamily,
    finalVerdict: chosen.rec.verdict,
    visionFlagged: chosen.rec.visionFlagged,
    attempts,
    events,
  };
}

// ─── Default spec-verification gate (reachable from session state) ──────────

export interface SpecGateOptions {
  /** Manufacturing process for the wall-thickness DFM sub-check. Usually
   *  pulled from session.userPrefs.default_process. */
  processForDfm?: ProcessForDfm;
  /** Tolerance overrides forwarded to verifyAgainstSpec. */
  tolMm?: number;
  tolPct?: number;
}

/**
 * Build a GateEvaluator backed by the existing spec-verification gate. It
 * reads `session.lastIntent` + `session.geometry` (bbox / volume / genus /
 * holes / dihedrals / min-wall) and runs `verifyAgainstSpec`, then renders
 * the human-readable critique via `formatSpecCritique` as the repair feedback.
 *
 * Returns null (unverified) when there is no intent or no measurable bbox —
 * the orchestrator will not treat that as a pass.
 */
export function makeSpecGateEvaluator(gopts: SpecGateOptions = {}): GateEvaluator {
  return (session: AgentSession): GateVerdict | null => {
    const intent = session.lastIntent;
    const geo: GeometryStats = session.geometry ?? {};
    if (!intent || !geo.bbox) return null;

    const process =
      gopts.processForDfm
      ?? (session.userPrefs?.default_process as ProcessForDfm | undefined);

    const result = verifyAgainstSpec(intent, geo.bbox, {
      tolMm: gopts.tolMm,
      tolPct: gopts.tolPct,
      detectedGenus: geo.genus,
      detectedVolumeMm3: geo.volume_mm3,
      detectedSurfaceAreaMm2: geo.surfaceArea_mm2,
      detectedHoles: geo.detectedHoles,
      detectedDihedralStats: geo.dihedralStats
        ? {
            sharpEdgeCount: geo.dihedralStats.sharpEdgeCount,
            maxDihedralDeg: geo.dihedralStats.maxDihedralDeg,
          }
        : undefined,
      detectedMinWallMm: geo.minWallThicknessMm,
      processForDfm: process,
    });

    if (!result.verifiable) return null; // shape not deterministically checkable

    // Rough confidence score for ranking: 1 when clean, else decays with the
    // number of distinct mismatch signals. Never used for pass/fail — only
    // to order competing failing attempts.
    let signals = result.mismatches.length;
    if (result.holeCount?.mismatch) signals += 1;
    if (result.volume?.mismatch) signals += 1;
    if (result.surfaceArea?.mismatch) signals += 1;
    if (result.holePositions && !result.holePositions.allMatched) signals += 1;
    if (result.fillet && !result.fillet.applied) signals += 1;
    if (result.chamfer && !result.chamfer.applied) signals += 1;
    if (result.threads && !result.threads.allOk) signals += 1;
    if (result.wallThickness && !result.wallThickness.pass) signals += 1;
    const score = result.ok ? 1 : Math.max(0, 1 - signals * 0.15);

    return {
      passed: result.ok,
      feedback: formatSpecCritique(result),
      score,
    };
  };
}

// ─── Optional cad-ir reconstruction gate (reachable when caller has an IR) ──

/**
 * Build a GateEvaluator backed by the cad-ir `verifyReconstruction` gate.
 * The base loop has no IR in scope, so this is only reachable when the caller
 * supplies one (e.g. a drawing-to-3D reconstruction task). It maps the
 * session's measured `GeometryStats` into a cad-ir `MeshMeasurement`
 * candidate and compares it against the reference IR — surfacing the gate's
 * own `feedback` string (axis-flip, missing hole, invented hole, ...) as the
 * repair instruction. Returns null when the session has no measured bbox.
 */
export function makeReconstructionGateEvaluator(
  ir: import('../../cad-ir/schema').Ir,
): GateEvaluator {
  return async (session: AgentSession): Promise<GateVerdict | null> => {
    const geo: GeometryStats = session.geometry ?? {};
    if (!geo.bbox) return null;
    const { verifyReconstruction } = await import('../../cad-ir/gate');
    const min = geo.bbox.min;
    const max = geo.bbox.max;
    const extents: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const measurement = {
      ok: true,
      error: null,
      extents,
      bboxMin: min,
      bboxMax: max,
      volume: geo.volume_mm3 ?? null,
      area: geo.surfaceArea_mm2 ?? null,
      triangles: geo.triangleCount ?? 0,
      vertices: 0,
      edges: 0,
      watertight: geo.watertight ?? false,
      nonManifold: geo.manifold === false,
      eulerNumber: null,
      genus: geo.genus ?? null,
      bodyCount: geo.componentCount ?? 1,
    };
    const gate = verifyReconstruction({ kind: 'measurement', measurement }, ir);
    /**
     * ⚠ 단위는 **IR 이 밝힌 것만** 쓴다. `ir.extent.units` 는 선언·추론된 경우에만 값이 있고
     *   모르면 `null` 이다(`schema.ts` 의 honesty rule). 여기서 `'mm'` 를 기본값으로 두면
     *   측정하지 않은 단위를 문장에 새기게 된다.
     */
    const unit = ir.extent?.units ?? null;
    const dimensions = dimensionSentences(gate.checks, { lang: 'ko', unit });
    return {
      passed: gate.passed,
      feedback: gate.feedback,
      score: gate.score,
      dimensions,
      dimensionSummary: dimensionSummary(dimensions, 'ko'),
    };
  };
}

// ─── Vision critic backed by the existing VisionAdapter ─────────────────────

/**
 * Build a VisionCritic that reuses the existing `view_render` vision path
 * (the same VisionAdapter the tools layer uses). It asks a strict yes/no
 * question — "does this render match the request?" — and parses the first
 * token. Anything that isn't a clear NO is treated as "match" so vision never
 * manufactures a fail out of hedged prose.
 *
 * Returns null when no vision adapter is available, or when the render failed
 * (nothing to look at) — no signal, never a fail.
 */
export function makeVisionCritic(vision: VisionAdapter | undefined): VisionCritic | undefined {
  if (!vision) return undefined;
  return async (session, originalRequest) => {
    if (session.render.ok !== true) return null;
    const source = effectiveScadSource(session);
    if (!source.trim()) return null;
    const prompt =
      `You are a CAD reviewer performing a SEMANTIC check. The user requested:\n`
      + `"${originalRequest.slice(0, 800)}"\n\n`
      + `Looking at the rendered geometry, does it match that request as a `
      + `recognizable instance (correct kind of object, major features present)?\n`
      + `Answer with YES or NO on the FIRST line, then one short sentence of reason. `
      + `Judge semantics only — ignore minor proportions, color, and surface finish.`;
    let res: Awaited<ReturnType<VisionAdapter>>;
    try {
      res = await vision(source, prompt);
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const text = res.analysis ?? '';
    const firstLine = text.trim().split(/\r?\n/, 1)[0]?.trim().toUpperCase() ?? '';
    // Clear NO only when the verdict token is explicitly negative. Default to
    // match so hedged / ambiguous critiques never fabricate a semantic fail.
    const isNo = /^\s*NO\b/.test(firstLine) || /\bDOES NOT MATCH\b/.test(firstLine);
    return { match: !isNo, note: text.trim().slice(0, 500) };
  };
}

// ─── Server factory: enumerate configured model families ────────────────────

/**
 * Build one AiClient per CONFIGURED provider family, ordered with
 * AI_PROVIDER_PRIMARY first. Each client forces its single provider (no
 * fallback) so a series-switch is a genuine model-family change.
 *
 * The count of returned families is the REAL answer to "how many families
 * are available for a series-switch": with 0-1 configured, the switch is an
 * honest logged no-op; with 2+, it fires.
 *
 * Server-side only — the provider adapters read env vars / API keys.
 */
export async function makeServerAiFamilies(
  opts: { task?: string; temperature?: number; maxTokens?: number } = {},
): Promise<AiFamily[]> {
  const { chatCompletion } = await import('../index');
  type ProviderName = import('../types').ProviderName;

  // Discover configured providers by probing each adapter's isConfigured().
  const [
    { deepseekProvider },
    { geminiProvider },
    { qwenProvider },
    { openrouterProvider },
    { openaiProvider },
    { anthropicProvider },
    { localProvider },
  ] = await Promise.all([
    import('../providers/deepseek'),
    import('../providers/gemini'),
    import('../providers/qwen'),
    import('../providers/openrouter'),
    import('../providers/openai'),
    import('../providers/anthropic'),
    import('../providers/local'),
  ]);

  const all: Array<{ name: ProviderName; isConfigured: () => boolean }> = [
    { name: 'deepseek', isConfigured: () => deepseekProvider.isConfigured() },
    { name: 'gemini', isConfigured: () => geminiProvider.isConfigured() },
    { name: 'qwen', isConfigured: () => qwenProvider.isConfigured() },
    { name: 'openrouter', isConfigured: () => openrouterProvider.isConfigured() },
    { name: 'openai', isConfigured: () => openaiProvider.isConfigured() },
    { name: 'anthropic', isConfigured: () => anthropicProvider.isConfigured() },
    { name: 'local', isConfigured: () => localProvider.isConfigured() },
  ];

  const configured = all.filter(p => {
    try {
      return p.isConfigured();
    } catch {
      return false;
    }
  });

  // Order primary-first.
  const primary = (process.env.AI_PROVIDER_PRIMARY ?? 'deepseek')
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  configured.sort((a, b) => {
    if (a.name === primary) return -1;
    if (b.name === primary) return 1;
    return 0;
  });

  return configured.map(p => ({
    family: p.name,
    client: {
      async complete(messages, callOpts) {
        const resp = await chatCompletion({
          messages,
          provider: p.name,
          task: opts.task ?? 'scad-agent-repair',
          temperature: opts.temperature ?? 0.2,
          maxTokens: opts.maxTokens ?? 2048,
          signal: callOpts?.signal,
        });
        return {
          text: resp.text,
          promptTokens: resp.promptTokens,
          completionTokens: resp.completionTokens,
        };
      },
    } satisfies AiClient,
  }));
}
