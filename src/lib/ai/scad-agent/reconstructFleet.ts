/**
 * reconstructFleet.ts — the RECONSTRUCTION FLEET (lever F): the frontier
 * attack on "complex uploaded shape -> clean parametric".
 *
 * This is a CONVERGENCE of pieces already built this session, not new
 * geometry code. It composes exactly three existing parts:
 *
 *   1. THE PROPOSER — `runScadAgent` (wrapped by `runRepairLoop`) drives the
 *      LLM to propose SCAD, render it, and land measured geometry on the
 *      session. The fleet adds NO new solver / mesher / renderer.
 *
 *   2. THE GATE — `makeReconstructionGateEvaluator(sourceIr)` maps the
 *      session's measured geometry into a cad-ir candidate and runs
 *      `verifyReconstruction` against the SOURCE IR (bbox / genus /
 *      watertight; units-unknown -> aspect-ratio mode). The gate is the
 *      SOURCE OF TRUTH: a proposal is "passed" ONLY when the gate passes.
 *      Wrong guesses are caught here and NEVER shipped as correct.
 *
 *   3. THE GROUNDING — `retrieveReferenceParts` (lever C) primes the proposer
 *      with similar REAL parts, cited as NON-AUTHORITATIVE structure/scale
 *      examples. No retrieved number ever becomes a fact; the gate still
 *      decides truth.
 *
 * The safety story: because the deterministic gate catches wrong guesses, it
 * is SAFE to let the AI guess aggressively. The fleet's headroom is real but
 * BOUNDED (the user's own layer-2 pilot measured ~49% pass). Complex curved
 * parts may not pass — that is the correct, HONEST outcome, surfaced as a
 * non-pass with feedback, never fabricated into a pass.
 */

import type { Ir } from '../../cad-ir/schema';
import type { AiFamily, VisionCritic, GateVerdict, GateEvaluator } from './repairLoop';
import { runRepairLoop, makeReconstructionGateEvaluator } from './repairLoop';
import type { AgentEvent, ToolExecutorMap, AgentSession } from './types';
import { effectiveScadSource } from './composeSource';
import {
  retrieveReferenceParts,
  formatReferencePartsBlock,
  type ReferenceQuery,
  type CitedRefPart,
} from '../reference/retrieveReferenceParts';
import type { IntentInput } from '../../openscad-render/intentToScad';

// ─── IR -> reference query (grounding) ──────────────────────────────────────

/**
 * Derive a deterministic `ReferenceQuery` from the source IR so lever C can
 * retrieve structurally similar real parts. Uses only measured/derived IR
 * fields — never invents signal. Absent signals stay absent so an IR with
 * little structure simply retrieves fewer (or zero) references.
 */
export function irToReferenceQuery(ir: Ir): ReferenceQuery {
  const q: ReferenceQuery = {};

  const aspect = ir.extent?.aspect;
  if (aspect) q.aspect = aspect;

  // Surface-type histogram: prefer B-rep topology, fall back to the mesh
  // curvature bins (flat/cyl/free) as a coarse proxy so STL-only uploads
  // still get a histogram to match on.
  const st = ir.topology?.surface_types;
  if (st && Object.keys(st).length) {
    q.surfaceTypes = Object.fromEntries(
      Object.entries(st).filter(([, v]) => typeof v === 'number' && v > 0) as [string, number][],
    );
  } else if (ir.mesh?.curvature_bins) {
    const c = ir.mesh.curvature_bins;
    const hist: Record<string, number> = {};
    if (c.flat > 0) hist.plane = c.flat;
    if (c.cyl > 0) hist.cylinder = c.cyl;
    if (c.free > 0) hist.bspline = c.free;
    if (Object.keys(hist).length) q.surfaceTypes = hist;
  }

  // Hole signature from measured feature holes / diameters.
  const diameters = (ir.features?.hole_diameters ?? []).filter((d) => d > 0);
  const holeCount = ir.features?.holes?.length ?? 0;
  if (holeCount > 0 || diameters.length) {
    q.holeSig = {
      ...(holeCount > 0 ? { count: holeCount } : {}),
      ...(diameters.length ? { diameters } : {}),
    };
  }

  // Free-text descriptor from the strongest structural signals — primitive
  // fit kind + aspect. This is a matching hint only; the gate decides truth.
  const words: string[] = [];
  if (ir.features?.primitive_fit?.kind) words.push(ir.features.primitive_fit.kind);
  if (ir.mesh?.primitive_fit?.kind) words.push(ir.mesh.primitive_fit.kind);
  if (aspect) words.push(aspect);
  if (words.length) q.text = words.join(' ');

  return q;
}

