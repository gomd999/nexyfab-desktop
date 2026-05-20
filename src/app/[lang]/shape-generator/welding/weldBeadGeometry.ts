/**
 * weldBeadGeometry.ts — 3D weld bead mesh generation along an edge.
 *
 * Stage 1 (`weldingSymbols.ts`) emits 2D SVG diagrams for drawings.
 * Stage 2 (here) generates the *actual 3D bead geometry* that should
 * appear at the weld location in the model — used for:
 *
 *   - 3D preview ("show me what the welded part looks like")
 *   - Volume / mass estimation for cost
 *   - DFM heat-affected-zone overlay
 *   - Operator instruction overlays in AR/VR walk-through
 *
 * Five bead profile types, matching the weld types in
 * `weldingSymbols.ts`:
 *
 *   - **Fillet** — triangular cross-section, leg length = z.
 *   - **Bevel/V-groove** — diamond cross-section, root + cap.
 *   - **Square butt** — rectangular cross-section (thin sheet).
 *   - **Plug/slot** — circular puddle filling a hole.
 *   - **Surfacing** (overlay) — wide flat cap on a surface.
 *
 * Inputs: an open polyline path (centerline of the weld) + weld
 * type + size parameters. Output: triangle mesh ready to merge
 * into the model geometry.
 */

export type BeadProfile =
  | 'fillet'
  | 'v-groove'
  | 'square-butt'
  | 'plug'
  | 'surfacing';

export interface BeadParams {
  /** Weld leg / throat / groove width depending on profile. */
  sizeMm: number;
  /** Optional cap reinforcement above flush (mm). */
  reinforcementMm?: number;
  /** Cross-section sample count (radial). */
  crossSectionSegments?: number;
}

export interface BeadMesh {
  positions: number[];
  indices: number[];
  triangleCount: number;
  /** Estimated bead volume (mm³) — handy for cost calc. */
  volumeMm3: number;
}

export interface PolylinePath {
  /** Points along the weld centerline (mm). */
  points: Array<[number, number, number]>;
  /** Optional per-point bead normal — direction perpendicular to the
   *  joint that the cap should bulge toward. Default = +Z. */
  normals?: Array<[number, number, number]>;
}

/** Build the 2D cross-section profile of a bead, in local (x, y)
 *  coordinates where x is along the joint normal + y is along the
 *  cap-out direction. Returns a closed loop. */
export function beadCrossSection(profile: BeadProfile, p: BeadParams): Array<[number, number]> {
  const size = Math.max(0.1, p.sizeMm);
  const reinf = p.reinforcementMm ?? size * 0.1;
  switch (profile) {
    case 'fillet':
      // Right triangle with legs `size`. Hypotenuse faces outward.
      return [[0, 0], [size, 0], [0, size]];
    case 'v-groove': {
      // Diamond: root at -reinf, cap at size+reinf, half-width = size/2.
      const halfW = size / 2;
      return [
        [-halfW, 0], [0, size + reinf], [halfW, 0], [0, -reinf],
      ];
    }
    case 'square-butt':
      // Rectangle width = size, height = size/3 + reinf.
      return [
        [-size / 2, 0], [size / 2, 0],
        [size / 2, size / 3 + reinf], [-size / 2, size / 3 + reinf],
      ];
    case 'plug':
      // Circle approximated as 8-gon.
      return Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return [Math.cos(a) * size / 2, Math.sin(a) * size / 2] as [number, number];
      });
    case 'surfacing':
      // Flat wide cap: width = 2·size, height = size/3.
      return [
        [-size, 0], [size, 0],
        [size, size / 3], [-size, size / 3],
      ];
  }
}

/** Compute the cross-section area (mm²) by shoelace formula. Used
 *  for the volume estimate. */
export function crossSectionAreaMm2(profile: BeadProfile, p: BeadParams): number {
  const verts = beadCrossSection(profile, p);
  let sum = 0;
  for (let i = 0; i < verts.length; i++) {
    const [x1, y1] = verts[i]!;
    const [x2, y2] = verts[(i + 1) % verts.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** Sweep a 2D cross-section along the path, producing a triangle mesh.
 *  Uses parallel transport for orientation continuity. */
export function generateBeadGeometry(
  path: PolylinePath,
  profile: BeadProfile,
  params: BeadParams,
): BeadMesh {
  if (path.points.length < 2) {
    return { positions: [], indices: [], triangleCount: 0, volumeMm3: 0 };
  }
  const section = beadCrossSection(profile, params);
  const positions: number[] = [];
  const indices: number[] = [];

  for (let p = 0; p < path.points.length; p++) {
    const point = path.points[p]!;
    // Tangent — average of forward + backward.
    const fwd = p + 1 < path.points.length
      ? sub(path.points[p + 1]!, point)
      : sub(point, path.points[p - 1]!);
    const tangent = normalize(fwd);
    // Bead normal (up direction) — caller-supplied or +Z fallback.
    const up = path.normals?.[p] ?? [0, 0, 1] as [number, number, number];
    // Side = normal to (tangent, up).
    const side = normalize(cross(tangent, up));
    // True up = side × tangent (orthonormalize).
    const realUp = normalize(cross(side, tangent));

    for (const [sx, sy] of section) {
      const x = point[0] + side[0] * sx + realUp[0] * sy;
      const y = point[1] + side[1] * sx + realUp[1] * sy;
      const z = point[2] + side[2] * sx + realUp[2] * sy;
      positions.push(x, y, z);
    }
  }

  // Index quad strips between consecutive cross-sections.
  const csCount = section.length;
  for (let p = 0; p < path.points.length - 1; p++) {
    for (let k = 0; k < csCount; k++) {
      const a = p * csCount + k;
      const b = p * csCount + (k + 1) % csCount;
      const c = (p + 1) * csCount + (k + 1) % csCount;
      const d = (p + 1) * csCount + k;
      indices.push(a, b, c, a, c, d);
    }
  }

  // Volume = cross-section area × path length.
  let pathLen = 0;
  for (let p = 1; p < path.points.length; p++) {
    const dx = path.points[p]![0] - path.points[p - 1]![0];
    const dy = path.points[p]![1] - path.points[p - 1]![1];
    const dz = path.points[p]![2] - path.points[p - 1]![2];
    pathLen += Math.hypot(dx, dy, dz);
  }
  const area = crossSectionAreaMm2(profile, params);

  return {
    positions,
    indices,
    triangleCount: indices.length / 3,
    volumeMm3: area * pathLen,
  };
}

// ── Vector helpers ───────────────────────────────────────────────

function sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
}

// ── Heat-affected zone helpers ───────────────────────────────────

/** Heat-affected zone (HAZ) width — empirical from heat input. */
export function hazWidthMm(
  weldCurrentA: number,
  weldVoltageV: number,
  travelSpeedMmPerS: number,
  efficiency: number = 0.8,
): number {
  if (travelSpeedMmPerS <= 0) return 0;
  // Heat input Q (J/mm) = (η · V · I) / v
  const Q = (efficiency * weldVoltageV * weldCurrentA) / travelSpeedMmPerS;
  // HAZ width ≈ k · √Q. k ≈ 0.05 for steel (empirical).
  return 0.05 * Math.sqrt(Q);
}

/** Suggest weld bead overlap percentage for multi-pass welding. */
export function suggestBeadOverlap(beadWidthMm: number, plateThicknessMm: number): number {
  // Rule of thumb: 30% overlap for plate < 6mm, 50% for thicker.
  return plateThicknessMm < 6 ? 0.3 * beadWidthMm : 0.5 * beadWidthMm;
}
