/**
 * expansionJoint.ts — Select / check a metal-bellows expansion joint for
 * absorbing pipe thermal movement, with axial / lateral / angular
 * capacity and the spring (reaction) force it imposes on anchors.
 *
 *   thermalMovement = α · L · ΔT                       [mm, axial]
 *   designMovement  = thermalMovement · safetyFactor
 *   convolutions    = ceil(designMovement / movementPerConvolution)
 *   springForce     = axialStiffnessNmm · designMovement   [N]
 *   pressureThrust  = P · A_eff                            [N] (un-anchored)
 *
 * We check the joint's rated axial movement vs the design movement, and
 * report the anchor load = spring force + pressure thrust.
 */

export interface ExpansionJointInput {
  runLengthMm: number;
  ctePerK: number;
  deltaTempC: number;
  movementPerConvolutionMm: number;  // bellows rating per convolution
  axialStiffnessNmmPerConv: number;  // spring rate per convolution
  effectiveAreaMm2: number;          // bellows effective area for thrust
  pressureBar: number;
  ratedConvolutions?: number;        // if checking an existing joint
  safetyFactor?: number;             // movement design factor, default 1.25
}

export interface ExpansionJointResult {
  thermalMovementMm: number;
  designMovementMm: number;
  requiredConvolutions: number;
  springForceN: number;
  pressureThrustN: number;
  anchorLoadN: number;
  adequate: boolean | null;          // vs ratedConvolutions
  warnings: string[];
}

export function compute(input: ExpansionJointInput): ExpansionJointResult {
  const warnings: string[] = [];
  if (input.movementPerConvolutionMm <= 0) warnings.push('Movement per convolution must be positive.');

  const thermal = Math.abs(input.ctePerK * input.runLengthMm * input.deltaTempC);
  const sf = input.safetyFactor ?? 1.25;
  const design = thermal * sf;

  const reqConv = input.movementPerConvolutionMm > 0 ? Math.ceil(design / input.movementPerConvolutionMm) : Infinity;

  // Spring rate falls as convolutions increase (springs in series).
  const usedConv = input.ratedConvolutions ?? reqConv;
  const axialStiffness = usedConv > 0 ? input.axialStiffnessNmmPerConv / usedConv : 0;
  const springForce = axialStiffness * design;

  // Pressure thrust (Pa × m²): bar → Pa ×1e5; mm² → m² ×1e-6 → ×0.1.
  const pressureThrust = input.pressureBar * input.effectiveAreaMm2 * 0.1;

  const anchorLoad = springForce + pressureThrust;

  let adequate: boolean | null = null;
  if (input.ratedConvolutions != null) {
    adequate = input.ratedConvolutions >= reqConv;
    if (!adequate) warnings.push(`Rated ${input.ratedConvolutions} convolutions < required ${reqConv}; movement exceeds joint capacity.`);
  }

  return {
    thermalMovementMm: thermal,
    designMovementMm: design,
    requiredConvolutions: reqConv,
    springForceN: springForce,
    pressureThrustN: pressureThrust,
    anchorLoadN: anchorLoad,
    adequate,
    warnings,
  };
}

/** Thermal movement of a run (mm). */
export function thermalMovementMm(runLengthMm: number, ctePerK: number, deltaTempC: number): number {
  return Math.abs(ctePerK * runLengthMm * deltaTempC);
}

export function summarize(r: ExpansionJointResult): { designMovementMm: number; requiredConvolutions: number; anchorLoadN: number } {
  return { designMovementMm: r.designMovementMm, requiredConvolutions: r.requiredConvolutions, anchorLoadN: r.anchorLoadN };
}
