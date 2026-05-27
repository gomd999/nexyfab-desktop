/**
 * spc.ts — Statistical Process Control for production runs.
 *
 * SPC tells you whether a manufacturing process is stable AND
 * capable. Two questions:
 *   - **Stable**: are measurements within control limits? (process
 *     in statistical control)
 *   - **Capable**: does the process produce parts within tolerance?
 *     (Cp, Cpk indices)
 *
 * Industry standard charts:
 *   - X-bar (mean of subgroup) + R (range) — most common
 *   - I-MR (individual + moving range) — for slow processes
 *
 * Capability indices:
 *   - Cp  = (USL − LSL) / (6σ)
 *   - Cpk = min((USL − μ) / (3σ), (μ − LSL) / (3σ))
 *
 * Industry "good" Cpk ≥ 1.33; "excellent" ≥ 1.67.
 */

export interface Measurement {
  /** Subgroup id — measurements in the same subgroup share the same id. */
  subgroupId: string;
  /** Measured value. */
  value: number;
  /** Optional timestamp. */
  t?: number;
}

export interface SpecLimits {
  lsl: number;
  usl: number;
  /** Target (nominal) value. */
  target?: number;
}

export interface CapabilityResult {
  mean: number;
  sigma: number;
  /** Process capability — ignoring centering. */
  cp: number;
  /** Process capability with centering. */
  cpk: number;
  /** True when Cpk ≥ 1.33 (industry standard). */
  isCapable: boolean;
}

/** Compute mean + sample standard deviation (n-1 normalisation). */
export function meanStd(values: number[]): { mean: number; sigma: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, sigma: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (n === 1) return { mean, sigma: 0 };
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return { mean, sigma: Math.sqrt(variance) };
}

export function processCapability(values: number[], spec: SpecLimits): CapabilityResult {
  const { mean, sigma } = meanStd(values);
  if (sigma === 0) {
    return { mean, sigma, cp: Infinity, cpk: Infinity, isCapable: true };
  }
  const cp = (spec.usl - spec.lsl) / (6 * sigma);
  const cpk = Math.min(
    (spec.usl - mean) / (3 * sigma),
    (mean - spec.lsl) / (3 * sigma),
  );
  return { mean, sigma, cp, cpk, isCapable: cpk >= 1.33 };
}

// ── Control charts ─────────────────────────────────────────────────

export interface ControlLimits {
  centerLine: number;
  upperControlLimit: number;
  lowerControlLimit: number;
}

/** X-bar control limits for subgrouped data.
 *  UCL = X̄̄ + A2 · R̄
 *  Where A2 depends on subgroup size n (table value). */
const A2_TABLE: Record<number, number> = {
  2: 1.880, 3: 1.023, 4: 0.729, 5: 0.577,
  6: 0.483, 7: 0.419, 8: 0.373, 9: 0.337, 10: 0.308,
};

const D3_TABLE: Record<number, number> = {
  2: 0, 3: 0, 4: 0, 5: 0,
  6: 0, 7: 0.076, 8: 0.136, 9: 0.184, 10: 0.223,
};
const D4_TABLE: Record<number, number> = {
  2: 3.267, 3: 2.575, 4: 2.282, 5: 2.115,
  6: 2.004, 7: 1.924, 8: 1.864, 9: 1.816, 10: 1.777,
};

export interface XbarRChartResult {
  subgroups: Array<{ id: string; mean: number; range: number; t?: number }>;
  xbarLimits: ControlLimits;
  rLimits: ControlLimits;
  /** True when every subgroup mean / range falls within limits. */
  inControl: boolean;
  outOfControlPoints: string[];
}

export function xbarRChart(measurements: Measurement[]): XbarRChartResult {
  // Group by subgroup id.
  const groups = new Map<string, number[]>();
  const groupT = new Map<string, number>();
  for (const m of measurements) {
    if (!groups.has(m.subgroupId)) groups.set(m.subgroupId, []);
    groups.get(m.subgroupId)!.push(m.value);
    if (m.t != null && !groupT.has(m.subgroupId)) groupT.set(m.subgroupId, m.t);
  }
  if (groups.size === 0) {
    const zero: ControlLimits = { centerLine: 0, upperControlLimit: 0, lowerControlLimit: 0 };
    return { subgroups: [], xbarLimits: zero, rLimits: zero, inControl: true, outOfControlPoints: [] };
  }

  const subgroups = Array.from(groups.entries()).map(([id, values]) => {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const range = Math.max(...values) - Math.min(...values);
    return { id, mean, range, t: groupT.get(id) };
  });

  const n = subgroups[0]!.id.length > 0 ? Array.from(groups.values())[0]!.length : 0;
  const meanOfMeans = subgroups.reduce((s, g) => s + g.mean, 0) / subgroups.length;
  const meanOfRanges = subgroups.reduce((s, g) => s + g.range, 0) / subgroups.length;

  const a2 = A2_TABLE[n] ?? 0.5;
  const d3 = D3_TABLE[n] ?? 0;
  const d4 = D4_TABLE[n] ?? 2;

  const xbarLimits: ControlLimits = {
    centerLine: meanOfMeans,
    upperControlLimit: meanOfMeans + a2 * meanOfRanges,
    lowerControlLimit: meanOfMeans - a2 * meanOfRanges,
  };
  const rLimits: ControlLimits = {
    centerLine: meanOfRanges,
    upperControlLimit: d4 * meanOfRanges,
    lowerControlLimit: d3 * meanOfRanges,
  };

  const outOfControl: string[] = [];
  for (const g of subgroups) {
    if (g.mean > xbarLimits.upperControlLimit || g.mean < xbarLimits.lowerControlLimit) {
      outOfControl.push(g.id);
      continue;
    }
    if (g.range > rLimits.upperControlLimit || g.range < rLimits.lowerControlLimit) {
      outOfControl.push(g.id);
    }
  }

  return {
    subgroups, xbarLimits, rLimits,
    inControl: outOfControl.length === 0,
    outOfControlPoints: outOfControl,
  };
}

/** Western Electric Rule 1: 1 point outside ±3σ. */
export function ruleOnePointOutside(
  values: number[],
  centerLine: number,
  sigma: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (Math.abs(values[i]! - centerLine) > 3 * sigma) out.push(i);
  }
  return out;
}

/** Western Electric Rule 4: 8 consecutive points same side of CL. */
export function ruleEightConsecutive(values: number[], centerLine: number): number[] {
  const out: number[] = [];
  let streak = 0;
  let sign = 0;
  for (let i = 0; i < values.length; i++) {
    const s = Math.sign(values[i]! - centerLine);
    if (s === sign) streak++;
    else { sign = s; streak = 1; }
    if (streak >= 8) out.push(i);
  }
  return out;
}
