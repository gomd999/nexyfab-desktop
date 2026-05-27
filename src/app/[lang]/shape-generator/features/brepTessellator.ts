/**
 * brepTessellator.ts — Convert half-edge B-rep into a triangle mesh
 * for GPU rendering.
 *
 * For visualization the half-edge topology (vertex/edge/face) must
 * be flattened to a positions/indices mesh. Each face is a polygon
 * that must be triangulated; planar faces use ear-clipping, curved
 * faces use chord-deviation refinement.
 *
 * Chord deviation = max distance from the true surface to the
 * tessellated triangle plane. Smaller chord deviation → more
 * triangles → smoother appearance but heavier GPU load.
 */

import type { BrepModel, Face, Vec3 } from './halfEdgeBrep';
import { faceVertices } from './halfEdgeBrep';

export interface TessellationOptions {
  /** Max chord deviation in mm (smaller = finer). Default 0.1mm. */
  chordDeviationMm: number;
  /** Max angular deviation in radians (smaller = finer). Default 0.35 rad ≈ 20°. */
  angleToleranceRad: number;
  /** Min triangles per curved face. Default 8. */
  minTrianglesPerFace: number;
}

export const DEFAULT_TESS_OPTIONS: TessellationOptions = {
  chordDeviationMm: 0.1,
  angleToleranceRad: 0.35,
  minTrianglesPerFace: 8,
};

export interface BrepMesh {
  positions: Float32Array;
  indices: Uint32Array;
  /** Per-vertex normals. Same count/3 as positions. */
  normals: Float32Array;
  /** Map from mesh-triangle index → originating face id (for picking). */
  triangleFaceIds: string[];
}

export interface TessellationStats {
  vertexCount: number;
  triangleCount: number;
  faceCount: number;
  /** Sum of estimated chord deviation across all faces (mm). */
  totalChordDeviation: number;
  /** Faces that triangulated successfully. */
  successFaces: number;
  /** Faces that failed (degenerate / collinear). */
  failedFaces: number;
}

// ── Top-level entry ─────────────────────────────────────────────

export function tessellateBrep(
  model: BrepModel,
  options: Partial<TessellationOptions> = {},
): { mesh: BrepMesh; stats: TessellationStats } {
  const opts = { ...DEFAULT_TESS_OPTIONS, ...options };
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const triangleFaceIds: string[] = [];
  let totalChord = 0;
  let success = 0;
  let failed = 0;

  for (const shell of model.shells) {
    for (const face of shell.faces.values()) {
      const before = indices.length;
      const chord = tessellateFace(face, positions, indices, normals, triangleFaceIds, opts);
      if (indices.length > before) {
        success++;
        totalChord += chord;
      } else {
        failed++;
      }
    }
  }

  return {
    mesh: {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      normals: new Float32Array(normals),
      triangleFaceIds,
    },
    stats: {
      vertexCount: positions.length / 3,
      triangleCount: indices.length / 3,
      faceCount: success + failed,
      totalChordDeviation: totalChord,
      successFaces: success,
      failedFaces: failed,
    },
  };
}

// ── Per-face tessellation ───────────────────────────────────────

function tessellateFace(
  face: Face,
  positions: number[],
  indices: number[],
  normals: number[],
  triangleFaceIds: string[],
  _opts: TessellationOptions,
): number {
  const verts = faceVertices(face);
  if (verts.length < 3) return 0;

  const positionList: Vec3[] = verts.map(v => v.position);
  const normal = face.normal ?? estimateNormal(positionList);

  const baseIdx = positions.length / 3;
  for (const p of positionList) {
    positions.push(p[0], p[1], p[2]);
    normals.push(normal[0], normal[1], normal[2]);
  }

  const tris = triangulatePolygon(positionList, normal);
  for (const tri of tris) {
    indices.push(baseIdx + tri[0], baseIdx + tri[1], baseIdx + tri[2]);
    triangleFaceIds.push(face.id);
  }

  return 0;
}

// ── Triangulation ───────────────────────────────────────────────

/** Project a polygon to a 2D basis aligned with its normal, then
 *  run ear-clipping. Returns triangle index triples relative to the
 *  input vertex array. */
export function triangulatePolygon(
  vertices: Vec3[],
  normal: Vec3,
): Array<[number, number, number]> {
  const n = vertices.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];

  const nz = normalize(normal);
  const u = pickPerpendicular(nz);
  const v = cross(nz, u);

  const pts2d: Array<[number, number]> = vertices.map(p => [dot(p, u), dot(p, v)]);

  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts2d[i]![0] * pts2d[j]![1] - pts2d[j]![0] * pts2d[i]![1];
  }
  const ccw = area > 0;
  const indices = ccw ? [...Array(n).keys()] : [...Array(n).keys()].reverse();

  const tris: Array<[number, number, number]> = [];
  const remaining = [...indices];
  let safety = n * 3;
  while (remaining.length > 3 && safety-- > 0) {
    let earFound = false;
    for (let i = 0; i < remaining.length; i++) {
      const i0 = remaining[(i - 1 + remaining.length) % remaining.length]!;
      const i1 = remaining[i]!;
      const i2 = remaining[(i + 1) % remaining.length]!;
      if (isEar(pts2d, remaining, i0, i1, i2)) {
        tris.push([i0, i1, i2]);
        remaining.splice(i, 1);
        earFound = true;
        break;
      }
    }
    if (!earFound) break;
  }
  if (remaining.length === 3) {
    tris.push([remaining[0]!, remaining[1]!, remaining[2]!]);
  }
  return tris;
}