// ──── Heuristic seed hint (deterministic classifier -> proposer) ────

/**
 * A STRONG-but-not-authoritative starting point handed to the proposer: the
 * deterministic heuristic classifier's TOP candidate (shapeId + params +
 * confidence). The classifier already identifies primitive class (box /
 * cylinder / ...), so seeding the LLM with it stops the proposer from blindly
 * defaulting to a box on a shape-less bare-STL IR. It is a HINT only — the
 * deterministic gate still judges truth, so a wrong hint gets caught, not
 * rubber-stamped. Kept as a minimal local shape so this module does not depend
 * on reverseEngineer's `ProposedIntent`.
 */
export interface HeuristicSeedHint {
  /** Primitive/shape id the classifier matched (e.g. 'cylinder', 'box'). */
  shapeId: string;
  /** Measured parameters for that shape (e.g. { r: 10, h: 30 }). */
  params?: Record<string, number>;
  /** 0..100 confidence the heuristic placed on this match. */
  confidence?: number;
  /** One-line human summary from the classifier, if any. */
  summary?: string;
}

/**
 * Render the heuristic seed hint as a short, honest prompt block. Framed as a
 * starting point to VERIFY and CORRECT against the measured IR — never as an
 * answer to accept. Returns '' when there is no usable hint.
 */
function formatHeuristicHintBlock(hint: HeuristicSeedHint | undefined): string {
  if (!hint || !hint.shapeId) return '';
  const paramStr = hint.params && Object.keys(hint.params).length
    ? Object.entries(hint.params)
        .map(([k, v]) => `${k}=${typeof v === 'number' ? Number(v.toFixed(4)) : v}`)
        .join(', ')
    : '(no params)';
  const conf = typeof hint.confidence === 'number'
    ? ` (classifier confidence ${Math.round(hint.confidence)}%)`
    : '';
  const lines: string[] = [];
  lines.push('CLASSIFIER SEED (strong starting point — verify, do not blindly trust):');
  lines.push(
    `- A deterministic shape classifier identified this part as: ${hint.shapeId} `
    + `with params ${paramStr}${conf}.`,
  );
  if (hint.summary) lines.push(`- classifier note: ${hint.summary}`);
  lines.push(
    '- START FROM THIS primitive rather than defaulting to a box. Then CHECK it '
    + 'against the SOURCE MEASUREMENTS below and CORRECT it if the geometry '
    + 'disagrees (wrong primitive, wrong dims, missing feature). This seed is a '
    + 'hint, not ground truth — the deterministic gate still verifies your result, '
    + 'so a wrong seed will FAIL and must be fixed, not carried forward.',
  );
  return lines.join('\n');
}

// ─── IR -> reconstruction prompt ─────────────────────────────────────────────

function fmtVec(v: [number, number, number] | null | undefined, digits = 2): string {
  if (!v) return 'unknown';
  return v.map((n) => n.toFixed(digits)).join(' x ');
}

/**
 * Compose the reconstruction PROMPT from the source IR (bbox/size, aspect,
 * surface-type histogram, holes/patterns, primitive_fit) plus the cited
 * reference block. Honesty is baked in: units-unknown is stated so the model
 * does not treat mesh numbers as mm, and references are explicitly framed as
 * non-authoritative structure examples.
 *
 * Exported for testability — the grounding-in-prompt test asserts against this.
 */
