/**
 * bucklingLoadExtrapolator.ts — Extrapolate FEA buckling load factor
 * from a sequence of mesh-refined runs.
 *
 * Linear buckling analyses report the eigenvalue λ; the critical
 * load is P_cr = λ · P_applied. Coarse meshes over-estimate λ
 * (stiff), so finer meshes give a smaller, more accurate λ that
 * asymptotically approaches the true critical load.
 *
 * Richardson extrapolation (constant exponent p = 2 for linear
 * elements):
 *
 *   λ_extrap ≈ λ_h − (λ_h − λ_h/2) / (2^p − 1)
 *
 * Module:
 *   - Accepts ≥ 2 (mesh-size, λ) pairs.
 *   - Applies Richardson extrapolation for adjacent refinements.
 *   - Fits linear regression of λ vs 1/N (DOF count) for ≥ 3 pairs.
 *   - Reports convergence rate and recommends additional refinement
 *     if the rate falls below threshold.
 */

export interface BucklingRun {
  /** Characteristic element size (mm) or 1/DOF. */
  meshSize: number;
  /** Number of degrees of freedom in the mesh. */
  dofCount: number;
  /** Buckling load factor returned by solver. */
  loadFactor: number;
}

export interface ExtrapolationOptions {
  /** Exponent in Richardson formula (2 for linear elem, 4 for quadratic). */
  convergenceOrder: number;
  /** Threshold on relative change between runs to consider converged. */
  convergenceTolerance: number;
}

export const DEFAULT_OPTIONS: ExtrapolationOptions = {
  convergenceOrder: 2,
  convergenceTolerance: 0.02,
};

export interface ExtrapolationResult {
  /** Extrapolated buckling load factor. */
  extrapolatedLoadFactor: number;
  /** Per-step relative change. */
  relativeChanges: number[];
  /** Whether the trend appears converged. */
  converged: boolean;
  /** Estimated convergence rate (from log-log fit). */
  estimatedRate: number;
  /** Whether more refinement is recommended. */
  needsMoreRefinement: boolean;
}

// ── Top-level entry ────────────────────────────────────────────

export function extrapolateLoad(runs: BucklingRun[], options: Partial<ExtrapolationOptions> = {}): ExtrapolationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (runs.length === 0) {
    return { extrapolatedLoadFactor: 0, relativeChanges: [], converged: false, estimatedRate: 0, needsMoreRefinement: true };
  }
  if (runs.length === 1) {
    return {
      extrapolatedLoadFactor: runs[0]!.loadFactor,
      relativeChanges: [],
      converged: false,
      estimatedRate: 0,
      needsMoreRefinement: true,
    };
  }
  // Sort runs by mesh size descending (coarsest first).
  const sorted = runs.slice().sort((a, b) => b.meshSize - a.meshSize);
  const relativeChanges: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!.loadFactor;
    const cur = sorted[i]!.loadFactor;
    relativeChanges.push((cur - prev) / Math.max(1e-12, Math.abs(prev)));
  }
  // Richardson from last two values (Roache form):
  //   φ_extrap = φ_fine + (φ_fine − φ_coarse) / (r^p − 1)
  const last = sorted[sorted.length - 1]!.loadFactor;  // fine
  const second = sorted[sorted.length - 2]!.loadFactor; // coarse
  const factor = Math.pow(2, opts.convergenceOrder) - 1;
  const extrapolated = last + (last - second) / factor;

  // Convergence rate from log-log fit if ≥ 3 runs.
  let rate = 0;
  if (sorted.length >= 3) {
    rate = estimateRate(sorted, extrapolated);
  }
  const lastRelChange = Math.abs(relativeChanges[relativeChanges.length - 1]!);
  const converged = lastRelChange <= opts.convergenceTolerance;
  return {
    extrapolatedLoadFactor: extrapolated,
    relativeChanges,
    converged,
    estimatedRate: rate,
    needsMoreRefinement: !converged && lastRelChange > opts.convergenceTolerance * 2,
  };
}

function estimateRate(sorted: BucklingRun[], extrapolated: number): number {
  // log|λ - λ_inf| vs log(meshSize). Slope = convergence order.
  const points: { x: number; y: number }[] = [];
  for (const run of sorted) {
    const err = Math.abs(run.loadFactor - extrapolated);
    if (err <= 0) continue;
    points.push({ x: Math.log(run.meshSize), y: Math.log(err) });
  }
  if (points.length < 2) return 0;
  return linearRegression(points);
}

function linearRegression(points: { x: number; y: number }[]): number {
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

// ── Verification: confidence on extrapolated value ────────────

export interface Confidence {
  /** GCI (grid convergence index) per Roache. */
  gci: number;
  /** Whether GCI < 5% (acceptable per ASME V&V20). */
  acceptable: boolean;
}

export function gridConvergenceIndex(runs: BucklingRun[], orderOverride?: number): Confidence {
  if (runs.length < 2) return { gci: 1, acceptable: false };
  const sorted = runs.slice().sort((a, b) => b.meshSize - a.meshSize);
  const last = sorted[sorted.length - 1]!;
  const second = sorted[sorted.length - 2]!;
  const r = second.meshSize / last.meshSize;
  const p = orderOverride ?? 2;
  const relativeError = Math.abs((last.loadFactor - second.loadFactor) / Math.max(1e-12, last.loadFactor));
  // Roache safety factor 1.25 for systematic refinement.
  const gci = (1.25 * relativeError) / Math.max(1e-12, Math.pow(r, p) - 1);
  return { gci, acceptable: gci < 0.05 };
}

// ── Safe load recommendation ──────────────────────────────────

export interface SafetyFactor {
  factor: number;
  /** Recommended allowable load = extrapolated / factor. */
  allowableLoad: number;
}

export function recommendedSafetyFactor(extrapolatedLoad: number, gci: number): SafetyFactor {
  // Base factor 1.5, plus the GCI uncertainty.
  const factor = 1.5 + 5 * gci;
  return { factor, allowableLoad: extrapolatedLoad / factor };
}

// ── Summary ────────────────────────────────────────────────────

export interface BucklingSummary {
  runCount: number;
  extrapolatedLoadFactor: number;
  converged: boolean;
  estimatedRate: number;
}

export function summarize(runs: BucklingRun[], result: ExtrapolationResult): BucklingSummary {
  return {
    runCount: runs.length,
    extrapolatedLoadFactor: result.extrapolatedLoadFactor,
    converged: result.converged,
    estimatedRate: result.estimatedRate,
  };
}