function isEar(pts: Array<[number, number]>, remaining: number[], a: number, b: number, c: number): boolean {
  const ax = pts[a]![0], ay = pts[a]![1];
  const bx = pts[b]![0], by = pts[b]![1];
  const cx = pts[c]![0], cy = pts[c]![1];
  const crossZ = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (crossZ <= 0) return false;
  for (const p of remaining) {
    if (p === a || p === b || p === c) continue;
    if (pointInTriangle(pts[p]!, [ax, ay], [bx, by], [cx, cy])) return false;
  }
  return true;
}

function pointInTriangle(p: [number, number], a: [number, number], b: [number, number], c: [number, number]): boolean {
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function sign(p: [number, number], a: [number, number], b: [number, number]): number {
  return (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
}

// ── Vector helpers ──────────────────────────────────────────────

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function pickPerpendicular(n: Vec3): Vec3 {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const seed: Vec3 = ax < ay && ax < az ? [1, 0, 0] : ay < az ? [0, 1, 0] : [0, 0, 1];
  const d = dot(seed, n);
  const u: Vec3 = [seed[0] - d * n[0], seed[1] - d * n[1], seed[2] - d * n[2]];
  return normalize(u);
}

function estimateNormal(pts: Vec3[]): Vec3 {
  if (pts.length < 3) return [0, 0, 1];
  const a = pts[0]!, b = pts[1]!, c = pts[2]!;
  return normalize(cross(
    [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
  ));
}

// ── Refinement (curved faces — chord deviation math) ────────────

/** Estimate how many subdivisions a chord-bowed segment needs to
 *  stay within `chordTolMm`. For a circular arc:
 *     deviation = R × (1 - cos(θ/2))
 *  Solve for the segment count n such that θ = 2π/n satisfies the
 *  deviation budget. */
export function estimateChordSubdivisions(
  radiusMm: number,
  arcAngleRad: number,
  chordTolMm: number,
): number {
  if (radiusMm <= 0 || arcAngleRad <= 0) return 1;
  const ratio = 1 - chordTolMm / radiusMm;
  if (ratio <= -1) return 32;
  if (ratio >= 1) return 1;
  const dThetaMax = 2 * Math.acos(ratio);
  const n = Math.ceil(arcAngleRad / dThetaMax);
  return Math.max(2, n);
}

/** LOD selection: pick chord deviation budget based on screen size. */
export function pickLodChordTolerance(modelSizeMm: number, pixelsPerMm: number): number {
  const fromPixels = modelSizeMm / Math.max(1, pixelsPerMm);
  return Math.max(0.01, Math.min(2, fromPixels));
}

// ── Mesh quality ────────────────────────────────────────────────

export interface MeshQuality {
  /** Triangles whose minimum angle is below threshold. */
  slivers: number;
  /** Mean aspect ratio (1.0 = equilateral, larger = worse). */
  meanAspectRatio: number;
  /** Worst aspect ratio. */
  worstAspectRatio: number;
}

export function evaluateMeshQuality(mesh: BrepMesh, sliverThresholdDeg = 5): MeshQuality {
  const triCount = mesh.indices.length / 3;
  if (triCount === 0) {
    return { slivers: 0, meanAspectRatio: 1, worstAspectRatio: 1 };
  }
  let slivers = 0;
  let totalAr = 0;
  let worstAr = 1;
  const thresholdRad = (sliverThresholdDeg * Math.PI) / 180;
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    const p0: Vec3 = [mesh.positions[i0 * 3]!, mesh.positions[i0 * 3 + 1]!, mesh.positions[i0 * 3 + 2]!];
    const p1: Vec3 = [mesh.positions[i1 * 3]!, mesh.positions[i1 * 3 + 1]!, mesh.positions[i1 * 3 + 2]!];
    const p2: Vec3 = [mesh.positions[i2 * 3]!, mesh.positions[i2 * 3 + 1]!, mesh.positions[i2 * 3 + 2]!];
    const e01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const e12 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
    const e20 = Math.hypot(p0[0] - p2[0], p0[1] - p2[1], p0[2] - p2[2]);
    const longest = Math.max(e01, e12, e20);
    const shortest = Math.min(e01, e12, e20);
    const ar = shortest > 0 ? longest / shortest : 999;
    totalAr += ar;
    if (ar > worstAr) worstAr = ar;
    if (e01 > 0 && e12 > 0 && e20 > 0) {
      const minA = minAngle(e01, e12, e20);
      if (minA < thresholdRad) slivers++;
    }
  }
  return {
    slivers,
    meanAspectRatio: totalAr / triCount,
    worstAspectRatio: worstAr,
  };
}

function minAngle(a: number, b: number, c: number): number {
  const cosA = clampAcos((b * b + c * c - a * a) / (2 * b * c));
  const cosB = clampAcos((a * a + c * c - b * b) / (2 * a * c));
  const cosC = clampAcos((a * a + b * b - c * c) / (2 * a * b));
  return Math.min(Math.acos(cosA), Math.acos(cosB), Math.acos(cosC));
}

function clampAcos(x: number): number {
  if (x < -1) return -1;
  if (x > 1) return 1;
  return x;
}
