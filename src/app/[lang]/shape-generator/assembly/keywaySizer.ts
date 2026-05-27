/**
 * keywaySizer.ts — Size a parallel key (and its keyway) transmitting
 * torque between a shaft and hub, checking both shear and bearing
 * (compression) stresses.
 *
 * Tangential force at the shaft surface from torque T:
 *   F = T / (d/2) = 2·T / d
 *
 * Key shear stress (sheared across width b over length L):
 *   τ = F / (b·L)
 *
 * Key/keyway bearing stress (crushing on the half-height h/2 over L):
 *   σ_brg = F / ((h/2)·L)
 *
 * Standard key cross-sections (b×h) follow DIN 6885 / ISO 773 by shaft
 * diameter band. We recommend the standard key size for the shaft, then
 * compute the minimum key length to keep both stresses under allowable.
 */

export interface KeywayInput {
  shaftDiameterMm: number;
  torqueNm: number;
  keyLengthMm?: number;          // if omitted, solve minimum length
  allowableShearMpa: number;     // key material
  allowableBearingMpa: number;   // weaker of key/hub
  keyWidthMm?: number;           // override standard
  keyHeightMm?: number;          // override standard
}

export interface KeywayResult {
  keyWidthMm: number;
  keyHeightMm: number;
  tangentialForceN: number;
  shearStressMpa: number | null;
  bearingStressMpa: number | null;
  minLengthForShearMm: number;
  minLengthForBearingMm: number;
  recommendedLengthMm: number;
  shearOk: boolean | null;
  bearingOk: boolean | null;
  warnings: string[];
}

// DIN 6885 standard key b×h by shaft diameter upper bound.
const KEY_TABLE: { maxDia: number; b: number; h: number }[] = [
  { maxDia: 8, b: 2, h: 2 },
  { maxDia: 10, b: 3, h: 3 },
  { maxDia: 12, b: 4, h: 4 },
  { maxDia: 17, b: 5, h: 5 },
  { maxDia: 22, b: 6, h: 6 },
  { maxDia: 30, b: 8, h: 7 },
  { maxDia: 38, b: 10, h: 8 },
  { maxDia: 44, b: 12, h: 8 },
  { maxDia: 50, b: 14, h: 9 },
  { maxDia: 58, b: 16, h: 10 },
  { maxDia: 65, b: 18, h: 11 },
  { maxDia: 75, b: 20, h: 12 },
  { maxDia: 85, b: 22, h: 14 },
  { maxDia: 95, b: 25, h: 14 },
  { maxDia: 110, b: 28, h: 16 },
];

export function standardKeyFor(shaftDiameterMm: number): { b: number; h: number } {
  for (const row of KEY_TABLE) {
    if (shaftDiameterMm <= row.maxDia) return { b: row.b, h: row.h };
  }
  const last = KEY_TABLE[KEY_TABLE.length - 1]!;
  return { b: last.b, h: last.h };
}

export function size(input: KeywayInput): KeywayResult {
  const warnings: string[] = [];
  if (input.shaftDiameterMm <= 0) warnings.push('Shaft diameter must be positive.');
  if (input.torqueNm <= 0) warnings.push('Torque must be positive.');

  const std = standardKeyFor(input.shaftDiameterMm);
  const b = input.keyWidthMm ?? std.b;
  const h = input.keyHeightMm ?? std.h;

  // Tangential force (N): T[N·m]→N·mm = ×1000, /(d/2)[mm].
  const force = input.shaftDiameterMm > 0 ? (input.torqueNm * 1000) / (input.shaftDiameterMm / 2) : 0;

  // Minimum lengths so stress = allowable.
  const minLenShear = input.allowableShearMpa > 0 ? force / (b * input.allowableShearMpa) : Infinity;
  const minLenBearing = input.allowableBearingMpa > 0 ? force / ((h / 2) * input.allowableBearingMpa) : Infinity;
  const recommended = Math.max(minLenShear, minLenBearing);

  let shearStress: number | null = null;
  let bearingStress: number | null = null;
  let shearOk: boolean | null = null;
  let bearingOk: boolean | null = null;
  if (input.keyLengthMm != null && input.keyLengthMm > 0) {
    const L = input.keyLengthMm;
    shearStress = force / (b * L);
    bearingStress = force / ((h / 2) * L);
    shearOk = shearStress <= input.allowableShearMpa + 1e-9;
    bearingOk = bearingStress <= input.allowableBearingMpa + 1e-9;
  }

  return {
    keyWidthMm: b,
    keyHeightMm: h,
    tangentialForceN: force,
    shearStressMpa: shearStress,
    bearingStressMpa: bearingStress,
    minLengthForShearMm: minLenShear,
    minLengthForBearingMm: minLenBearing,
    recommendedLengthMm: recommended,
    shearOk,
    bearingOk,
    warnings,
  };
}

/** The governing failure mode at the recommended length. */
export function governingMode(result: KeywayResult): 'shear' | 'bearing' {
  return result.minLengthForShearMm >= result.minLengthForBearingMm ? 'shear' : 'bearing';
}

export function summarize(r: KeywayResult): { keyWidthMm: number; keyHeightMm: number; recommendedLengthMm: number } {
  return { keyWidthMm: r.keyWidthMm, keyHeightMm: r.keyHeightMm, recommendedLengthMm: r.recommendedLengthMm };
}
