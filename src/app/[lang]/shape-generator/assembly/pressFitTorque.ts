/**
 * pressFitTorque.ts — Holding capacity of an interference (press/shrink) fit.
 *
 * From the interface contact pressure p over a cylindrical engagement:
 *   contact area  A = π · d · L
 *   axial force   F = μ · p · A
 *   torque        T = F · d/2 = μ · p · π · d² · L / 2
 *
 * The interface pressure p is taken as an input (compute it separately from
 * a Lamé / interference analysis). Friction coefficient μ governs slip.
 */

export interface PressFitTorqueInput {
  interfacePressureMPa: number;  // p
  shaftDiameterMm: number;       // d (nominal interface diameter)
  engagementLengthMm: number;    // L
  frictionCoefficient: number;   // μ
  appliedTorqueNm?: number;      // optional duty check
  appliedAxialN?: number;        // optional duty check
}

export interface PressFitTorqueResult {
  contactAreaMm2: number;
  radialForceN: number;          // p·A (clamping)
  axialCapacityN: number;        // μ·p·A
  torqueCapacityNm: number;
  torqueSafetyFactor: number | null;
  axialSafetyFactor: number | null;
  slips: boolean;                // true if any applied duty exceeds capacity
  warnings: string[];
}

export function compute(input: PressFitTorqueInput): PressFitTorqueResult {
  const warnings: string[] = [];
  const { interfacePressureMPa: p, shaftDiameterMm: d, engagementLengthMm: L, frictionCoefficient: mu } = input;

  if (p <= 0) warnings.push('Interface pressure must be positive.');
  if (d <= 0 || L <= 0) warnings.push('Diameter and length must be positive.');
  if (mu <= 0) warnings.push('Friction coefficient must be positive.');

  const area = Math.PI * d * L;            // mm²
  const radial = p * area;                 // N (MPa·mm²)
  const axial = mu * radial;               // N
  // T[Nm] = μ·p·π·d²·L/2 with d in mm → /1000 to convert N·mm → N·m
  const torque = (mu * p * Math.PI * d * d * L) / 2 / 1000;

  let slips = false;
  let torqueSF: number | null = null;
  let axialSF: number | null = null;
  if (input.appliedTorqueNm !== undefined && input.appliedTorqueNm > 0) {
    torqueSF = torque / input.appliedTorqueNm;
    if (torqueSF < 1) slips = true;
  }
  if (input.appliedAxialN !== undefined && input.appliedAxialN > 0) {
    axialSF = axial / input.appliedAxialN;
    if (axialSF < 1) slips = true;
  }
  if (slips) warnings.push('Applied duty exceeds friction capacity: joint slips.');

  return {
    contactAreaMm2: area,
    radialForceN: radial,
    axialCapacityN: axial,
    torqueCapacityNm: torque,
    torqueSafetyFactor: torqueSF,
    axialSafetyFactor: axialSF,
    slips,
    warnings,
  };
}

/** Minimum interface pressure (MPa) to transmit a target torque without slip. */
export function pressureForTorque(
  shaftDiameterMm: number, engagementLengthMm: number, frictionCoefficient: number, targetTorqueNm: number,
): number {
  const denom = frictionCoefficient * Math.PI * shaftDiameterMm * shaftDiameterMm * engagementLengthMm / 2 / 1000;
  return denom > 0 ? targetTorqueNm / denom : Infinity;
}

export function summarize(r: PressFitTorqueResult): {
  torqueCapacityNm: number; axialCapacityN: number; slips: boolean;
} {
  return { torqueCapacityNm: r.torqueCapacityNm, axialCapacityN: r.axialCapacityN, slips: r.slips };
}
