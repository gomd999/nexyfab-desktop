/**
 * moldingCycleTime.ts — Break down an injection-molding cycle into its
 * phases and total cycle time, so a quote/throughput can be derived.
 *
 *   cycle = injection + packing + cooling + moldOpen + ejection + moldClose
 *
 * Injection time = shotVolume / injectionRate. Cooling (the dominant
 * phase) can be supplied or estimated from wall thickness via the 1-D
 * Fourier form (s²/(π²α)·ln term ≈ k·s²). Mold open/close + ejection are
 * machine-dependent constants scaled by part size.
 *
 * Output: phase times, total cycle, parts/hour (× cavities).
 */

export interface MoldingCycleInput {
  shotVolumeCm3: number;       // part(s) + runner per shot
  injectionRateCm3PerSec: number;
  packTimeSec?: number;        // holding/packing, default 0.6×injection
  coolingTimeSec?: number;     // if known; else estimate from wall
  wallThicknessMm?: number;    // for cooling estimate
  coolingConstant?: number;    // k in t_cool = k·s² (sec/mm²), default 2.5
  moldOpenSec?: number;        // default 1.5
  ejectionSec?: number;        // default 1.0
  moldCloseSec?: number;       // default 1.5
  cavities?: number;
}

export interface MoldingCycleResult {
  injectionSec: number;
  packingSec: number;
  coolingSec: number;
  moldMotionSec: number;       // open + close + eject
  totalCycleSec: number;
  partsPerHour: number;        // × cavities
  coolingFraction: number;
  warnings: string[];
}

export function compute(input: MoldingCycleInput): MoldingCycleResult {
  const warnings: string[] = [];
  if (input.injectionRateCm3PerSec <= 0) warnings.push('Injection rate must be positive.');

  const injection = input.injectionRateCm3PerSec > 0 ? input.shotVolumeCm3 / input.injectionRateCm3PerSec : 0;
  const packing = input.packTimeSec ?? injection * 0.6;

  let cooling = input.coolingTimeSec ?? 0;
  if (input.coolingTimeSec == null) {
    if (input.wallThicknessMm == null) warnings.push('Provide coolingTimeSec or wallThicknessMm.');
    const k = input.coolingConstant ?? 2.5;
    cooling = k * Math.pow(input.wallThicknessMm ?? 2, 2);
  }

  const open = input.moldOpenSec ?? 1.5;
  const eject = input.ejectionSec ?? 1.0;
  const close = input.moldCloseSec ?? 1.5;
  const moldMotion = open + eject + close;

  const total = injection + packing + cooling + moldMotion;
  const cav = Math.max(1, input.cavities ?? 1);
  const partsPerHour = total > 0 ? (3600 / total) * cav : 0;
  const coolingFraction = total > 0 ? cooling / total : 0;

  return {
    injectionSec: injection,
    packingSec: packing,
    coolingSec: cooling,
    moldMotionSec: moldMotion,
    totalCycleSec: total,
    partsPerHour,
    coolingFraction,
    warnings,
  };
}

/** Cycle-time reduction if wall thickness is reduced (cooling ∝ s²). */
export function thinWallSaving(input: MoldingCycleInput, newWallMm: number): { oldCycleSec: number; newCycleSec: number; savingPercent: number } {
  const oldR = compute(input);
  const newR = compute({ ...input, coolingTimeSec: undefined, wallThicknessMm: newWallMm });
  const saving = oldR.totalCycleSec > 0 ? ((oldR.totalCycleSec - newR.totalCycleSec) / oldR.totalCycleSec) * 100 : 0;
  return { oldCycleSec: oldR.totalCycleSec, newCycleSec: newR.totalCycleSec, savingPercent: saving };
}

export function summarize(r: MoldingCycleResult): { totalCycleSec: number; coolingSec: number; partsPerHour: number } {
  return { totalCycleSec: r.totalCycleSec, coolingSec: r.coolingSec, partsPerHour: r.partsPerHour };
}
