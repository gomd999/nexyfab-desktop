/**
 * deepDraw.ts — Cylindrical deep-drawing: blank size, draw ratio, force, redraws.
 *
 *   blank dia  D = √(d² + 4·d·h)          (volume/area equivalence, thin wall)
 *   draw ratio DR = D / d
 *   draw force F = π·d·t·UTS·(D/d − C)     (C ≈ 0.6–0.7 friction/holder term)
 *   blank-holder force BHF = area_flange · p_bh
 *
 * If DR exceeds the limiting draw ratio (LDR ≈ 1.8–2.2), redraws are needed:
 *   each stage reduces by ~ LDR until the target cup diameter is reached.
 */

export interface DeepDrawInput {
  cupDiameterMm: number;         // d (mean)
  cupHeightMm: number;           // h
  thicknessMm: number;           // t
  ultimateTensileMPa: number;    // UTS of blank material
  limitingDrawRatio?: number;    // LDR, default 2.0
  forceCoefficient?: number;     // C, default 0.65
  blankHolderPressureMPa?: number; // default 2.5
}

export interface DeepDrawResult {
  blankDiameterMm: number;
  drawRatio: number;
  feasibleSingleDraw: boolean;
  redrawStages: number;          // total draws incl. first
  drawForceN: number;
  blankHolderForceN: number;
  reductionPercent: number;      // (D−d)/D
  warnings: string[];
}

export function compute(input: DeepDrawInput): DeepDrawResult {
  const warnings: string[] = [];
  const { cupDiameterMm: d, cupHeightMm: h, thicknessMm: t } = input;
  const LDR = input.limitingDrawRatio ?? 2.0;
  const C = input.forceCoefficient ?? 0.65;

  if (d <= 0 || t <= 0) warnings.push('Diameter and thickness must be positive.');
  if (h < 0) warnings.push('Height must be non-negative.');

  const D = Math.sqrt(d * d + 4 * d * h);
  const DR = d > 0 ? D / d : Infinity;
  const feasible = DR <= LDR;
  if (!feasible) warnings.push(`Draw ratio ${DR.toFixed(2)} exceeds LDR ${LDR}; multiple draws required.`);

  // Number of stages: D → d via successive ÷LDR.
  let stages = 1;
  if (d > 0 && LDR > 1) {
    stages = Math.max(1, Math.ceil(Math.log(D / d) / Math.log(LDR)));
  }

  const drawForce = Math.PI * d * t * input.ultimateTensileMPa * Math.max(D / d - C, 0);

  const flangeArea = (Math.PI / 4) * (D * D - d * d);
  const bhf = Math.max(flangeArea, 0) * (input.blankHolderPressureMPa ?? 2.5);

  const reduction = D > 0 ? (D - d) / D : 0;

  return {
    blankDiameterMm: D,
    drawRatio: DR,
    feasibleSingleDraw: feasible,
    redrawStages: stages,
    drawForceN: drawForce,
    blankHolderForceN: bhf,
    reductionPercent: reduction * 100,
    warnings,
  };
}

/** Cup height achievable in a single draw at the limiting ratio. */
export function maxSingleDrawHeight(cupDiameterMm: number, limitingDrawRatio = 2.0): number {
  // D = LDR·d, D² = d² + 4·d·h → h = (D² − d²)/(4d)
  const D = limitingDrawRatio * cupDiameterMm;
  return cupDiameterMm > 0 ? (D * D - cupDiameterMm * cupDiameterMm) / (4 * cupDiameterMm) : 0;
}

export function summarize(r: DeepDrawResult): {
  blankDiameterMm: number; drawRatio: number; redrawStages: number;
} {
  return { blankDiameterMm: r.blankDiameterMm, drawRatio: r.drawRatio, redrawStages: r.redrawStages };
}
