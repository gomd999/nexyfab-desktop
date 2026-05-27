/**
 * helicalBevelGears.ts — Parametric helical & bevel gear generators.
 *
 * The existing `shapes/gear.ts` produces involute *spur* gears (straight
 * teeth). This module adds the two most-requested follow-ups for
 * shop drawings:
 *
 *   - **Helical gear** — spur tooth profile twisted along the axis.
 *     Defined by helix angle β. Generates a stack of cross-sections
 *     plus side-wall triangulation.
 *
 *   - **Straight bevel gear** — conical pitch surface. Teeth shrink
 *     from outer to inner cone. Defined by pitch cone angle γ.
 *
 * Both share the same module-based parameter set (module m, tooth count
 * z, pressure angle α=20°). Output is mesh arrays the caller can feed
 * to Three.js BufferGeometry.
 */

export interface HelicalParams {
  /** Module (m), mm. */
  module: number;
  /** Tooth count. */
  teeth: number;
  /** Helix angle β, degrees. */
  helixAngleDeg: number;
  /** Gear face width along axis, mm. */
  faceWidthMm: number;
  /** Pressure angle α, degrees. Default 20. */
  pressureAngleDeg?: number;
  /** Number of axial slices (more = smoother twist). */
  axialSlices: number;
  /** Points per tooth flank. */
  flankSamples: number;
}

export interface BevelParams {
  /** Module (m), mm. */
  module: number;
  /** Tooth count. */
  teeth: number;
  /** Pitch cone angle γ, degrees (apex half-angle). */
  pitchConeAngleDeg: number;
  /** Face width along the cone slant, mm. */
  faceWidthMm: number;
  /** Pressure angle α, degrees. Default 20. */
  pressureAngleDeg?: number;
  /** Number of slices along the slant. */
  slices: number;
  /** Points per tooth flank. */
  flankSamples: number;
}

export interface MeshArrays {
  /** Flat positions [x,y,z, x,y,z, ...]. */
  positions: number[];
  /** Flat triangle indices [a,b,c, a,b,c, ...]. */
  indices: number[];
}

// ── Helical gear ───────────────────────────────────────────────

export function buildHelicalGear(params: HelicalParams): MeshArrays {
  const alpha = ((params.pressureAngleDeg ?? 20) * Math.PI) / 180;
  const beta = (params.helixAngleDeg * Math.PI) / 180;
  const m = params.module;
  const z = params.teeth;
  const pitchRadius = (m * z) / 2;
  const baseRadius = pitchRadius * Math.cos(alpha);
  const addendum = m;
  const dedendum = 1.25 * m;
  const outerRadius = pitchRadius + addendum;
  const rootRadius = pitchRadius - dedendum;

  const positions: number[] = [];
  const indices: number[] = [];

  // Build cross-section profile (one tooth period × z teeth).
  const profile = buildToothProfile(z, baseRadius, pitchRadius, outerRadius, rootRadius, params.flankSamples);

  // Stack axial slices with twist.
  const slices = Math.max(2, params.axialSlices);
  const sliceCount = slices;
  for (let s = 0; s < sliceCount; s++) {
    const t = s / (sliceCount - 1);
    const z0 = (t - 0.5) * params.faceWidthMm;
    const twistAngle = z0 * Math.tan(beta) / pitchRadius;
    for (const p of profile) {
      const cos = Math.cos(twistAngle);
      const sin = Math.sin(twistAngle);
      positions.push(p[0] * cos - p[1] * sin, p[0] * sin + p[1] * cos, z0);
    }
  }

  const ptsPerSlice = profile.length;
  // Side walls.
  for (let s = 0; s < sliceCount - 1; s++) {
    for (let i = 0; i < ptsPerSlice; i++) {
      const i1 = (i + 1) % ptsPerSlice;
      const a = s * ptsPerSlice + i;
      const b = s * ptsPerSlice + i1;
      const c = (s + 1) * ptsPerSlice + i1;
      const d = (s + 1) * ptsPerSlice + i;
      indices.push(a, b, c);
      indices.push(a, c, d);
    }
  }

  // End caps (fan triangulation around centroid).
  capFan(positions, indices, 0, ptsPerSlice, +params.faceWidthMm * 0); // top
  capFan(positions, indices, (sliceCount - 1) * ptsPerSlice, ptsPerSlice, 0); // bottom

  return { positions, indices };
}

