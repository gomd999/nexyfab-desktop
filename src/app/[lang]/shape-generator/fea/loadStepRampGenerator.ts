/**
 * loadStepRampGenerator.ts — Generate a nonlinear FEA load-step ramp.
 *
 * Nonlinear solvers (large deformation, contact, plasticity) need
 * the external load applied gradually over substeps. Too aggressive
 * → no convergence. Too gentle → wasted compute.
 *
 * Common ramp profiles:
 *
 *   - Linear: t goes 0 → 1 by Δt.
 *   - Quadratic: Δt grows as step² (small at start).
 *   - Exponential: Δt = α^n; useful when contact engagement is
 *     concentrated at small t.
 *   - Adaptive: solver feedback (last step converged in N iterations)
 *     drives Δt up (fewer iter) or down (>= max iter).
 *
 * Module emits a list of substep load fractions + estimated solver
 * cost.
 */

export type RampProfile = 'linear' | 'quadratic' | 'exponential' | 'adaptive';

export interface RampOptions {
  profile: RampProfile;
  /** Initial substep size as fraction of total load. */
  initialDt: number;
  /** Minimum substep size (floor). */
  minDt: number;
  /** Maximum substep size (ceiling). */
  maxDt: number;
  /** Maximum iterations per substep before cut. */
  maxNewtonIterations: number;
  /** For exponential profile: base. */
  exponentialBase: number;
}

export const DEFAULT_OPTIONS: RampOptions = {
  profile: 'linear',
  initialDt: 0.1,
  minDt: 0.001,
  maxDt: 0.5,
  maxNewtonIterations: 12,
  exponentialBase: 1.5,
};

export interface SubstepFeedback {
  step: number;
  loadFraction: number;
  iterationsUsed: number;
  converged: boolean;
}

export interface RampPlan {
  /** Pre-computed substep load fractions (between 0 and 1). */
  substepLoadFractions: number[];
  totalSubsteps: number;
  estimatedCostScore: number;
}

// ── Top-level entry: pre-compute the ramp ──────────────────────

export function generateRamp(options: Partial<RampOptions> = {}): RampPlan {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const substeps: number[] = [];
  let t = 0;
  let dt = opts.initialDt;
  while (t < 1) {
    dt = clampDt(dt, opts);
    t = Math.min(1, t + dt);
    substeps.push(t);
    dt = updateDtFromProfile(opts.profile, dt, opts);
  }
  if (substeps.length === 0 || substeps[substeps.length - 1]! < 1) substeps.push(1);
  return {
    substepLoadFractions: substeps,
    totalSubsteps: substeps.length,
    estimatedCostScore: substeps.length * 1.0,
  };
}

function clampDt(dt: number, opts: RampOptions): number {
  return Math.min(opts.maxDt, Math.max(opts.minDt, dt));
}

function updateDtFromProfile(profile: RampProfile, dt: number, opts: RampOptions): number {
  switch (profile) {
    case 'linear': return dt;
    case 'quadratic': return dt * 1.3;
    case 'exponential': return dt * opts.exponentialBase;
    case 'adaptive': return dt;  // adaptive driven by feedback below
  }
}

// ── Adaptive: re-tune dt from solver feedback ─────────────────

export interface AdaptiveState {
  history: SubstepFeedback[];
  currentDt: number;
  /** Cumulative load applied so far. */
  cumulativeLoad: number;
}

export function initAdaptive(options: Partial<RampOptions> = {}): AdaptiveState {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return { history: [], currentDt: opts.initialDt, cumulativeLoad: 0 };
}

export function nextSubstep(state: AdaptiveState, lastFeedback: SubstepFeedback | null, options: Partial<RampOptions> = {}): number {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (lastFeedback) state.history.push(lastFeedback);
  if (lastFeedback && !lastFeedback.converged) {
    state.currentDt = Math.max(opts.minDt, state.currentDt / 2);
  } else if (lastFeedback && lastFeedback.iterationsUsed <= opts.maxNewtonIterations / 2) {
    state.currentDt = Math.min(opts.maxDt, state.currentDt * 1.5);
  } else if (lastFeedback && lastFeedback.iterationsUsed >= opts.maxNewtonIterations) {
    state.currentDt = Math.max(opts.minDt, state.currentDt * 0.5);
  }
  const next = Math.min(1, state.cumulativeLoad + state.currentDt);
  state.cumulativeLoad = next;
  return next;
}

// ── Recommended ramp for a given problem class ────────────────

export type ProblemClass = 'small-deformation' | 'large-deformation' | 'contact' | 'plastic' | 'thermal-coupled';

export function recommendProfile(problem: ProblemClass): RampProfile {
  switch (problem) {
    case 'small-deformation': return 'linear';
    case 'large-deformation': return 'quadratic';
    case 'contact': return 'adaptive';
    case 'plastic': return 'adaptive';
    case 'thermal-coupled': return 'quadratic';
  }
}

// ── Diagnostic on a completed ramp ────────────────────────────

export interface RampDiagnostic {
  totalSubsteps: number;
  divergedSubsteps: number;
  averageIterations: number;
  recommendation: string;
}

export function diagnoseRamp(history: SubstepFeedback[]): RampDiagnostic {
  let diverged = 0;
  let totalIter = 0;
  for (const f of history) {
    if (!f.converged) diverged++;
    totalIter += f.iterationsUsed;
  }
  const avg = history.length === 0 ? 0 : totalIter / history.length;
  let recommendation = 'No issues.';
  if (diverged > history.length * 0.2) recommendation = 'High divergence rate: reduce initialDt or switch to adaptive.';
  else if (avg > 8) recommendation = 'Average iterations high: consider quadratic / exponential ramp.';
  else if (avg < 3 && history.length > 20) recommendation = 'Solver underutilised: increase maxDt.';
  return {
    totalSubsteps: history.length,
    divergedSubsteps: diverged,
    averageIterations: avg,
    recommendation,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface RampSummary {
  profile: RampProfile;
  totalSubsteps: number;
  finalLoad: number;
}

export function summarize(plan: RampPlan, profile: RampProfile): RampSummary {
  return {
    profile,
    totalSubsteps: plan.totalSubsteps,
    finalLoad: plan.substepLoadFractions[plan.substepLoadFractions.length - 1] ?? 0,
  };
}
