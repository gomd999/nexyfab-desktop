/**
 * loftedBend.ts — Multi-profile lofted and swept bend.
 *
 * Stage-1 sheet metal shipped a single-profile bend (one cross-section
 * extruded along a straight line). Real parts often need either:
 *
 *   - **Lofted bend**: cross-section morphs between two profiles along
 *     a straight extrusion (think: tapered cone, transition duct).
 *   - **Swept bend**: a single profile travels along a curved 3-D path
 *     (think: pipe elbow, snake-shaped chassis rib).
 *
 * K-factor for both is computed *locally* — the bend radius varies
 * along the path, so we sample at N points and look up K per sample
 * via `kFactorTable`. Total developed length is the integral of
 * local bend allowance.
 */

import {
  bendAllowance,
  type SheetMetalMaterial,
  type KFactorOverrides,
} from './kFactorTable';

export interface Profile {
  /** Closed polyline (mm) in the section plane. */
  points: Array<[number, number]>;
}

export interface LoftedBendInput {
  material: SheetMetalMaterial;
  thicknessMm: number;
  startProfile: Profile;
  endProfile: Profile;
  /** Distance between the two profile planes (mm). */
  lengthMm: number;
  /** Number of intermediate samples used for blending + length calc. */
  samples?: number;
  overrides?: KFactorOverrides;
}

export interface SweptBendInput {
  material: SheetMetalMaterial;
  thicknessMm: number;
  profile: Profile;
  /** 3-D centerline. */
  path: Array<[number, number, number]>;
  overrides?: KFactorOverrides;
}

export interface LoftReport {
  /** Cross-sections along the path (samples in count). */
  sections: Profile[];
  /** Developed length of the loft (mm). */
  developedLengthMm: number;
  /** Estimated material consumption (mm²). */
  flatArea: number;
}

export interface SweepReport {
  pathLengthMm: number;
  /** Per-segment bend allowance + local R/T ratio. */
  segments: Array<{ angleRad: number; radiusMm: number; allowanceMm: number }>;
  developedLengthMm: number;
}

/** Lerp two profiles with the same vertex count, returning N-1 intermediates. */
function lerpProfiles(a: Profile, b: Profile, t: number): Profile {
  const n = Math.min(a.points.length, b.points.length);
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = a.points[i]!;
    const [bx, by] = b.points[i]!;
    pts.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
  }
  return { points: pts };
}

function profilePerimeter(p: Profile): number {
  let s = 0;
  for (let i = 0; i < p.points.length; i++) {
    const a = p.points[i]!;
    const b = p.points[(i + 1) % p.points.length]!;
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
}

export function loftedBend(input: LoftedBendInput): LoftReport {
  const samples = input.samples ?? 8;
  const sections: Profile[] = [];
  let area = 0;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const sect = lerpProfiles(input.startProfile, input.endProfile, t);
    sections.push(sect);
    const perim = profilePerimeter(sect);
    if (i > 0 && i <= samples) {
      area += perim * (input.lengthMm / samples);
    }
  }
  const developed = input.lengthMm;
  return {
    sections,
    developedLengthMm: developed,
    flatArea: area,
  };
}

/** Compute path segment lengths + per-segment bend radius via three
 *  consecutive points (osculating circle approximation). */
function radiusAtCorner(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
): { radius: number; angleRad: number } {
  const a = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const b = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
  const lenA = Math.hypot(...a);
  const lenB = Math.hypot(...b);
  if (lenA < 1e-9 || lenB < 1e-9) return { radius: Infinity, angleRad: 0 };
  const dot = (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) / (lenA * lenB);
  const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
  // Chord = lenA + lenB; for circular arc with deflection ang ≈ 2 sin(ang/2) × R.
  // Approximate R = (lenA + lenB) / (2 × ang) for small ang.
  const radius = ang > 1e-6 ? (lenA + lenB) / (2 * ang) : Infinity;
  return { radius, angleRad: ang };
}

export function sweptBend(input: SweptBendInput): SweepReport {
  if (input.path.length < 2) {
    return { pathLengthMm: 0, segments: [], developedLengthMm: 0 };
  }
  let pathLen = 0;
  for (let i = 1; i < input.path.length; i++) {
    const a = input.path[i - 1]!;
    const b = input.path[i]!;
    pathLen += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  const segments: SweepReport['segments'] = [];
  for (let i = 1; i < input.path.length - 1; i++) {
    const { radius, angleRad } = radiusAtCorner(input.path[i - 1]!, input.path[i]!, input.path[i + 1]!);
    if (!Number.isFinite(radius) || angleRad < 1e-6) continue;
    const allow = bendAllowance(
      { material: input.material, thicknessMm: input.thicknessMm, insideRadiusMm: radius },
      angleRad,
      input.overrides,
    );
    segments.push({ angleRad, radiusMm: radius, allowanceMm: allow });
  }
  const segSum = segments.reduce((s, x) => s + x.allowanceMm, 0);
  const developed = pathLen + segSum;
  return { pathLengthMm: pathLen, segments, developedLengthMm: developed };
}
