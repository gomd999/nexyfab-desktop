/**
 * frictionClutch.ts — Size a friction clutch / brake: torque capacity from
 * the disc geometry + clamp force, and the engagement (slip) energy/heat.
 *
 * Torque capacity (uniform-wear theory, single friction face):
 *   T = μ · F · R_mean · nFaces ,  R_mean = (Ro + Ri)/2
 *
 * (Uniform-pressure theory uses R = (2/3)(Ro³−Ri³)/(Ro²−Ri²); we expose
 * both.) Engagement energy when synchronising two inertias from a speed
 * difference Δω with the clutch slipping:
 *   E_slip = ½ · I_eq · Δω²  ,  I_eq = I1·I2/(I1+I2)
 *
 * This heat raises disc temperature; we report energy + a simple temp
 * rise for a given disc mass + specific heat.
 */

export type ClutchTheory = 'uniform-wear' | 'uniform-pressure';

export interface FrictionClutchInput {
  frictionCoefficient: number;
  clampForceN: number;
  outerRadiusMm: number;
  innerRadiusMm: number;
  faces?: number;              // friction surfaces, default 1
  theory?: ClutchTheory;
  // engagement energy inputs (optional)
  inertia1KgM2?: number;
  inertia2KgM2?: number;
  speedDiffRadS?: number;
  discMassKg?: number;
  discSpecificHeatJkgK?: number; // default 500 (steel)
}

export interface FrictionClutchResult {
  meanRadiusMm: number;
  torqueCapacityNm: number;
  engagementEnergyJ: number | null;
  discTempRiseC: number | null;
  warnings: string[];
}

export function compute(input: FrictionClutchInput): FrictionClutchResult {
  const warnings: string[] = [];
  const Ro = input.outerRadiusMm / 1000, Ri = input.innerRadiusMm / 1000; // m
  if (Ro <= Ri) warnings.push('Outer radius must exceed inner radius.');
  if (input.clampForceN <= 0) warnings.push('Clamp force must be positive.');

  const faces = Math.max(1, input.faces ?? 1);
  const theory = input.theory ?? 'uniform-wear';

  let Reff: number;
  if (theory === 'uniform-pressure') {
    Reff = (Ro > Ri) ? (2 / 3) * (Math.pow(Ro, 3) - Math.pow(Ri, 3)) / (Math.pow(Ro, 2) - Math.pow(Ri, 2)) : 0;
  } else {
    Reff = (Ro + Ri) / 2;
  }

  const torque = input.frictionCoefficient * input.clampForceN * Reff * faces; // N·m

  let energy: number | null = null;
  let tempRise: number | null = null;
  if (input.inertia1KgM2 != null && input.inertia2KgM2 != null && input.speedDiffRadS != null) {
    const Ieq = (input.inertia1KgM2 * input.inertia2KgM2) / (input.inertia1KgM2 + input.inertia2KgM2);
    energy = 0.5 * Ieq * input.speedDiffRadS * input.speedDiffRadS;
    if (input.discMassKg != null && input.discMassKg > 0) {
      const cp = input.discSpecificHeatJkgK ?? 500;
      tempRise = energy / (input.discMassKg * cp);
    }
  }

  return {
    meanRadiusMm: Reff * 1000,
    torqueCapacityNm: torque,
    engagementEnergyJ: energy,
    discTempRiseC: tempRise,
    warnings,
  };
}

/** Clamp force required to transmit a target torque. */
export function clampForceForTorque(input: Omit<FrictionClutchInput, 'clampForceN'>, targetTorqueNm: number): number {
  const Ro = input.outerRadiusMm / 1000, Ri = input.innerRadiusMm / 1000;
  const faces = Math.max(1, input.faces ?? 1);
  const Reff = (input.theory ?? 'uniform-wear') === 'uniform-pressure'
    ? (2 / 3) * (Math.pow(Ro, 3) - Math.pow(Ri, 3)) / (Math.pow(Ro, 2) - Math.pow(Ri, 2))
    : (Ro + Ri) / 2;
  const denom = input.frictionCoefficient * Reff * faces;
  return denom > 0 ? targetTorqueNm / denom : Infinity;
}

export function summarize(r: FrictionClutchResult): { torqueCapacityNm: number; engagementEnergyJ: number | null; discTempRiseC: number | null } {
  return { torqueCapacityNm: r.torqueCapacityNm, engagementEnergyJ: r.engagementEnergyJ, discTempRiseC: r.discTempRiseC };
}
