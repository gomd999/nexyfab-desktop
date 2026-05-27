/**
 * spindleLoadEstimator.ts — Estimate spindle load (torque + power)
 * for a cutting operation.
 *
 * Sandvik / Kennametal formulas:
 *
 *   - MRR = ae × ap × vf            (mm³/min)
 *   - P = MRR × kc / 60               (W, with kc in N/mm²)
 *   - T = P / (2π · n / 60)           (N·m)
 *
 * Where:
 *   - ae: radial DOC (stepover)
 *   - ap: axial DOC
 *   - vf: feed rate (mm/min)
 *   - kc: specific cutting force (depends on material + chip thickness)
 *   - n: spindle RPM
 *
 * Module estimates per-segment spindle load and flags overload.
 */

export interface CuttingConditions {
  /** Radial stepover (mm). */
  aeMm: number;
  /** Axial depth of cut (mm). */
  apMm: number;
  /** Feed rate (mm/min). */
  feedMmMin: number;
  /** Spindle speed (RPM). */
  spindleRpm: number;
  /** Specific cutting force kc (N/mm²) — material × chip thickness dependent. */
  kcN_mm2: number;
}

export interface MachineLimits {
  /** Max spindle power (W). */
  maxPowerW: number;
  /** Max spindle torque (N·m). */
  maxTorqueNm: number;
  /** Efficiency factor. */
  efficiency: number;
}

export interface LoadResult {
  /** MRR (mm³/min). */
  mrrMm3PerMin: number;
  /** Power required (W). */
  powerW: number;
  /** Torque required (N·m). */
  torqueNm: number;
  /** Power utilisation %. */
  powerUtilisation: number;
  /** Torque utilisation %. */
  torqueUtilisation: number;
  /** True if any limit exceeded. */
  overloaded: boolean;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function estimateLoad(conds: CuttingConditions, machine: MachineLimits): LoadResult {
  const warnings: string[] = [];
  const mrr = Math.max(0, conds.aeMm) * Math.max(0, conds.apMm) * Math.max(0, conds.feedMmMin);
  const power = (mrr * conds.kcN_mm2) / 60 / Math.max(0.1, machine.efficiency);
  let torque = 0;
  if (conds.spindleRpm > 0) {
    const omega = (2 * Math.PI * conds.spindleRpm) / 60;
    torque = power / omega;
  }
  const powerUtil = (power / Math.max(1, machine.maxPowerW)) * 100;
  const torqueUtil = (torque / Math.max(0.01, machine.maxTorqueNm)) * 100;
  const overloaded = powerUtil > 100 || torqueUtil > 100;
  if (powerUtil > 100) warnings.push(`Power utilisation ${powerUtil.toFixed(0)}% > 100%; spindle stalls.`);
  if (torqueUtil > 100) warnings.push(`Torque utilisation ${torqueUtil.toFixed(0)}% > 100%; spindle stalls.`);
  if (conds.spindleRpm <= 0) warnings.push('Spindle RPM must be positive.');
  return { mrrMm3PerMin: mrr, powerW: power, torqueNm: torque, powerUtilisation: powerUtil, torqueUtilisation: torqueUtil, overloaded, warnings };
}

// ── Sweep cutting conditions to find max throughput ──────────

export interface SweepCandidate {
  conds: CuttingConditions;
  result: LoadResult;
}

export function findMaxThroughput(conds: CuttingConditions, machine: MachineLimits, maxRetries: number = 20): SweepCandidate {
  let best: SweepCandidate | null = null;
  for (let i = 0; i < maxRetries; i++) {
    const scaledAp = conds.apMm * (1 + i * 0.05);
    const trial: CuttingConditions = { ...conds, apMm: scaledAp };
    const res = estimateLoad(trial, machine);
    if (res.overloaded) break;
    if (!best || res.mrrMm3PerMin > best.result.mrrMm3PerMin) {
      best = { conds: trial, result: res };
    }
  }
  return best ?? { conds, result: estimateLoad(conds, machine) };
}

// ── Comparison table across materials ────────────────────────

export interface MaterialKc {
  material: string;
  kcN_mm2: number;
}

export const DEFAULT_KC_TABLE: MaterialKc[] = [
  { material: 'aluminum-6061', kcN_mm2: 800 },
  { material: 'mild-steel-1018', kcN_mm2: 2000 },
  { material: 'stainless-304', kcN_mm2: 2400 },
  { material: 'titanium-Ti6Al4V', kcN_mm2: 2100 },
  { material: 'inconel-718', kcN_mm2: 3000 },
];

export function compareMaterials(baseConds: Omit<CuttingConditions, 'kcN_mm2'>, machine: MachineLimits): { material: string; result: LoadResult }[] {
  return DEFAULT_KC_TABLE.map(m => {
    const result = estimateLoad({ ...baseConds, kcN_mm2: m.kcN_mm2 }, machine);
    return { material: m.material, result };
  });
}

// ── Summary ────────────────────────────────────────────────────

export interface LoadSummary {
  powerW: number;
  torqueNm: number;
  powerUtilisationPct: number;
  overloaded: boolean;
}

export function summarize(result: LoadResult): LoadSummary {
  return {
    powerW: result.powerW,
    torqueNm: result.torqueNm,
    powerUtilisationPct: result.powerUtilisation,
    overloaded: result.overloaded,
  };
}
