/**
 * inverseProblem.ts — Target-driven design parameter optimizer.
 *
 * "Find the bracket dimensions that hold ≥ 50 N at 1mm deflection,
 * weigh ≤ 200g, and survive 10⁶ load cycles." The customer states
 * a target; this module searches the parameter space to match it.
 *
 * Mathematically: minimize ||f(p) - target||² where `p` is the
 * parameter vector and `f(p)` is a black-box CAD-eval-FEA pipeline.
 *
 * Algorithms:
 *
 *   - **Nelder-Mead simplex** — gradient-free, robust on noisy
 *     simulations. Default.
 *   - **Random search** — baseline; warm-starts the simplex.
 *   - **Coordinate descent** — for high-dimensional easy problems.
 *
 * Output: best parameter set + objective history (for the UI to
 * draw the optimization trace).
 */

export interface Parameter {
  id: string;
  /** Lower bound. */
  min: number;
  /** Upper bound. */
  max: number;
  /** Initial guess. */
  initial?: number;
}

export interface ObjectiveTerm {
  /** Name (for reports). */
  name: string;
  /** Target value. */
  target: number;
  /** Weight in the loss. Default 1. */
  weight?: number;
  /** Penalty when current > target (e.g. weight constraint). */
  penaltyAboveTarget?: number;
  /** Penalty when current < target (e.g. minimum-yield constraint). */
  penaltyBelowTarget?: number;
}

export type EvaluateFunction = (params: Record<string, number>) => Record<string, number>;

export interface SolverOptions {
  /** Algorithm. */
  algorithm: 'nelder-mead' | 'random-search' | 'coordinate-descent';
  /** Max evaluations. */
  maxEvaluations: number;
  /** Convergence tolerance on objective. */
  tolerance: number;
  /** Random seed. */
  seed?: number;
}

export const DEFAULT_SOLVER_OPTIONS: SolverOptions = {
  algorithm: 'nelder-mead',
  maxEvaluations: 200,
  tolerance: 1e-4,
};

export interface SolveResult {
  /** Best parameters found. */
  bestParameters: Record<string, number>;
  /** Final objective value. */
  bestObjective: number;
  /** Whether tolerance was reached. */
  converged: boolean;
  /** Number of `evaluate` calls. */
  evaluations: number;
  /** Per-evaluation objective trace. */
  history: Array<{ objective: number; params: Record<string, number> }>;
}

// ── Top-level entry ─────────────────────────────────────────────

export function solveInverse(
  parameters: Parameter[],
  objectives: ObjectiveTerm[],
  evaluate: EvaluateFunction,
  options: Partial<SolverOptions> = {},
): SolveResult {
  const opts = { ...DEFAULT_SOLVER_OPTIONS, ...options };
  const initial = initialPoint(parameters);
  const lossFn = (p: number[]) => evaluateLoss(parameters, p, objectives, evaluate);

  switch (opts.algorithm) {
    case 'nelder-mead':
      return nelderMead(parameters, initial, lossFn, opts);
    case 'random-search':
      return randomSearch(parameters, lossFn, opts);
    case 'coordinate-descent':
      return coordinateDescent(parameters, initial, lossFn, opts);
  }
}

function initialPoint(parameters: Parameter[]): number[] {
  return parameters.map(p => p.initial ?? (p.min + p.max) / 2);
}

function evaluateLoss(
  parameters: Parameter[],
  point: number[],
  objectives: ObjectiveTerm[],
  evaluate: EvaluateFunction,
): { loss: number; observed: Record<string, number> } {
  const params: Record<string, number> = {};
  for (let i = 0; i < parameters.length; i++) {
    const clamped = Math.max(parameters[i]!.min, Math.min(parameters[i]!.max, point[i]!));
    params[parameters[i]!.id] = clamped;
  }
  const observed = evaluate(params);
  let loss = 0;
  for (const obj of objectives) {
    const value = observed[obj.name] ?? 0;
    const weight = obj.weight ?? 1;
    const delta = value - obj.target;
    loss += weight * delta * delta;
    if (obj.penaltyAboveTarget && value > obj.target) loss += obj.penaltyAboveTarget * (value - obj.target) ** 2;
    if (obj.penaltyBelowTarget && value < obj.target) loss += obj.penaltyBelowTarget * (obj.target - value) ** 2;
  }
  return { loss, observed };
}