export function buildReconstructionPrompt(
  ir: Ir,
  refs: CitedRefPart[],
  hint?: HeuristicSeedHint,
): string {
  const lines: string[] = [];
  lines.push(
    'Reconstruct this uploaded part as CLEAN, editable parametric geometry '
    + '(OpenSCAD via the scad tools). You are given a measured IR of the SOURCE '
    + 'mesh/B-rep below. Your model will be VERIFIED against the source by a '
    + 'deterministic gate (bounding box, genus/holes, watertightness). Match the '
    + 'source geometry; do not add features the IR does not evidence.',
  );

  // Deterministic classifier seed (if any) FIRST — a strong starting point the
  // model should verify against the SOURCE MEASUREMENTS that follow, not accept.
  const hintBlock = formatHeuristicHintBlock(hint);
  if (hintBlock) {
    lines.push('');
    lines.push(hintBlock);
  }

  const e = ir.extent;
  const unitsKnown = !!e?.units && e.units_source !== 'unknown';
  lines.push('');
  lines.push('SOURCE MEASUREMENTS (from the IR — treat as evidence, not as a target spec):');
  lines.push(`- size (extents): ${fmtVec(e?.size ?? null)}`);
  lines.push(`- bbox min..max: ${fmtVec(e?.bbox_min ?? null)}  ..  ${fmtVec(e?.bbox_max ?? null)}`);
  lines.push(`- aspect class: ${e?.aspect ?? 'unknown'}`);
  if (unitsKnown) {
    lines.push(`- units: ${e!.units} (${e!.units_source})`);
  } else {
    lines.push(
      '- units: UNKNOWN — the numbers above are in the source file\'s own units. '
      + 'Preserve RATIOS/aspect; the gate compares shape, not absolute millimetres.',
    );
  }

  const topo = ir.topology;
  if (topo) {
    const st = topo.surface_types;
    if (st && Object.keys(st).length) {
      const hist = Object.entries(st)
        .filter(([, v]) => typeof v === 'number' && (v as number) > 0)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ');
      if (hist) lines.push(`- surface-type histogram: ${hist}`);
    }
    if (typeof topo.analytic_ratio === 'number') {
      lines.push(
        `- analytic ratio: ${topo.analytic_ratio.toFixed(2)} `
        + `(1.0 => fully primitive/CSG reconstructible; low => freeform surfaces present)`,
      );
    }
    if (topo.solids != null) lines.push(`- solids/bodies: ${topo.solids}`);
  }

  const f = ir.features;
  if (f) {
    if (f.holes?.length || f.hole_diameters?.length) {
      const dia = f.hole_diameters?.length ? ` diameters=[${f.hole_diameters.join(', ')}]` : '';
      lines.push(`- holes: ${f.holes?.length ?? 0} detected${dia}`);
    }
    if (f.patterns?.length) {
      const pats = f.patterns
        .map((p) => `${p.kind}x${p.count}`)
        .join(', ');
      lines.push(`- patterns: ${pats}`);
    }
    if (f.fillet_radii?.length) lines.push(`- fillet radii: [${f.fillet_radii.join(', ')}]`);
    if (f.primitive_fit) {
      lines.push(
        `- best primitive fit: ${f.primitive_fit.kind} `
        + `(residual ${f.primitive_fit.residual_pct.toFixed(1)}%)`,
      );
    }
  }

  const mesh = ir.mesh;
  if (mesh) {
    if (mesh.watertight != null) lines.push(`- watertight: ${mesh.watertight}`);
    if (mesh.components != null) lines.push(`- connected components: ${mesh.components}`);
  }

  const rc = ir.reconstruct;
  if (rc) {
    lines.push(
      `- suggested strategy: ${rc.strategy} (grade ${rc.grade}); `
      + `${rc.rationale}`,
    );
    if (rc.blockers?.length) lines.push(`- known blockers: ${rc.blockers.join('; ')}`);
  }

  const refBlock = formatReferencePartsBlock(refs);
  if (refBlock) {
    lines.push('');
    lines.push(refBlock);
  }

  lines.push('');
  lines.push(
    'Produce the parametric model now. If the shape is freeform and cannot be '
    + 'faithfully reproduced with primitives, get as close as the gate allows '
    + 'rather than inventing detail.',
  );

  return lines.join('\n');
}

// ─── Options / result ────────────────────────────────────────────────────────

