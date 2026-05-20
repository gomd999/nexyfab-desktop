/**
 * shrinkageCompensator.ts — Scale a mold cavity to compensate for the
 * shrinkage of the molded part as it cools, so the final part hits
 * nominal dimensions.
 *
 * Mold-maker rule: cavity = nominal × (1 + S), where S is the mould-
 * shrinkage allowance (a fraction, e.g. 0.018 = 1.8 % for PP). The
 * "shrink factor" you scale the CAD model by is therefore (1 + S).
 *
 * Anisotropic materials (fibre-filled, semi-crystalline) shrink
 * differently along vs across flow, so we accept a per-axis allowance
 * (Sx, Sy, Sz) and a flow direction.
 *
 * We expose: scale factors, the corrected cavity dimensions, and the
 * residual error if a single isotropic factor were used instead.
 */

export type ShrinkAxis = 'x' | 'y' | 'z';

export interface ShrinkageInput {
  nominalDimsMm: { x: number; y: number; z: number };
  // shrinkage allowance per axis as a fraction (e.g. 0.018). If only
  // isotropic given, set all three equal.
  shrinkageFraction: { x: number; y: number; z: number };
}

export interface ShrinkageResult {
  scaleFactors: { x: number; y: number; z: number };
  cavityDimsMm: { x: number; y: number; z: number };
  isotropicEquivalent: number;          // single factor that best fits
  maxAnisotropyErrorMm: number;         // worst axis error if isotropic used
  warnings: string[];
}

export function compensate(input: ShrinkageInput): ShrinkageResult {
  const warnings: string[] = [];
  const s = input.shrinkageFraction;
  if (s.x < 0 || s.y < 0 || s.z < 0) warnings.push('Shrinkage fractions should be non-negative.');
  if (s.x > 0.1 || s.y > 0.1 || s.z > 0.1) warnings.push('Shrinkage > 10 % is unusually high; check units (fraction, not %).');

  const scale = { x: 1 + s.x, y: 1 + s.y, z: 1 + s.z };
  const cavity = {
    x: input.nominalDimsMm.x * scale.x,
    y: input.nominalDimsMm.y * scale.y,
    z: input.nominalDimsMm.z * scale.z,
  };

  const isoFactor = (scale.x + scale.y + scale.z) / 3;
  // Residual error if we used isoFactor on each axis instead of per-axis.
  const errs = [
    Math.abs(input.nominalDimsMm.x * isoFactor - cavity.x),
    Math.abs(input.nominalDimsMm.y * isoFactor - cavity.y),
    Math.abs(input.nominalDimsMm.z * isoFactor - cavity.z),
  ];
  const maxErr = Math.max(...errs);

  return {
    scaleFactors: scale,
    cavityDimsMm: cavity,
    isotropicEquivalent: isoFactor,
    maxAnisotropyErrorMm: maxErr,
    warnings,
  };
}

/** Inverse: given measured molded dims + the cavity used, back out actual shrinkage. */
export function measuredShrinkage(
  cavityDimsMm: { x: number; y: number; z: number },
  moldedDimsMm: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const calc = (cav: number, mold: number) => (mold > 0 ? (cav - mold) / mold : 0);
  return {
    x: calc(cavityDimsMm.x, moldedDimsMm.x),
    y: calc(cavityDimsMm.y, moldedDimsMm.y),
    z: calc(cavityDimsMm.z, moldedDimsMm.z),
  };
}

/** Typical shrinkage allowance (fraction) by polymer family — flow / cross averaged. */
export type ShrinkPolymer = 'PP' | 'PE' | 'ABS' | 'PS' | 'PC' | 'PA6' | 'PA66-GF' | 'POM' | 'PBT';

export function typicalShrinkage(polymer: ShrinkPolymer): number {
  const table: Record<ShrinkPolymer, number> = {
    PP: 0.018, PE: 0.020, ABS: 0.006, PS: 0.005, PC: 0.006,
    PA6: 0.012, 'PA66-GF': 0.004, POM: 0.020, PBT: 0.015,
  };
  return table[polymer];
}

export function summarize(r: ShrinkageResult): { scaleFactors: { x: number; y: number; z: number }; isotropicEquivalent: number } {
  return { scaleFactors: r.scaleFactors, isotropicEquivalent: r.isotropicEquivalent };
}
