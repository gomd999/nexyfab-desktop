/**
 * retainingRingGroove.ts — Size the groove for an external (shaft) or
 * internal (bore) retaining ring (circlip) per the DIN 471/472 family,
 * and check the thrust-load capacity.
 *
 * Groove geometry from nominal diameter d:
 *   - groove diameter  d_g = d − 2·t      (external; t = groove depth)
 *   - groove width     w   ≈ ring thickness + clearance
 *   - groove depth     t   scales with d (≈ 0.05·d for common ranges)
 *
 * Thrust capacity is limited by the lower of:
 *   1. Ring shear/dishing (ring strength) — given as a rated load.
 *   2. Groove wall crush in the SHAFT/HOUSING material:
 *        F_groove = π · d_g · t · σ_yield / safetyFactor
 *   3. Ring deformation (ring rolls out of groove) — proportional to
 *        groove depth / ring radial width.
 *
 * We return groove dims + the governing allowable thrust.
 */

export type RingType = 'external' | 'internal';

export interface RetainingRingInput {
  nominalDiameterMm: number; // shaft OD (external) or bore ID (internal)
  ringType: RingType;
  ringThicknessMm: number;
  grooveDepthMm?: number;    // override; else ≈ 0.05·d
  grooveWidthClearanceMm?: number; // added to ring thickness, default 0.1
  housingYieldMpa: number;   // groove material yield
  safetyFactor?: number;     // default 2
  ringRatedThrustN?: number; // from ring catalogue, optional
}

export interface RetainingRingResult {
  grooveDiameterMm: number;
  grooveDepthMm: number;
  grooveWidthMm: number;
  grooveCrushThrustN: number;
  governingThrustN: number;
  governingMode: 'groove-crush' | 'ring-rating';
  warnings: string[];
}

export function size(input: RetainingRingInput): RetainingRingResult {
  const warnings: string[] = [];
  const d = input.nominalDiameterMm;
  if (d <= 0) warnings.push('Nominal diameter must be positive.');
  if (input.ringThicknessMm <= 0) warnings.push('Ring thickness must be positive.');
  if (input.housingYieldMpa <= 0) warnings.push('Housing yield must be positive.');

  const t = input.grooveDepthMm ?? 0.05 * d;
  const w = input.ringThicknessMm + (input.grooveWidthClearanceMm ?? 0.1);
  const grooveDia = input.ringType === 'external' ? d - 2 * t : d + 2 * t;

  const safety = input.safetyFactor ?? 2;
  // Groove wall crush: shearing the groove shoulder over its cylindrical area.
  // Bearing area ≈ π·d_g·t (the groove wall the ring pushes against).
  const bearingArea = Math.PI * grooveDia * t;
  const grooveCrush = (bearingArea * input.housingYieldMpa) / safety;

  let governing = grooveCrush;
  let mode: 'groove-crush' | 'ring-rating' = 'groove-crush';
  if (input.ringRatedThrustN != null && input.ringRatedThrustN < governing) {
    governing = input.ringRatedThrustN;
    mode = 'ring-rating';
  }

  return {
    grooveDiameterMm: grooveDia,
    grooveDepthMm: t,
    grooveWidthMm: w,
    grooveCrushThrustN: grooveCrush,
    governingThrustN: governing,
    governingMode: mode,
    warnings,
  };
}

/** Safety factor at an applied thrust load. */
export function safetyAt(result: RetainingRingResult, appliedThrustN: number): number {
  if (appliedThrustN <= 0) return Infinity;
  return result.governingThrustN / appliedThrustN;
}

/** Sharp-corner stress concentration factor estimate at the groove root. */
export function grooveStressConcentration(grooveDepthMm: number, rootRadiusMm: number): number {
  // Kt ≈ 1 + 2·√(t/r) (Neuber-like for a notch). Sharp root → high Kt.
  if (rootRadiusMm <= 0) return Infinity;
  return 1 + 2 * Math.sqrt(grooveDepthMm / rootRadiusMm);
}

export function summarize(r: RetainingRingResult): { grooveDiameterMm: number; grooveDepthMm: number; governingThrustN: number } {
  return { grooveDiameterMm: r.grooveDiameterMm, grooveDepthMm: r.grooveDepthMm, governingThrustN: r.governingThrustN };
}