export interface ReconstructFleetOptions {
  /** Measured IR of the SOURCE part — the gate's reference and the prompt's basis. */
  sourceIr: Ir;
  /**
   * Optional deterministic-classifier seed (top heuristic candidate: shapeId +
   * params + confidence). Injected into the reconstruction prompt as a STRONG
   * starting point so the proposer begins from the identified primitive (e.g.
   * cylinder) instead of blindly defaulting to a box. It biases the proposer
   * ONLY — the gate still verifies the result, so a wrong seed FAILs. Omit for
   * the unchanged no-hint behavior.
   */
  heuristicHint?: HeuristicSeedHint;
  /** Tool executors (server adapters) the proposer uses to build/render SCAD. */
  tools: ToolExecutorMap;
  /** Ordered model families for series-switch. Must contain >= 1 entry. */
  aiFamilies: AiFamily[];
  /** Enable lever-C grounding (retrieve cited reference parts). Default true. */
  references?: boolean;
  /** Top-k reference parts to cite. Default 3. */
  referenceK?: number;
  /** Optional semantic vision critic (lever E). */
  visionCritic?: VisionCritic;
  /**
   * Gate override. Defaults to `makeReconstructionGateEvaluator(sourceIr)` —
   * the cad-ir gate that verifies the proposal against the source. A caller
   * with a different verifiable candidate form (e.g. an intent-triangles
   * gate) may inject their own; tests inject a scripted gate to drive the
   * fail -> series-switch -> pass path without a live render. The gate stays
   * the SOURCE OF TRUTH regardless of who supplies it.
   */
  gate?: GateEvaluator;
  /** Max total proposer attempts (>= 1). Default 3. */
  maxAttempts?: number;
  /** Consecutive same-family failures before switching. Default 1. */
  switchAfter?: number;
  /**
   * Count an UNVERIFIABLE gate result (null verdict = nothing measurable was
   * built) as a retry/series-switch trigger rather than a silent stop. Default
   * TRUE for the fleet: a reconstruction the gate cannot even measure is not a
   * success and deserves another family/approach while budget remains. Set
   * false to restore the plain "stop on unverified" behavior.
   */
  retryOnUnverified?: boolean;
  /** Per-attempt budget caps forwarded to the repair loop. */
  tokensCap?: number;
  turnsCap?: number;
  toolCallsCap?: number;
  visionCallsCap?: number;
  onEvent?: (ev: AgentEvent) => void;
  log?: (msg: string) => void;
  signal?: AbortSignal;
}

