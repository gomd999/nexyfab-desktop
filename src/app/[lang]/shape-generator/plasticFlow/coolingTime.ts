/**
 * coolingTime.ts — Estimate cooling time + risk maps.
 *
 * After fill, the part has to cool below the ejection temperature.
 * Cooling time scales roughly with thickness² / (thermal diffusivity).
 * Classical formula (Ballman, 1965):
 *
 *   t_cool ≈ (T_thick² / (π² · α)) · ln(8/π² · (T_melt - T_mold) / (T_eject - T_mold))
 *
 *   T_thick = local wall thickness (mm)
 *   α       = thermal diffusivity (mm²/s)
 *   T_melt  = polymer melt temperature (°C)
 *   T_mold  = mold wall temperature (°C)
 *   T_eject = polymer ejection temperature (°C)
 *
 * Thick regions cool slowly → sink marks + warpage risk. The map
 * highlights regions whose cooling time exceeds the surrounding
 * average.
 */

export interface PolymerProperties {
  /** Thermal diffusivity (mm²/s). */
  diffusivity: number;
  meltTempC: number;
  ejectTempC: number;
}

export const POLYMERS: Record<string, PolymerProperties> = {
  ABS:  { diffusivity: 0.11, meltTempC: 240, ejectTempC: 90 },
  PC:   { diffusivity: 0.13, meltTempC: 300, ejectTempC: 130 },
  PP:   { diffusivity: 0.10, meltTempC: 230, ejectTempC: 70 },
  PE:   { diffusivity: 0.16, meltTempC: 220, ejectTempC: 60 },
  PA:   { diffusivity: 0.12, meltTempC: 260, ejectTempC: 95 },
  POM:  { diffusivity: 0.10, meltTempC: 215, ejectTempC: 110 },
  PET:  { diffusivity: 0.09, meltTempC: 270, ejectTempC: 130 },
  PMMA: { diffusivity: 0.10, meltTempC: 240, ejectTempC: 100 },
};

export interface CoolingParams {
  polymer: keyof typeof POLYMERS;
  moldTempC: number;
}

/** Per-vertex thickness → cooling time. */
export function coolingTimeAt(
  thicknessMm: number,
  params: CoolingParams,
): number {
  const p = POLYMERS[params.polymer];
  if (!p) return 0;
  const dT = p.meltTempC - params.moldTempC;
  const dE = p.ejectTempC - params.moldTempC;
  if (dT <= 0 || dE <= 0) return 0;
  const term = (8 / (Math.PI * Math.PI)) * (dT / dE);
  if (term <= 1) return 0;
  return (thicknessMm * thicknessMm) / (Math.PI * Math.PI * p.diffusivity) * Math.log(term);
}

export interface CoolingMap {
  /** Per-vertex cooling time (seconds). */
  times: number[];
  /** Mean across all vertices. */
  meanSec: number;
  /** Indices of high-risk hot spots (cooling > 1.5× mean). */
  hotSpots: number[];
}

/** Build a cooling-time map from per-vertex thickness. */
export function buildCoolingMap(
  thicknesses: number[],
  params: CoolingParams,
): CoolingMap {
  const times = thicknesses.map(t => coolingTimeAt(t, params));
  const mean = times.reduce((s, v) => s + v, 0) / Math.max(1, times.length);
  const hotSpots: number[] = [];
  for (let i = 0; i < times.length; i++) {
    if (times[i]! > mean * 1.5) hotSpots.push(i);
  }
  return { times, meanSec: mean, hotSpots };
}

/** Sink-mark risk score — proportional to local thickness variance. */
export function sinkMarkRisk(thicknesses: number[]): number {
  if (thicknesses.length < 2) return 0;
  const mean = thicknesses.reduce((s, v) => s + v, 0) / thicknesses.length;
  const variance = thicknesses.reduce((s, v) => s + (v - mean) ** 2, 0) / thicknesses.length;
  return Math.sqrt(variance) / mean;
}
