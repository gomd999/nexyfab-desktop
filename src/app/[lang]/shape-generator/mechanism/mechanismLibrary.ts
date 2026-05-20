/**
 * mechanismLibrary.ts — Preset mechanical mechanisms.
 *
 * Quick-start templates for the most common mechanical movements:
 *   - Spur gear (involute teeth)
 *   - Bevel gear (45°)
 *   - Cam profile (eccentric / harmonic / dwell)
 *   - 4-bar linkage
 *   - Slider-crank
 *
 * Each preset produces:
 *   - 2D sketch profile(s) ready for extrude / revolve
 *   - Required parameter list with sane defaults
 *   - Optional kinematic constraints (used by motion study)
 */

export interface SpurGearParams {
  module: number;       // mm per tooth (ISO module)
  teethCount: number;
  pressureAngleDeg: number; // standard 20°
  faceWidthMm: number;
}

export interface SpurGearProfile {
  /** Pitch radius (mm). */
  pitchRadius: number;
  /** Base circle radius (for involute). */
  baseRadius: number;
  /** Addendum + dedendum. */
  outerRadius: number;
  rootRadius: number;
  /** 2D tooth profile points (closed loop). */
  profile: Array<[number, number]>;
}

/** Generate an involute spur gear 2D profile. */
export function spurGearProfile(params: SpurGearParams): SpurGearProfile {
  const m = params.module;
  const z = params.teethCount;
  const pitchR = m * z / 2;
  const baseR = pitchR * Math.cos(params.pressureAngleDeg * Math.PI / 180);
  const addendum = m;
  const dedendum = 1.25 * m;
  const outerR = pitchR + addendum;
  const rootR = pitchR - dedendum;

  // Each tooth has 2 involute flanks + tip arc + root fillet.
  // Simplified: trapezoidal teeth for the preset preview.
  const toothAngle = (2 * Math.PI) / z;
  const profile: Array<[number, number]> = [];
  for (let i = 0; i < z; i++) {
    const centerA = i * toothAngle;
    const halfThickness = toothAngle * 0.4;
    const innerStartA = centerA - halfThickness * 1.1;
    const innerEndA   = centerA + halfThickness * 1.1;
    const outerStartA = centerA - halfThickness;
    const outerEndA   = centerA + halfThickness;
    // Root-side start.
    profile.push([rootR * Math.cos(innerStartA), rootR * Math.sin(innerStartA)]);
    // Tip-side.
    profile.push([outerR * Math.cos(outerStartA), outerR * Math.sin(outerStartA)]);
    profile.push([outerR * Math.cos(outerEndA),   outerR * Math.sin(outerEndA)]);
    profile.push([rootR * Math.cos(innerEndA),    rootR * Math.sin(innerEndA)]);
  }
  return { pitchRadius: pitchR, baseRadius: baseR, outerRadius: outerR, rootRadius: rootR, profile };
}

// ── Cam profiles ───────────────────────────────────────────────────

export type CamType = 'eccentric' | 'harmonic' | 'dwell-rise-dwell-fall';

export interface CamParams {
  type: CamType;
  /** Base circle radius (mm). */
  baseRadiusMm: number;
  /** Maximum follower lift (mm). */
  liftMm: number;
  /** Total rotations. */
  samples: number;
}

export function camProfile(params: CamParams): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const N = Math.max(36, params.samples);
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2;
    let r: number;
    switch (params.type) {
      case 'eccentric':
        // Sine-shaped eccentricity.
        r = params.baseRadiusMm + params.liftMm * (0.5 + 0.5 * Math.cos(angle));
        break;
      case 'harmonic':
        r = params.baseRadiusMm + params.liftMm * (1 - Math.cos(angle)) / 2;
        break;
      case 'dwell-rise-dwell-fall':
        // 4 phases of equal length.
        if (angle < Math.PI / 2) r = params.baseRadiusMm; // dwell low
        else if (angle < Math.PI) r = params.baseRadiusMm + params.liftMm * ((angle - Math.PI / 2) / (Math.PI / 2));
        else if (angle < 3 * Math.PI / 2) r = params.baseRadiusMm + params.liftMm;
        else r = params.baseRadiusMm + params.liftMm * (1 - (angle - 3 * Math.PI / 2) / (Math.PI / 2));
        break;
    }
    out.push([r * Math.cos(angle), r * Math.sin(angle)]);
  }
  return out;
}

// ── Linkages ───────────────────────────────────────────────────────

export interface FourBarLinkage {
  /** Crank length (mm). */
  crankMm: number;
  /** Coupler length (mm). */
  couplerMm: number;
  /** Rocker length (mm). */
  rockerMm: number;
  /** Ground link (frame distance) length (mm). */
  groundMm: number;
}

/** Compute crank-rocker linkage validity per Grashof's law. */
export function grashofCheck(link: FourBarLinkage): {
  isGrashof: boolean;
  type: 'crank-rocker' | 'double-crank' | 'double-rocker' | 'invalid';
} {
  const sides = [link.crankMm, link.couplerMm, link.rockerMm, link.groundMm].sort((a, b) => a - b);
  const grashof = sides[0]! + sides[3]! <= sides[1]! + sides[2]!;
  // Identify shortest link role.
  const shortest = Math.min(...sides);
  let type: 'crank-rocker' | 'double-crank' | 'double-rocker' | 'invalid';
  if (!grashof) type = 'invalid';
  else if (shortest === link.crankMm || shortest === link.rockerMm) type = 'crank-rocker';
  else if (shortest === link.couplerMm) type = 'double-rocker';
  else type = 'double-crank';
  return { isGrashof: grashof, type };
}

/** Slider-crank — computes piston position from crank angle. */
export interface SliderCrank {
  crankMm: number;
  conRodMm: number;
}

export function sliderCrankPosition(sc: SliderCrank, crankAngleRad: number): number {
  // x = r·cos(θ) + √(L² − (r·sin(θ))²)
  const r = sc.crankMm;
  const L = sc.conRodMm;
  const sinSq = (r * Math.sin(crankAngleRad)) ** 2;
  if (sinSq > L * L) return r + L; // invalid configuration — return TDC
  return r * Math.cos(crankAngleRad) + Math.sqrt(L * L - sinSq);
}
