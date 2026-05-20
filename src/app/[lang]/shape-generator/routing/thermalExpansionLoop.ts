/**
 * thermalExpansionLoop.ts — Size a pipe expansion loop (or offset) to
 * absorb thermal growth without overstressing the pipe.
 *
 * Thermal expansion of a straight run:
 *   ΔL = α · L · ΔT
 *
 * A U-shaped expansion loop of leg length H absorbs this by bending. The
 * guided-cantilever method gives the required loop leg:
 *
 *   H = sqrt( 3·E·D·ΔL / σ_allow )      (consistent units)
 *
 * where E = modulus, D = pipe OD, σ_allow = allowable bending stress.
 * (Each leg acts as a guided cantilever taking half the movement.)
 *
 * The loop width W is typically W = H/2 (square U). We also compute the
 * anchor-to-anchor reaction force and the developed extra pipe length.
 */

export interface ExpansionLoopInput {
  runLengthMm: number;     // anchored run that grows
  ctePerK: number;         // α
  deltaTempC: number;      // ΔT
  outerDiameterMm: number; // D
  youngMpa: number;        // E
  allowableStressMpa: number; // σ_allow (displacement stress range)
  momentOfInertiaMm4?: number; // optional for reaction force
}

export interface ExpansionLoopResult {
  thermalGrowthMm: number;
  loopLegHeightMm: number;  // H
  loopWidthMm: number;      // W
  developedExtraLengthMm: number; // extra pipe for the loop
  anchorForceN: number | null;
  warnings: string[];
}

export function size(input: ExpansionLoopInput): ExpansionLoopResult {
  const warnings: string[] = [];
  if (input.runLengthMm <= 0) warnings.push('Run length must be positive.');
  if (input.allowableStressMpa <= 0) warnings.push('Allowable stress must be positive.');
  if (input.outerDiameterMm <= 0) warnings.push('Outer diameter must be positive.');

  const dL = input.ctePerK * input.runLengthMm * input.deltaTempC;
  const absGrowth = Math.abs(dL);

  // Guided-cantilever loop leg: H = sqrt(3·E·D·ΔL / σ).
  const H = input.allowableStressMpa > 0
    ? Math.sqrt((3 * input.youngMpa * input.outerDiameterMm * absGrowth) / input.allowableStressMpa)
    : 0;
  const W = H / 2;

  // Developed extra pipe for a U-loop ≈ 2·H + W (the three added legs vs straight).
  const extra = 2 * H + W;

  // Anchor reaction (guided cantilever): F = 12·E·I·δ / H³, δ = ΔL/2 per leg.
  let anchorForce: number | null = null;
  if (input.momentOfInertiaMm4 != null && H > 0) {
    const delta = absGrowth / 2;
    anchorForce = (12 * input.youngMpa * input.momentOfInertiaMm4 * delta) / Math.pow(H, 3);
  }

  return {
    thermalGrowthMm: dL,
    loopLegHeightMm: H,
    loopWidthMm: W,
    developedExtraLengthMm: extra,
    anchorForceN: anchorForce,
    warnings,
  };
}

/** Thermal growth of a run (mm). */
export function thermalGrowthMm(runLengthMm: number, ctePerK: number, deltaTempC: number): number {
  return ctePerK * runLengthMm * deltaTempC;
}

/** Stress in an existing loop of given leg height (inverse check). */
export function loopStressMpa(input: ExpansionLoopInput, actualLegHeightMm: number): number {
  if (actualLegHeightMm <= 0) return Infinity;
  const dL = Math.abs(input.ctePerK * input.runLengthMm * input.deltaTempC);
  return (3 * input.youngMpa * input.outerDiameterMm * dL) / (actualLegHeightMm * actualLegHeightMm);
}

export function summarize(r: ExpansionLoopResult): { thermalGrowthMm: number; loopLegHeightMm: number; loopWidthMm: number } {
  return { thermalGrowthMm: r.thermalGrowthMm, loopLegHeightMm: r.loopLegHeightMm, loopWidthMm: r.loopWidthMm };
}
