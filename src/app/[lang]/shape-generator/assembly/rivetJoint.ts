/**
 * rivetJoint.ts — Allowable load of a riveted lap/butt joint, by failure mode.
 *
 *   shear   P_s = n · m · (π/4)·d² · τ_allow      (m = 1 single / 2 double)
 *   bearing P_b = n · d · t · σ_bearing
 *   tearing P_t = (p − d) · t · σ_tension          (net section, per pitch)
 *
 * Joint capacity = min(P_s, P_b, P_t). Efficiency = capacity / (p·t·σ_t)
 * compares the joint to the solid (un-drilled) plate.
 */

export interface RivetJointInput {
  rivetDiameterMm: number;       // d
  plateThicknessMm: number;      // t
  pitchMm: number;               // p (per rivet row, for tearing)
  rivetCount: number;            // n rivets sharing the load
  shearType?: 'single' | 'double';
  allowableShearMPa: number;     // τ
  allowableBearingMPa: number;   // σ_b
  allowableTensionMPa: number;   // σ_t
}

export type RivetFailureMode = 'shear' | 'bearing' | 'tearing';

export interface RivetJointResult {
  shearLoadN: number;
  bearingLoadN: number;
  tearingLoadN: number;
  capacityN: number;
  governingMode: RivetFailureMode;
  efficiency: number;            // 0..1 vs solid plate
  warnings: string[];
}

export function compute(input: RivetJointInput): RivetJointResult {
  const warnings: string[] = [];
  const { rivetDiameterMm: d, plateThicknessMm: t, pitchMm: p, rivetCount: n } = input;
  const m = input.shearType === 'double' ? 2 : 1;

  if (d <= 0 || t <= 0) warnings.push('Diameter and thickness must be positive.');
  if (p <= d) warnings.push('Pitch must exceed rivet diameter (net section ≤ 0).');
  if (n <= 0) warnings.push('Rivet count must be positive.');

  const shear = n * m * (Math.PI / 4) * d * d * input.allowableShearMPa;
  const bearing = n * d * t * input.allowableBearingMPa;
  const tearing = Math.max(p - d, 0) * t * input.allowableTensionMPa;

  const modes: { mode: RivetFailureMode; load: number }[] = [
    { mode: 'shear', load: shear },
    { mode: 'bearing', load: bearing },
    { mode: 'tearing', load: tearing },
  ];
  modes.sort((a, b) => a.load - b.load);
  const governing = modes[0]!;

  const solidPlate = p * t * input.allowableTensionMPa;
  const efficiency = solidPlate > 0 ? governing.load / solidPlate : 0;

  return {
    shearLoadN: shear,
    bearingLoadN: bearing,
    tearingLoadN: tearing,
    capacityN: governing.load,
    governingMode: governing.mode,
    efficiency,
    warnings,
  };
}

/** Rivet count needed to carry a target load without shear failure. */
export function rivetsForLoad(input: Omit<RivetJointInput, 'rivetCount'>, targetLoadN: number): number {
  const m = input.shearType === 'double' ? 2 : 1;
  const perRivet = m * (Math.PI / 4) * input.rivetDiameterMm ** 2 * input.allowableShearMPa;
  return perRivet > 0 ? Math.ceil(targetLoadN / perRivet) : Infinity;
}

export function summarize(r: RivetJointResult): {
  capacityN: number; governingMode: RivetFailureMode; efficiency: number;
} {
  return { capacityN: r.capacityN, governingMode: r.governingMode, efficiency: r.efficiency };
}