// ── Nelder-Mead ────────────────────────────────────────────────

function nelderMead(
  parameters: Parameter[],
  initial: number[],
  lossFn: (p: number[]) => { loss: number; observed: Record<string, number> },
  opts: SolverOptions,
): SolveResult {
  const n = parameters.length;
  const alpha = 1.0;
  const gamma = 2.0;
  const rho = 0.5;
  const sigma = 0.5;

  const history: Array<{ objective: number; params: Record<string, number> }> = [];
  const recordEval = (point: number[], value: { loss: number; observed: Record<string, number> }): void => {
    const params: Record<string, number> = {};
    for (let i = 0; i < parameters.length; i++) {
      params[parameters[i]!.id] = Math.max(parameters[i]!.min, Math.min(parameters[i]!.max, point[i]!));
    }
    history.push({ objective: value.loss, params });
  };

  const simplex: Array<{ point: number[]; value: number }> = [];
  // Seed: initial + small perturbations along each axis.
  const range = parameters.map(p => (p.max - p.min) * 0.05);
  simplex.push({ point: initial.slice(), value: 0 });
  for (let i = 0; i < n; i++) {
    const perturbed = initial.slice();
    perturbed[i] += range[i] ?? 0.1;
    simplex.push({ point: perturbed, value: 0 });
  }
  for (const s of simplex) {
    const v = lossFn(s.point);
    s.value = v.loss;
    recordEval(s.point, v);
  }

  let evals = simplex.length;
  while (evals < opts.maxEvaluations) {
    simplex.sort((a, b) => a.value - b.value);
    if (simplex[0]!.value < opts.tolerance) break;

    // Centroid of all but worst (simplex has n+1 points; take 0..n-1).
    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) centroid[j] += simplex[i]!.point[j]!;
    }
    for (let j = 0; j < n; j++) centroid[j] /= n;

    const worst = simplex[n]!;
    // Reflect.
    const reflected = centroid.map((c, j) => c + alpha * (c - worst.point[j]!));
    const rEval = lossFn(reflected); evals++;
    recordEval(reflected, rEval);
    if (rEval.loss < simplex[0]!.value) {
      // Expand.
      const expanded = centroid.map((c, j) => c + gamma * (reflected[j]! - c));
      const eEval = lossFn(expanded); evals++;
      recordEval(expanded, eEval);
      worst.point = eEval.loss < rEval.loss ? expanded : reflected;
      worst.value = eEval.loss < rEval.loss ? eEval.loss : rEval.loss;
    } else if (rEval.loss < simplex[n - 1]!.value) {
      worst.point = reflected;
      worst.value = rEval.loss;
    } else {
      // Contract.
      const contracted = centroid.map((c, j) => c + rho * (worst.point[j]! - c));
      const cEval = lossFn(contracted); evals++;
      recordEval(contracted, cEval);
      if (cEval.loss < worst.value) {
        worst.point = contracted;
        worst.value = cEval.loss;
      } else {
        // Shrink.
        const best = simplex[0]!;
        for (let i = 1; i < simplex.length; i++) {
          const shrunk = best.point.map((b, j) => b + sigma * (simplex[i]!.point[j]! - b));
          const sEval = lossFn(shrunk); evals++;
          recordEval(shrunk, sEval);
          simplex[i] = { point: shrunk, value: sEval.loss };
        }
      }
    }
  }

  simplex.sort((a, b) => a.value - b.value);
  const best = simplex[0]!;
  const bestParams: Record<string, number> = {};
  for (let i = 0; i < parameters.length; i++) {
    bestParams[parameters[i]!.id] = Math.max(parameters[i]!.min, Math.min(parameters[i]!.max, best.point[i]!));
  }
  return {
    bestParameters: bestParams,
    bestObjective: best.value,
    converged: best.value < opts.tolerance,
    evaluations: evals,
    history,
  };
}

// ── Random search ──────────────────────────────────────────────