function buildToothProfile(
  teeth: number,
  baseR: number,
  pitchR: number,
  outerR: number,
  rootR: number,
  flankSamples: number,
): Array<[number, number]> {
  const angleStep = (2 * Math.PI) / teeth;
  const profile: Array<[number, number]> = [];
  for (let i = 0; i < teeth; i++) {
    const centerAngle = i * angleStep;
    const thicknessAngle = angleStep * 0.4;
    // Left flank: involute from base to outer.
    for (let j = 0; j <= flankSamples; j++) {
      const t = j / flankSamples;
      const r = baseR + (outerR - baseR) * t;
      if (r < baseR) continue;
      const inv = involutePoint(baseR, r);
      const angle = centerAngle - thicknessAngle / 2 + inv.theta;
      profile.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
    // Right flank: mirrored.
    for (let j = flankSamples; j >= 0; j--) {
      const t = j / flankSamples;
      const r = baseR + (outerR - baseR) * t;
      if (r < baseR) continue;
      const inv = involutePoint(baseR, r);
      const angle = centerAngle + thicknessAngle / 2 - inv.theta;
      profile.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
    // Root arc.
    const rootSamples = 4;
    for (let j = 0; j <= rootSamples; j++) {
      const t = j / rootSamples;
      const angle = centerAngle + thicknessAngle / 2 + t * (angleStep - thicknessAngle);
      profile.push([rootR * Math.cos(angle), rootR * Math.sin(angle)]);
    }
  }
  return profile;
}

function involutePoint(baseR: number, r: number): { x: number; y: number; theta: number } {
  if (r <= baseR) return { x: baseR, y: 0, theta: 0 };
  const alpha = Math.acos(baseR / r);
  const theta = Math.tan(alpha) - alpha;
  return { x: r * Math.cos(theta), y: r * Math.sin(theta), theta };
}

function capFan(positions: number[], indices: number[], startVertex: number, count: number, _z: number): void {
  // Compute centroid for the slice and add it.
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < count; i++) {
    cx += positions[(startVertex + i) * 3]!;
    cy += positions[(startVertex + i) * 3 + 1]!;
    cz += positions[(startVertex + i) * 3 + 2]!;
  }
  cx /= count; cy /= count; cz /= count;
  const centerIdx = positions.length / 3;
  positions.push(cx, cy, cz);
  for (let i = 0; i < count; i++) {
    const a = startVertex + i;
    const b = startVertex + ((i + 1) % count);
    indices.push(centerIdx, a, b);
  }
}

// ── Bevel gear ─────────────────────────────────────────────────

export function buildStraightBevelGear(params: BevelParams): MeshArrays {
  const m = params.module;
  const z = params.teeth;
  const gamma = (params.pitchConeAngleDeg * Math.PI) / 180;
  const alpha = ((params.pressureAngleDeg ?? 20) * Math.PI) / 180;
  const slices = Math.max(2, params.slices);

  const positions: number[] = [];
  const indices: number[] = [];
  const ptsPerSlice = z * (2 * (params.flankSamples + 1) + 5);

  for (let s = 0; s < slices; s++) {
    const t = s / (slices - 1);
    const slantPos = t * params.faceWidthMm;
    // Pitch radius shrinks along slant according to cone angle.
    const radiusAtSlice = (m * z / 2) - slantPos * Math.sin(gamma);
    const axialZ = slantPos * Math.cos(gamma);
    if (radiusAtSlice <= 0) continue;

    const baseR = radiusAtSlice * Math.cos(alpha);
    const pitchR = radiusAtSlice;
    const outerR = pitchR + m * (1 - t * 0.5);
    const rootR = Math.max(0.1, pitchR - 1.25 * m * (1 - t * 0.5));

    const profile = buildToothProfile(z, baseR, pitchR, outerR, rootR, params.flankSamples);
    for (const p of profile) {
      positions.push(p[0], p[1], axialZ);
    }
    while (positions.length / 3 < (s + 1) * ptsPerSlice / z * z + s * ptsPerSlice) {
      // pad if profile shorter than expected — rare but keeps slice indexing simple
      positions.push(p_pad(positions));
    }
  }

  // Build a coarse strip between consecutive slices using min length.
  const actualSliceLen = Math.floor(positions.length / (3 * slices));
  for (let s = 0; s < slices - 1; s++) {
    for (let i = 0; i < actualSliceLen - 1; i++) {
      const a = s * actualSliceLen + i;
      const b = s * actualSliceLen + i + 1;
      const c = (s + 1) * actualSliceLen + i + 1;
      const d = (s + 1) * actualSliceLen + i;
      indices.push(a, b, c);
      indices.push(a, c, d);
    }
  }

  return { positions, indices };
}

function p_pad(positions: number[]): number {
  const last = positions[positions.length - 1];
  return typeof last === 'number' ? last : 0;
}

// ── Stats ──────────────────────────────────────────────────────

export interface GearStats {
  vertexCount: number;
  triangleCount: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
}

export function meshStats(mesh: MeshArrays): GearStats {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const v = mesh.positions[i + j]!;
      if (v < min[j]!) min[j] = v;
      if (v > max[j]!) max[j] = v;
    }
  }
  if (mesh.positions.length === 0) {
    return { vertexCount: 0, triangleCount: 0, bbox: { min: [0, 0, 0], max: [0, 0, 0] } };
  }
  return {
    vertexCount: mesh.positions.length / 3,
    triangleCount: mesh.indices.length / 3,
    bbox: { min, max },
  };
}

// ── Pitch parameters helper ────────────────────────────────────

export interface GearPitchInfo {
  pitchRadiusMm: number;
  baseRadiusMm: number;
  outerRadiusMm: number;
  rootRadiusMm: number;
  circularPitchMm: number;
}

export function pitchInfo(module: number, teeth: number, pressureAngleDeg: number = 20): GearPitchInfo {
  const pitchR = (module * teeth) / 2;
  const alpha = (pressureAngleDeg * Math.PI) / 180;
  return {
    pitchRadiusMm: pitchR,
    baseRadiusMm: pitchR * Math.cos(alpha),
    outerRadiusMm: pitchR + module,
    rootRadiusMm: pitchR - 1.25 * module,
    circularPitchMm: Math.PI * module,
  };
}
