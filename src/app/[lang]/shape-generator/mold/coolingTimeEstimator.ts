/**
 * coolingTimeEstimator.ts — Injection-mold cooling time estimator.
 *
 * For a slab of wall thickness s, the classical 1-D Fourier formula:
 *
 *   t_c = s² / (π² · α) · ln[ (4/π) · (T_melt − T_mold) / (T_eject − T_mold) ]
 *
 * Where:
 *   α    = thermal diffusivity of polymer (mm²/s)
 *   T_*  = temperatures (°C): melt at injection, mold wall, eject (HDT).
 *
 * This is the dominant cooling-time driver in cycle estimation — and
 * because of the s² term, doubling wall thickness quadruples cooling
 * time (and the cycle).
 *
 * For non-slab shapes we approximate with the "thickest wall" rule and
 * add a 10-25% safety margin per geometry class.
 */

export type MaterialClass = 'PP' | 'PE-HD' | 'ABS' | 'PA6' | 'PA66' | 'PC' | 'PMMA' | 'POM' | 'PBT' | 'TPE';

export interface MaterialProperty {
  className: MaterialClass;
  diffusivityMm2PerS: number;
  recommendedMeltC: number;
  recommendedMoldC: number;
  ejectionTempC: number; // ≈ HDT
}

// Source: typical polymer-handbook values, rounded.
const MATERIALS: Record<MaterialClass, MaterialProperty> = {
  'PP':     { className: 'PP',     diffusivityMm2PerS: 0.085, recommendedMeltC: 220, recommendedMoldC: 40, ejectionTempC: 100 },
  'PE-HD':  { className: 'PE-HD',  diffusivityMm2PerS: 0.110, recommendedMeltC: 230, recommendedMoldC: 40, ejectionTempC: 90 },
  'ABS':    { className: 'ABS',    diffusivityMm2PerS: 0.075, recommendedMeltC: 240, recommendedMoldC: 60, ejectionTempC: 95 },
  'PA6':    { className: 'PA6',    diffusivityMm2PerS: 0.080, recommendedMeltC: 270, recommendedMoldC: 80, ejectionTempC: 130 },
  'PA66':   { className: 'PA66',   diffusivityMm2PerS: 0.085, recommendedMeltC: 285, recommendedMoldC: 90, ejectionTempC: 140 },
  'PC':     { className: 'PC',     diffusivityMm2PerS: 0.090, recommendedMeltC: 290, recommendedMoldC: 95, ejectionTempC: 130 },
  'PMMA':   { className: 'PMMA',   diffusivityMm2PerS: 0.105, recommendedMeltC: 240, recommendedMoldC: 60, ejectionTempC: 90 },
  'POM':    { className: 'POM',    diffusivityMm2PerS: 0.095, recommendedMeltC: 215, recommendedMoldC: 90, ejectionTempC: 130 },
  'PBT':    { className: 'PBT',    diffusivityMm2PerS: 0.090, recommendedMeltC: 250, recommendedMoldC: 80, ejectionTempC: 130 },
  'TPE':    { className: 'TPE',    diffusivityMm2PerS: 0.080, recommendedMeltC: 210, recommendedMoldC: 30, ejectionTempC: 80 },
};

export interface CoolingTimeInput {
  material: MaterialClass;
  wallThicknessMm: number;
  meltTempC?: number;
  moldTempC?: number;
  ejectionTempC?: number;
  geometryFactor?: number; // 1.0 slab, 1.1 ribbed, 1.25 enclosed boss
}

export interface CoolingTimeResult {
  baseCoolingTimeSec: number;
  adjustedCoolingTimeSec: number;
  cycleTimeEstimateSec: number; // cooling + 30% (open / inject / pack)
  materialUsed: MaterialProperty;
  warnings: string[];
}

export function estimate(input: CoolingTimeInput): CoolingTimeResult {
  const warnings: string[] = [];
  const mat = MATERIALS[input.material];
  if (!mat) {
    warnings.push(`Unknown material "${input.material}"; defaulting to PP.`);
  }
  const m = mat ?? MATERIALS.PP;

  const s = input.wallThicknessMm;
  if (s <= 0) warnings.push('Wall thickness must be positive.');

  const Tmelt = input.meltTempC ?? m.recommendedMeltC;
  const Tmold = input.moldTempC ?? m.recommendedMoldC;
  const Teject = input.ejectionTempC ?? m.ejectionTempC;

  if (Teject <= Tmold) {
    warnings.push('Eject temperature must be above mold temperature.');
  }

  const logTerm = Math.log((4 / Math.PI) * (Tmelt - Tmold) / Math.max(0.1, Teject - Tmold));
  const t_c = (s * s) / (Math.PI * Math.PI * m.diffusivityMm2PerS) * Math.max(0, logTerm);

  const geomFactor = input.geometryFactor ?? 1.0;
  const adjusted = t_c * geomFactor;
  const cycle = adjusted * 1.3; // injection/holding/open ≈ 30% overhead

  return {
    baseCoolingTimeSec: t_c,
    adjustedCoolingTimeSec: adjusted,
    cycleTimeEstimateSec: cycle,
    materialUsed: m,
    warnings,
  };
}

/** Sensitivity: how cooling changes when wall increases by Δs. */
export function sensitivity(input: CoolingTimeInput, deltaThicknessMm: number): { baselineSec: number; bumpSec: number; multiplier: number } {
  const base = estimate(input);
  const bumped = estimate({ ...input, wallThicknessMm: input.wallThicknessMm + deltaThicknessMm });
  const mult = base.adjustedCoolingTimeSec > 0 ? bumped.adjustedCoolingTimeSec / base.adjustedCoolingTimeSec : 0;
  return { baselineSec: base.adjustedCoolingTimeSec, bumpSec: bumped.adjustedCoolingTimeSec, multiplier: mult };
}

export function listMaterials(): MaterialClass[] {
  return Object.keys(MATERIALS) as MaterialClass[];
}

export function summarize(r: CoolingTimeResult): { adjustedCoolingTimeSec: number; cycleTimeEstimateSec: number; material: MaterialClass } {
  return {
    adjustedCoolingTimeSec: r.adjustedCoolingTimeSec,
    cycleTimeEstimateSec: r.cycleTimeEstimateSec,
    material: r.materialUsed.className,
  };
}
