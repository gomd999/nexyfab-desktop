// ─── Parametric Sweep / DOE (Design of Experiments) ──────────────────────────
// Full-factorial or Latin Hypercube Sampling for parameter exploration.
// Evaluates an objective across all combinations and ranks parameter sensitivity.

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface SweepParam {
  name: string;
  min: number;
  max: number;
  steps: number; // number of discrete levels (>=2)
}

export type SweepObjective = 'volume' | 'surfaceArea' | 'mass' | 'maxStress';

export interface SweepConfig {
  params: SweepParam[];
  objective: SweepObjective;
}

export interface SweepResult {
  combinations: Record<string, number>[];
  values: number[];
  bestIdx: number;               // index of minimum objective value
  sensitivityRanking: string[];   // param names sorted by descending impact
}

export interface SensitivityEntry {
  param: string;
  delta: number;   // absolute change in objective across param range
  low: number;     // objective value when param is at min
  high: number;    // objective value when param is at max
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */

/** Generate linearly-spaced values between min and max (inclusive). */
function linspace(min: number, max: number, n: number): number[] {
  if (n <= 1) return [min];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(min + (max - min) * (i / (n - 1)));
  }
  return out;
}

/** Full factorial: cartesian product of all parameter levels. */
function fullFactorial(params: SweepParam[]): Record<string, number>[] {
  const levels = params.map(p => linspace(p.min, p.max, p.steps));
  const results: Record<string, number>[] = [];
  const counts = levels.map(l => l.length);
  const total = counts.reduce((a, b) => a * b, 1);

  for (let i = 0; i < total; i++) {
    const combo: Record<string, number> = {};
    let idx = i;
    for (let j = params.length - 1; j >= 0; j--) {
      const levelIdx = idx % counts[j];
      combo[params[j].name] = levels[j][levelIdx];
      idx = Math.floor(idx / counts[j]);
    }
    results.push(combo);
  }
  return results;
}

/**
 * Latin Hypercube Sampling — used when full-factorial would exceed `maxSamples`.
 * Each parameter range is divided into `n` equal strata; exactly one sample per stratum.
 */
function latinHypercube(params: SweepParam[], n: number): Record<string, number>[] {
  const results: Record<string, number>[] = [];
  // For each param, create a shuffled permutation of strata indices
  const permutations: number[][] = params.map(() => {
    const arr = Array.from({ length: n }, (_, i) => i);
    // Fisher-Yates shuffle
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  });

  for (let i = 0; i < n; i++) {
    const combo: Record<string, number> = {};
    for (let p = 0; p < params.length; p++) {
      const stratum = permutations[p][i];
      // Random point within the stratum
      const lo = params[p].min + (params[p].max - params[p].min) * (stratum / n);
      const hi = params[p].min + (params[p].max - params[p].min) * ((stratum + 1) / n);
      combo[params[p].name] = lo + Math.random() * (hi - lo);
    }
    results.push(combo);
  }
  return results;
}

/* ── Core sweep runner ─────────────────────────────────────────────────────── */

const FULL_FACTORIAL_LIMIT = 100;

/**
 * Run a parametric sweep.
 * @param config  Sweep configuration (params + objective type).
 * @param evalFn  Function that evaluates the objective for a given set of parameter values.
 * @param onProgress  Optional callback (completed, total) for progress tracking.
 * @returns SweepResult with all combinations, values, best index, and sensitivity ranking.
 */
export function runParametricSweep(
  config: SweepConfig,
  evalFn: (params: Record<string, number>) => number,
  onProgress?: (completed: number, total: number) => void,
): SweepResult {
  const { params } = config;

  // Determine total full-factorial count
  const ffCount = params.reduce((acc, p) => acc * Math.max(p.steps, 2), 1);
  const useLHS = ffCount > FULL_FACTORIAL_LIMIT;

  const combinations = useLHS
    ? latinHypercube(params, FULL_FACTORIAL_LIMIT)
    : fullFactorial(params);

  const values: number[] = [];
  for (let i = 0; i < combinations.length; i++) {
    values.push(evalFn(combinations[i]));
    onProgress?.(i + 1, combinations.length);
  }

  // Find best (minimum objective)
  let bestIdx = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[bestIdx]) bestIdx = i;
  }

  const sensitivity = computeSensitivity({ combinations, values, bestIdx, sensitivityRanking: [] }, params);
  const sensitivityRanking = sensitivity
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .map(s => s.param);

  return { combinations, values, bestIdx, sensitivityRanking };
}

/* ── Sensitivity analysis (tornado diagram data) ───────────────────────────── */

/**
 * Compute sensitivity for each parameter: how much the objective changes
 * when the parameter moves from its min to its max while others are at their median.
 * Returns tornado-diagram-ready data.
 */
export function computeSensitivity(
  results: SweepResult,
  params: SweepParam[],
): SensitivityEntry[] {
  const { combinations, values } = results;
  if (combinations.length === 0 || params.length === 0) return [];

  const entries: SensitivityEntry[] = [];

  for (const param of params) {
    // Split combinations into "low" and "high" bins for this parameter
    const midpoint = (param.min + param.max) / 2;

    const lowValues: number[] = [];
    const highValues: number[] = [];

    for (let i = 0; i < combinations.length; i++) {
      const pv = combinations[i][param.name];
      if (pv === undefined) continue;
      if (pv <= midpoint) {
        lowValues.push(values[i]);
      } else {
        highValues.push(values[i]);
      }
    }

    const avgLow = lowValues.length > 0
      ? lowValues.reduce((a, b) => a + b, 0) / lowValues.length
      : 0;
    const avgHigh = highValues.length > 0
      ? highValues.reduce((a, b) => a + b, 0) / highValues.length
      : 0;

    entries.push({
      param: param.name,
      delta: avgHigh - avgLow,
      low: avgLow,
      high: avgHigh,
    });
  }

  return entries;
}