export interface ReconstructFleetResult {
  /** AUTHORITATIVE: true ONLY when the reconstruction gate passed. */
  passed: boolean;
  /** The best attempt's reconstruction. `scad` may be empty if nothing built. */
  reconstruction: { scad: string; intent?: IntentInput };
  /** The gate verdict for the returned attempt (null = unverified/no geometry). */
  verdict: GateVerdict | null;
  /** Total proposer attempts run. */
  attemptsUsed: number;
  /** True iff a model-family series-switch fired at least once. */
  seriesSwitched: boolean;
  /** Distinct families that ran, in first-used order. */
  familiesUsed: string[];
  /** True when only one family was available (switch was a logged no-op). */
  singleFamily: boolean;
  /** Cited reference parts used to ground the proposer (non-authoritative). */
  references: CitedRefPart[];
  /** True when the vision critic flagged the returned attempt. */
  visionFlagged: boolean;
  /** DIAGNOSTIC — did OpenSCAD render succeed on the returned attempt's session. */
  renderOk: boolean;
  /** DIAGNOSTIC — was a measurable bounding box present (the gate's precondition). */
  hasGeometry: boolean;
  /** DIAGNOSTIC — gate outcome for the returned attempt: passed / caught-fail /
   *  could-not-measure (the last is exactly the "did-not-verify" symptom). */
  gateStatus: 'pass' | 'fail' | 'unverified-null';
  /** DIAGNOSTIC — the gate's feedback string, or null when it could not run. */
  gateFeedback: string | null;
  /** DIAGNOSTIC — first ~200 chars of the proposed SCAD (empty when none built). */
  scadPreview: string;
  /**
   * Honest human-readable summary. On a non-pass this carries the gate's
   * feedback + "did not verify" so the caller never mistakes it for a pass.
   */
  note: string;
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Run the reconstruction fleet: propose parametric SCAD for the source IR,
 * verify each proposal against the source with the deterministic
 * reconstruction gate, feed gate feedback (axis flip / missing hole / wrong
 * dims) back into the next attempt, and series-switch families on failure.
 *
 * Returns `passed: true` ONLY when the gate passed on the returned attempt.
 * On exhaustion it returns the BEST attempt WITH an honest "did not verify"
 * note + feedback. It NEVER fabricates a pass.
 *
 * Deterministic given deterministic inputs (mock families + a scriptable gate
 * via the source IR), so the unit tests exercise it with no live LLM/render.
 */
export async function reconstructWithFleet(
  opts: ReconstructFleetOptions,
): Promise<ReconstructFleetResult> {
  if (!opts.aiFamilies || opts.aiFamilies.length === 0) {
    throw new Error('reconstructWithFleet requires at least one AI family');
  }

  // (1) GROUNDING — retrieve cited, non-authoritative reference parts.
  const useRefs = opts.references !== false;
  const references: CitedRefPart[] = useRefs
    ? retrieveReferenceParts(irToReferenceQuery(opts.sourceIr), opts.referenceK ?? 3)
    : [];

  // (2) PROMPT — compose from the source IR + cited references.
  const userPrompt = buildReconstructionPrompt(opts.sourceIr, references, opts.heuristicHint);

  // (3) PROPOSE + VERIFY — hand the whole loop to runRepairLoop, wiring the
  // cad-ir reconstruction gate as the source of truth. NO new geometry code:
  // the proposer is runScadAgent, the gate is makeReconstructionGateEvaluator.
  const loop = await runRepairLoop({
    userPrompt,
    aiFamilies: opts.aiFamilies,
    tools: opts.tools,
    gate: opts.gate ?? makeReconstructionGateEvaluator(opts.sourceIr),
    visionCritic: opts.visionCritic,
    // Fleet-scoped: an unverifiable reconstruction is not a success — retry
    // (and series-switch) instead of stopping silently after one attempt.
    retryOnUnverified: opts.retryOnUnverified !== false,
    maxAttempts: opts.maxAttempts ?? 3,
    switchAfter: opts.switchAfter,
    tokensCap: opts.tokensCap,
    turnsCap: opts.turnsCap,
    toolCallsCap: opts.toolCallsCap,
    visionCallsCap: opts.visionCallsCap,
    onEvent: opts.onEvent,
    log: opts.log,
    signal: opts.signal,
  });

  // (4) Extract the returned attempt's reconstruction from the best session.
  const session: AgentSession = loop.session;
  const scad = effectiveScadSource(session);
  const intent = session.lastIntent;

  // DIAGNOSTIC surfacing — expose exactly WHERE a non-pass happened so a live
  // self-test tells us the cause: nothing built (no scad)? render failed
  // (renderOk=false)? render ok but geometry unmeasurable (hasGeometry=false)?
  // or a real measured fail (gateStatus='fail')? These read the returned
  // (best) attempt's session + verdict.
  const renderOk = session.render?.ok === true;
  const hasGeometry = !!session.geometry?.bbox;
  const gateStatus: 'pass' | 'fail' | 'unverified-null' =
    loop.finalVerdict == null
      ? 'unverified-null'
      : (loop.finalVerdict.passed ? 'pass' : 'fail');
  const gateFeedback = loop.finalVerdict?.feedback ?? null;
  const scadPreview = scad.slice(0, 200);

  const note = loop.passed
    ? 'Reconstruction VERIFIED against the source by the deterministic gate '
      + `(${loop.attemptsUsed} attempt(s)${loop.seriesSwitched ? ', series-switched' : ''}).`
    : 'Reconstruction did NOT verify against the source. This is an honest '
      + 'non-pass — the proposal was not shipped as correct. '
      + (loop.finalVerdict
          ? `Gate feedback: ${loop.finalVerdict.feedback}`
          : 'The gate could not measure the geometry (nothing built or not verifiable).');

  return {
    passed: loop.passed,
    reconstruction: { scad, ...(intent ? { intent } : {}) },
    verdict: loop.finalVerdict,
    attemptsUsed: loop.attemptsUsed,
    seriesSwitched: loop.seriesSwitched,
    familiesUsed: loop.familiesUsed,
    singleFamily: loop.singleFamily,
    references,
    visionFlagged: loop.visionFlagged,
    renderOk,
    hasGeometry,
    gateStatus,
    gateFeedback,
    scadPreview,
    note,
  };
}