function randomSearch(
  parameters: Parameter[],
  lossFn: (p: number[]) => { loss: number; observed: Record<string, number> },
  opts: SolverOptions,
): SolveResult {
  const rng = makeRng(opts.seed);
  const history: Array<{ objective: number; params: Record<string, number> }> = [];
  let bestPoint: number[] | null = null;
  let bestValue = Infinity;
  for (let i = 0; i < opts.maxEvaluations; i++) {
    const point = parameters.map(p => p.min + rng() * (p.max - p.min));
    const v = lossFn(point);
    const params: Record<string, number> = {};
    for (let k = 0; k < parameters.length; k++) params[parameters[k]!.id] = point[k]!;
    history.push({ objective: v.loss, params });
    if (v.loss < bestValue) {
      bestPoint = point;
      bestValue = v.loss;
    }
    if (bestValue < opts.tolerance) break;
  }
  const bestParams: Record<string, number> = {};
  if (bestPoint) for (let i = 0; i < parameters.length; i++) bestParams[parameters[i]!.id] = bestPoint[i]!;
  return {
    bestParameters: bestParams,
    bestObjective: bestValue,
    converged: bestValue < opts.tolerance,
    evaluations: history.length,
    history,
  };
}

// ── Coordinate descent ─────────────────────────────────────────

function coordinateDescent(
  parameters: Parameter[],
  initial: number[],
  lossFn: (p: number[]) => { loss: number; observed: Record<string, number> },
  opts: SolverOptions,
): SolveResult {
  const point = initial.slice();
  const history: Array<{ objective: number; params: Record<string, number> }> = [];
  let evals = 0;
  let bestValue = lossFn(point).loss;
  evals++;
  history.push({ objective: bestValue, params: paramsOf(parameters, point) });

  while (evals < opts.maxEvaluations) {
    let improved = false;
    for (let i = 0; i < parameters.length; i++) {
      const range = parameters[i]!.max - parameters[i]!.min;
      const step = range * 0.1;
      // Try + and - step.
      for (const delta of [step, -step]) {
        const trial = point.slice();
        trial[i] = Math.max(parameters[i]!.min, Math.min(parameters[i]!.max, trial[i]! + delta));
        const v = lossFn(trial);
        evals++;
        history.push({ objective: v.loss, params: paramsOf(parameters, trial) });
        if (v.loss < bestValue) {
          bestValue = v.loss;
          point[i] = trial[i]!;
          improved = true;
        }
        if (evals >= opts.maxEvaluations) break;
      }
      if (evals >= opts.maxEvaluations) break;
    }
    if (!improved) break;
    if (bestValue < opts.tolerance) break;
  }

  return {
    bestParameters: paramsOf(parameters, point),
    bestObjective: bestValue,
    converged: bestValue < opts.tolerance,
    evaluations: evals,
    history,
  };
}

function paramsOf(parameters: Parameter[], point: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < parameters.length; i++) {
    out[parameters[i]!.id] = Math.max(parameters[i]!.min, Math.min(parameters[i]!.max, point[i]!));
  }
  return out;
}

// ── RNG ─────────────────────────────────────────────────────────

function makeRng(seed?: number): () => number {
  let s = seed ?? Math.floor(Math.random() * 2 ** 31);
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// ── Sensitivity around best point ──────────────────────────────

export interface SensitivityRow {
  parameter: string;
  /** Loss change per unit parameter change (numerical derivative). */
  gradient: number;
  /** Relative impact (gradient × parameter range). */
  relativeImpact: number;
}

export function sensitivity(
  bestParams: Record<string, number>,
  parameters: Parameter[],
  evaluate: EvaluateFunction,
  objectives: ObjectiveTerm[],
): SensitivityRow[] {
  const baselinePoint = parameters.map(p => bestParams[p.id] ?? (p.min + p.max) / 2);
  const baseline = evaluateLoss(parameters, baselinePoint, objectives, evaluate).loss;
  const rows: SensitivityRow[] = [];
  for (let i = 0; i < parameters.length; i++) {
    const p = parameters[i]!;
    const range = p.max - p.min;
    const step = range * 0.01;
    const point = baselinePoint.slice();
    point[i] = Math.min(p.max, point[i]! + step);
    const bumped = evaluateLoss(parameters, point, objectives, evaluate).loss;
    const grad = (bumped - baseline) / step;
    rows.push({
      parameter: p.id,
      gradient: grad,
      relativeImpact: grad * range,
    });
  }
  return rows;
}
