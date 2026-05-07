/**
 * 1-D Tolerance Stack Analyzer
 *
 * Supports two methods:
 *   - Worst-Case (WC):  nominal = Σ nᵢ,   tol = Σ |tᵢ|
 *   - Root-Sum-Square (RSS): tol = √Σ tᵢ²   (statistical, assumes ±3σ = ±t)
 *
 * Each entry is a signed contribution to the stack (add / subtract chain).
 * Asymmetric tolerances are supported via `upper`/`lower`; if only one is
 * given we treat the tolerance as symmetric `±t`.
 */

export type StackDirection = 'add' | 'subtract';

export interface ToleranceStackEntry {
  id: string;
  label: string;              // human-readable name (e.g. "Plate thickness")
  nominal: number;            // mm
  upper: number;              // upper deviation (e.g. +0.05 → 0.05)
  lower: number;              // lower deviation (e.g. -0.02 → 0.02, stored positive)
  direction: StackDirection;  // add or subtract in the loop
  /** Optional reference — dimension id, GDT id, or drawing callout */
  ref?: string;
}

export interface StackResult {
  method: 'WC' | 'RSS';
  nominal: number;            // signed sum of nominals
  upperTol: number;           // total upward tolerance
  lowerTol: number;           // total downward tolerance
  min: number;                // worst-case minimum = nominal - lowerTol
  max: number;                // worst-case maximum = nominal + upperTol
  /** Per-entry sensitivity (contribution share of total tolerance) */
  contributions: Array<{ id: string; label: string; share: number; value: number }>;
}

/** Worst-case stack — simple arithmetic sum of signed tolerances */
export function analyzeWC(entries: ToleranceStackEntry[]): StackResult {
  let nominal = 0, upper = 0, lower = 0;
  const contribs: StackResult['contributions'] = [];

  for (const e of entries) {
    const sign = e.direction === 'add' ? 1 : -1;
    nominal += sign * e.nominal;
    // When reversing direction, upper↔lower swap
    if (sign > 0) { upper += e.upper; lower += e.lower; }
    else          { upper += e.lower; lower += e.upper; }
    const tot = Math.abs(e.upper) + Math.abs(e.lower);
    contribs.push({ id: e.id, label: e.label, share: tot, value: tot });
  }

  const totalTol = upper + lower;
  for (const c of contribs) c.share = totalTol > 0 ? c.value / totalTol : 0;

  return {
    method: 'WC',
    nominal,
    upperTol: upper,
    lowerTol: lower,
    min: nominal - lower,
    max: nominal + upper,
    contributions: contribs.sort((a, b) => b.share - a.share),
  };
}

/**
 * Root-sum-square stack — assumes each ±tᵢ represents ±3σᵢ (Cp=1.0).
 * Combined tolerance = √Σ tᵢ². Asymmetric tolerances are folded to
 * symmetric equivalent tᵢ = (upperᵢ + lowerᵢ)/2 and shifted mean by the
 * bias (upperᵢ − lowerᵢ)/2.
 */
export function analyzeRSS(entries: ToleranceStackEntry[]): StackResult {
  let nominal = 0;
  let sumSq = 0;
  const contribs: StackResult['contributions'] = [];

  for (const e of entries) {
    const sign = e.direction === 'add' ? 1 : -1;
    const bias = (e.upper - e.lower) / 2;  // signed shift from nominal
    const sym  = (e.upper + e.lower) / 2;  // symmetric half-width
    nominal += sign * (e.nominal + bias);
    sumSq += sym * sym;
    contribs.push({ id: e.id, label: e.label, share: 0, value: sym * sym });
  }

  const combined = Math.sqrt(sumSq);
  const totalSq = sumSq;
  for (const c of contribs) c.share = totalSq > 0 ? c.value / totalSq : 0;

  return {
    method: 'RSS',
    nominal,
    upperTol: combined,
    lowerTol: combined,
    min: nominal - combined,
    max: nominal + combined,
    contributions: contribs.sort((a, b) => b.share - a.share),
  };
}

/** Cp process capability index given a stack result against a spec window */
export function processCapability(result: StackResult, specWindow: { lsl: number; usl: number }, sigma: number): number {
  if (sigma <= 0) return Infinity;
  const { lsl, usl } = specWindow;
  return (usl - lsl) / (6 * sigma);
}

/** Convert ISO 2768 class to numeric tolerance for a given nominal size */
export function iso2768LinearTolerance(nominal: number, cls: 'f' | 'm' | 'c' | 'v'): number {
  const n = Math.abs(nominal);
  // ISO 2768-1 linear dimensions — tolerance in mm for each range
  const table: Record<'f' | 'm' | 'c' | 'v', Array<[number, number]>> = {
    f: [[3, 0.05], [6, 0.05], [30, 0.1], [120, 0.15], [400, 0.2], [1000, 0.3], [2000, 0.5]],
    m: [[3, 0.1],  [6, 0.1],  [30, 0.2], [120, 0.3],  [400, 0.5], [1000, 0.8], [2000, 1.2]],
    c: [[3, 0.2],  [6, 0.3],  [30, 0.5], [120, 0.8],  [400, 1.2], [1000, 2.0], [2000, 3.0]],
    v: [[3, 0.3],  [6, 0.5],  [30, 1.0], [120, 1.5],  [400, 2.5], [1000, 4.0], [2000, 6.0]],
  };
  for (const [upper, tol] of table[cls]) {
    if (n <= upper) return tol;
  }
  const last = table[cls][table[cls].length - 1];
  return last[1];
}
