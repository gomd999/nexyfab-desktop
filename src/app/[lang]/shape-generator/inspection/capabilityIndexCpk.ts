/**
 * capabilityIndexCpk.ts — Compute process capability indices Cp, Cpk,
 * Pp, Ppk from a sample of measurements.
 *
 * Definitions (AIAG SPC):
 *
 *   Cp  = (USL − LSL) / (6·σ_within)   — potential capability
 *   Cpk = min(USL − μ, μ − LSL) / (3·σ_within)
 *   Pp  = (USL − LSL) / (6·σ_overall)  — overall performance
 *   Ppk = min(USL − μ, μ − LSL) / (3·σ_overall)
 *
 *   σ_within  = σ̂ from subgroup ranges (R̄ / d2)
 *   σ_overall = sample standard deviation
 *
 * Thresholds (industry convention):
 *
 *   Cpk ≥ 1.67 → 6σ-class capability
 *   Cpk ≥ 1.33 → adequate
 *   Cpk ≥ 1.00 → marginal
 *   Cpk < 1.00 → not capable
 *
 * Module:
 *   - Accepts measurements grouped into subgroups (subgroup size m).
 *   - Computes Cp, Cpk, Pp, Ppk.
 *   - Reports classification.
 */

/** AIAG d2 constant for subgroup size m (2..10). */
export const D2_TABLE: Record<number, number> = {
  2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847, 9: 2.970, 10: 3.078,
};

export interface CapabilityInput {
  /** Subgroups of measurements (each subgroup is an array of values). */
  subgroups: number[][];
  /** Upper specification limit. */
  usl: number;
  /** Lower specification limit. */
  lsl: number;
}

export type Classification = 'six-sigma' | 'adequate' | 'marginal' | 'not-capable';

export interface CapabilityResult {
  /** Mean of all measurements. */
  mean: number;
  /** Within-subgroup σ̂ (R̄ / d2). */
  sigmaWithin: number;
  /** Overall σ (sample stddev). */
  sigmaOverall: number;
  /** Centered process capability. */
  cp: number;
  /** Off-center capability. */
  cpk: number;
  /** Overall performance. */
  pp: number;
  /** Overall off-center performance. */
  ppk: number;
  classification: Classification;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function computeCapability(input: CapabilityInput): CapabilityResult {
  const warnings: string[] = [];
  const all = input.subgroups.flat();
  if (all.length === 0) {
    return {
      mean: 0, sigmaWithin: 0, sigmaOverall: 0,
      cp: 0, cpk: 0, pp: 0, ppk: 0,
      classification: 'not-capable',
      warnings: ['No measurements provided.'],
    };
  }

  const mean = all.reduce((s, v) => s + v, 0) / all.length;

  // Overall stddev (sample, n-1).
  let varAll = 0;
  for (const v of all) varAll += (v - mean) ** 2;
  const sigmaOverall = Math.sqrt(varAll / Math.max(1, all.length - 1));

  // Within-subgroup σ via average subgroup range / d2.
  const subgroupSizes = new Set(input.subgroups.map(s => s.length));
  if (subgroupSizes.size > 1) {
    warnings.push('Inconsistent subgroup sizes — within-σ estimate may be approximate.');
  }
  const m = input.subgroups.length > 0 ? input.subgroups[0]!.length : 1;
  const d2 = D2_TABLE[m] ?? 0;
  let sigmaWithin = sigmaOverall;
  if (m >= 2 && d2 > 0) {
    const ranges = input.subgroups.map(g => Math.max(...g) - Math.min(...g));
    const rbar = ranges.reduce((s, r) => s + r, 0) / ranges.length;
    sigmaWithin = rbar / d2;
  } else if (m === 1) {
    warnings.push('Single-measurement subgroups — within-σ falls back to overall σ.');
  }
  if (sigmaWithin === 0) {
    warnings.push('σ_within is zero (no variation in subgroup ranges).');
    sigmaWithin = sigmaOverall || 1e-9;
  }

  const tolWidth = input.usl - input.lsl;
  const cp = tolWidth / (6 * sigmaWithin);
  const cpk = Math.min(input.usl - mean, mean - input.lsl) / (3 * sigmaWithin);
  const pp = tolWidth / (6 * Math.max(sigmaOverall, 1e-12));
  const ppk = Math.min(input.usl - mean, mean - input.lsl) / (3 * Math.max(sigmaOverall, 1e-12));

  let classification: Classification;
  if (cpk >= 1.67) classification = 'six-sigma';
  else if (cpk >= 1.33) classification = 'adequate';
  else if (cpk >= 1.0) classification = 'marginal';
  else classification = 'not-capable';

  return { mean, sigmaWithin, sigmaOverall, cp, cpk, pp, ppk, classification, warnings };
}

// ── Off-center index Cpm (Taguchi) ────────────────────────────

export interface CpmInput extends CapabilityInput {
  /** Target value (typically (USL + LSL) / 2). */
  target: number;
}

export function computeCpm(input: CpmInput): number {
  const all = input.subgroups.flat();
  if (all.length === 0) return 0;
  const mean = all.reduce((s, v) => s + v, 0) / all.length;
  let varAll = 0;
  for (const v of all) varAll += (v - mean) ** 2;
  const sigma = Math.sqrt(varAll / Math.max(1, all.length - 1));
  const denom = Math.sqrt(sigma * sigma + (mean - input.target) ** 2);
  return (input.usl - input.lsl) / (6 * Math.max(1e-12, denom));
}

// ── Expected defects per million (DPMO) ──────────────────────

export function expectedDpmo(result: CapabilityResult, usl: number, lsl: number): number {
  // Use σ_overall for performance-level DPMO.
  const z1 = (usl - result.mean) / Math.max(1e-12, result.sigmaOverall);
  const z2 = (result.mean - lsl) / Math.max(1e-12, result.sigmaOverall);
  // Approximate Φ(z) using erf.
  const dpmo = (1 - phi(z1) + 1 - phi(z2)) * 1e6;
  return Math.max(0, dpmo);
}

function phi(z: number): number {
  // Abramowitz & Stegun 7.1.26 approximation.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804 * Math.exp(-z * z / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.821256 + t * 1.330274))));
  return z < 0 ? prob : 1 - prob;
}

// ── Summary ────────────────────────────────────────────────────

export interface CapabilitySummary {
  cp: number;
  cpk: number;
  ppk: number;
  classification: Classification;
  dpmo: number;
}

export function summarize(result: CapabilityResult, usl: number, lsl: number): CapabilitySummary {
  return {
    cp: result.cp,
    cpk: result.cpk,
    ppk: result.ppk,
    classification: result.classification,
    dpmo: expectedDpmo(result, usl, lsl),
  };
}
