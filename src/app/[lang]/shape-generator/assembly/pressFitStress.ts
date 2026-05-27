/**
 * pressFitStress.ts — Compute contact pressure and stresses for a
 * cylindrical press / shrink fit using Lamé's thick-wall equations.
 *
 * A shaft (or inner ring) of outer radius b is pressed into a hub (outer
 * ring) of inner radius b (nominal) with diametral interference δ. The
 * radial interference shrinks the shaft and expands the hub until they
 * share a common contact pressure p:
 *
 *   δ_radial = p·b/E_o·( (c²+b²)/(c²−b²) + ν_o )
 *            + p·b/E_i·( (b²+a²)/(b²−a²) − ν_i )
 *
 * where a = shaft bore (0 for solid shaft), c = hub outer radius.
 * Solving for p given δ_radial:
 *
 *   p = δ_radial / [ b·( K_o/E_o + K_i/E_i ) ]
 *
 * Then peak hoop stresses:
 *   hub inner:   σθ = p·(c²+b²)/(c²−b²)   (tensile, governs hub)
 *   shaft outer: σθ = −p·(b²+a²)/(b²−a²)  (compressive)
 *
 * Holding torque (friction): T = μ·p·(2π·b)·L·b = 2π·μ·p·b²·L
 */

export interface PressFitInput {
  shaftBoreRadiusMm: number;   // a (0 = solid shaft)
  contactRadiusMm: number;     // b (nominal common radius)
  hubOuterRadiusMm: number;    // c
  diametralInterferenceMm: number; // δ (positive)
  shaftYoungMpa: number;
  hubYoungMpa: number;
  shaftPoisson: number;
  hubPoisson: number;
  frictionCoefficient?: number; // for holding torque
  engagementLengthMm?: number;  // L, for holding torque
}

export interface PressFitResult {
  contactPressureMpa: number;
  hubHoopStressMpa: number;     // tensile at hub bore
  shaftHoopStressMpa: number;   // compressive at shaft OD
  holdingTorqueNm: number | null;
  axialPushForceN: number | null;
  warnings: string[];
}

export function evaluate(input: PressFitInput): PressFitResult {
  const warnings: string[] = [];
  const a = input.shaftBoreRadiusMm;
  const b = input.contactRadiusMm;
  const c = input.hubOuterRadiusMm;

  if (b <= 0) warnings.push('Contact radius must be positive.');
  if (c <= b) warnings.push('Hub outer radius must exceed contact radius.');
  if (a >= b) warnings.push('Shaft bore radius must be less than contact radius.');
  if (input.diametralInterferenceMm < 0) warnings.push('Interference should be non-negative.');

  if (b <= 0 || c <= b || a >= b) {
    return { contactPressureMpa: 0, hubHoopStressMpa: 0, shaftHoopStressMpa: 0, holdingTorqueNm: null, axialPushForceN: null, warnings };
  }

  // Radial interference = half the diametral interference.
  const deltaRadial = input.diametralInterferenceMm / 2;

  const Ko = (c * c + b * b) / (c * c - b * b) + input.hubPoisson;
  const Ki = (b * b + a * a) / (b * b - a * a) - input.shaftPoisson;
  const compliance = b * (Ko / input.hubYoungMpa + Ki / input.shaftYoungMpa);
  const p = compliance > 0 ? deltaRadial / compliance : 0;

  const hubHoop = p * (c * c + b * b) / (c * c - b * b);
  const shaftHoop = -p * (b * b + a * a) / (b * b - a * a);

  let torque: number | null = null;
  let pushForce: number | null = null;
  if (input.frictionCoefficient != null && input.engagementLengthMm != null) {
    const mu = input.frictionCoefficient;
    const L = input.engagementLengthMm;
    // Convert mm/MPa to N·m: p [MPa = N/mm²], areas in mm² → N; torque N·mm → N·m /1000.
    const normalForce = p * (2 * Math.PI * b) * L; // N
    pushForce = mu * normalForce; // N
    torque = (mu * normalForce * b) / 1000; // N·m
  }

  return {
    contactPressureMpa: p,
    hubHoopStressMpa: hubHoop,
    shaftHoopStressMpa: shaftHoop,
    holdingTorqueNm: torque,
    axialPushForceN: pushForce,
    warnings,
  };
}

/** Solve the interference needed to achieve a target contact pressure. */
export function interferenceForPressure(input: Omit<PressFitInput, 'diametralInterferenceMm'>, targetPressureMpa: number): number {
  const a = input.shaftBoreRadiusMm;
  const b = input.contactRadiusMm;
  const c = input.hubOuterRadiusMm;
  if (b <= 0 || c <= b || a >= b) return 0;
  const Ko = (c * c + b * b) / (c * c - b * b) + input.hubPoisson;
  const Ki = (b * b + a * a) / (b * b - a * a) - input.shaftPoisson;
  const compliance = b * (Ko / input.hubYoungMpa + Ki / input.shaftYoungMpa);
  const deltaRadial = targetPressureMpa * compliance;
  return deltaRadial * 2; // back to diametral
}

/** Check both parts stay below yield (von Mises ≈ |hoop| for thin contact). */
export function checkYield(result: PressFitResult, hubYieldMpa: number, shaftYieldMpa: number): { hubOk: boolean; shaftOk: boolean } {
  return {
    hubOk: Math.abs(result.hubHoopStressMpa) <= hubYieldMpa,
    shaftOk: Math.abs(result.shaftHoopStressMpa) <= shaftYieldMpa,
  };
}

export function summarize(r: PressFitResult): { contactPressureMpa: number; hubHoopStressMpa: number; holdingTorqueNm: number | null } {
  return { contactPressureMpa: r.contactPressureMpa, hubHoopStressMpa: r.hubHoopStressMpa, holdingTorqueNm: r.holdingTorqueNm };
}
