/**
 * design-driver/planWithConfidence — the one-call self-consistency hook for the
 * DesignPlanner (lever B).
 *
 * A route that wants confidence on a plan calls `planWithConfidence(planner,
 * brief, { runs })` instead of `planner.plan(brief)`. It runs the planner N
 * times (the SAME model — self-consistency, not cross-model) and reports the
 * per-key agreement so the caller/UI can WARN when the key parameters were not
 * stable across runs. Every run still passes through the planner's own
 * coerce + preflight gate (llmPlanner), which stays authoritative — this hook
 * only attaches confidence and picks the medoid plan; it never repairs or
 * fabricates a plan.
 *
 * COST: `runs` defaults to 1 = a true no-op passthrough (one plan call, zero
 * extra cost, confidence 1). A caller opts into N× cost by passing runs >= 2,
 * typically behind a Pro-plan / high-stakes flag.
 *
 * WIRING NOTE: the full driver path (runDesignDriver) is unchanged; this is the
 * documented opt-in seam. A route can adopt it by swapping its single
 * `planner.plan(brief)` for `planWithConfidence(planner, brief, opts)` and
 * surfacing `lowConfidenceFields` in its response — nothing downstream of the
 * plan needs to change.
 */

import { runSelfConsistent, type ProjectedFields } from '@/lib/ai/selfConsistency';
import type { DesignBrief, DesignPlan } from './types';
import type { DesignPlanner } from './planner';

/**
 * Project a DesignPlan into the KEY fields whose disagreement most changes the
 * meaning of the design: the plan name, part count, each part's primary body
 * feature kind (shapeId analogue) + body count, and each drawing dimension's
 * expected nominal (the principal dims). Numbers agree within the wrapper's
 * relative tolerance; enums/ids agree exactly.
 */
export function projectPlanFields(plan: DesignPlan): ProjectedFields {
  const out: ProjectedFields = {};
  out['name'] = plan.name;
  out['partCount'] = plan.parts.length;
  for (const part of plan.parts) {
    const primary = part.bodies[0];
    out[`part:${part.partId}:feature`] = primary ? primary.feature.kind : null;
    out[`part:${part.partId}:bodyCount`] = part.bodies.length;
  }
  for (const dim of plan.drawing.dimensions) {
    out[`dim:${dim.id}:expected`] = dim.expected ?? null;
  }
  return out;
}

export interface PlanWithConfidenceOptions {
  /** Planner runs. Default 1 = no-op passthrough. >= 2 opts into self-consistency. */
  runs?: number;
  /** Agreement threshold; a key field below it is flagged. Default 0.8. */
  agreement?: number;
  /** Relative numeric tolerance. Default 0.01 (1%). */
  numericTolerance?: number;
}

export interface PlanWithConfidenceResult {
  /** The medoid run's plan (already coerced + preflighted by the planner). */
  plan: DesignPlan;
  /** key field → cross-run agreement ratio in [0,1]. */
  confidence: Record<string, number>;
  /** key fields the runs disagreed on (below threshold) — warn the user. */
  lowConfidenceFields: string[];
  /** How many planner runs actually executed. */
  runsUsed: number;
}

/**
 * Run `planner.plan(brief)` with self-consistency and attach per-key
 * confidence. At runs=1 this is a strict no-op (one call). The planner's
 * coerce/preflight gate runs on every attempt; if a run is refused it throws
 * `PlannerError`, which propagates (the caller decides fallback) — a partial
 * vote would understate disagreement.
 */
export async function planWithConfidence(
  planner: DesignPlanner,
  brief: DesignBrief,
  opts: PlanWithConfidenceOptions = {},
): Promise<PlanWithConfidenceResult> {
  // planner.plan may be sync or async — normalise to a promise per run.
  const sc = await runSelfConsistent<DesignPlan>(() => Promise.resolve(planner.plan(brief)), {
    runs: opts.runs ?? 1,
    agreement: opts.agreement ?? 0.8,
    numericTolerance: opts.numericTolerance ?? 0.01,
    project: projectPlanFields,
  });
  return {
    plan: sc.value,
    confidence: sc.confidence,
    lowConfidenceFields: sc.lowConfidenceFields,
    runsUsed: sc.runsUsed,
  };
}
