/**
 * wallThicknessAnalyzer.ts — Measure local wall thickness across a
 * triangulated part.
 *
 * Wall thickness is critical for DFM (especially molding, casting,
 * 3D printing). Thin walls warp / underfill; thick walls cause
 * sink marks / shrinkage; uneven walls cause stress concentration.
 *
 * Algorithm:
 *
 *   1. For each surface vertex, cast a ray inward along the
 *      negated vertex normal.
 *   2. Find the first triangle the ray hits (excluding the source).
 *   3. The hit distance = local thickness.
 *
 * Output: per-vertex thickness + min/max + locations exceeding
 * thresholds (too thin / too thick zones).
 */

export interface Vec3 { x: number; y: number; z: number }

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface ThicknessResult {
  /** Per-vertex thickness (mm). NaN if ray missed. */
  perVertexThickness: number[];
  /** Per-vertex normal used (caller can re-use for display). */
  perVertexNormal: Vec3[];
  /** Vertices with thickness below thin threshold. */
  thinVertexIds: number[];
  /** Vertices with thickness above thick threshold. */
  thickVertexIds: number[];
  /** Overall min/max/avg, ignoring NaN. */
  minMm: number;
  maxMm: number;
  averageMm: number;
}

export interface AnalyzerOptions {
  /** Vertices below this thickness flagged thin. */
  thinThresholdMm: number;
  /** Vertices above this thickness flagged thick. */
  thickThresholdMm: number;
  /** Max ray distance to test (mm). Beyond → NaN (miss). */
  maxRayDistanceMm: number;
}

export const DEFAULT_OPTIONS: AnalyzerOptions = {
  thinThresholdMm: 1.0,
  thickThresholdMm: 10.0,
  maxRayDistanceMm: 100.0,
};

// ── Top-level entry ────────────────────────────────────────────

export function analyzeWallThickness(mesh: MeshArrays, options: Partial<AnalyzerOptions> = {}): ThicknessResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const vertexCount = mesh.positions.length / 3;
  if (vertexCount === 0) {
    return { perVertexThickness: [], perVertexNormal: [], thinVertexIds: [], thickVertexIds: [], minMm: 0, maxMm: 0, averageMm: 0 };
  }
  const normals = computeVertexNormals(mesh);
  const triangles = parseTriangles(mesh);
  const thicknesses: number[] = [];
  const thin: number[] = [];
  const thick: number[] = [];

  for (let v = 0; v < vertexCount; v++) {
    const origin = vertexAt(mesh, v);
    const n = normals[v]!;
    // Cast ray along -normal (into the body).
    const dir: Vec3 = { x: -n.x, y: -n.y, z: -n.z };
    const hit = rayCast(origin, dir, triangles, opts.maxRayDistanceMm, v);
    thicknesses.push(hit);
    if (Number.isFinite(hit)) {
      if (hit < opts.thinThresholdMm) thin.push(v);
      if (hit > opts.thickThresholdMm) thick.push(v);
    }
  }

  const valid = thicknesses.filter(t => Number.isFinite(t));
  const min = valid.length > 0 ? Math.min(...valid) : 0;
  const max = valid.length > 0 ? Math.max(...valid) : 0;
  const avg = valid.length > 0 ? valid.reduce((s, t) => s + t, 0) / valid.length : 0;

  return {
    perVertexThickness: thicknesses,
    perVertexNormal: normals,
    thinVertexIds: thin,
    thickVertexIds: thick,
    minMm: min,
    maxMm: max,
    averageMm: avg,
  };
}

// ── Ray-cast ──────────────────────────────────────────────────

interface Triangle {
  index: number;
  a: Vec3;
  b: Vec3;
  c: Vec3;
  vertexIndices: [number, number, number];
}

function parseTriangles(mesh: MeshArrays): Triangle[] {
  const out: Triangle[] = [];
  const tri = mesh.indices.length / 3;
  for (let t = 0; t < tri; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    out.push({
      index: t,
      a: vertexAt(mesh, i0),
      b: vertexAt(mesh, i1),
      c: vertexAt(mesh, i2),
      vertexIndices: [i0, i1, i2],
    });
  }
  return out;
}

function rayCast(origin: Vec3, dir: Vec3, triangles: Triangle[], maxDist: number, sourceVertex: number): number {
  let best = Infinity;
  for (const tri of triangles) {
    // Skip the triangle containing the source vertex (avoid self-intersection).
    if (tri.vertexIndices.includes(sourceVertex)) continue;
    const hit = mollerTrumboreIntersect(origin, dir, tri);
    if (hit !== null && hit > 1e-4 && hit < best) {
      best = hit;
    }
  }
  return best > maxDist ? NaN : best;
}

function mollerTrumboreIntersect(origin: Vec3, dir: Vec3, tri: Triangle): number | null {
  const epsilon = 1e-9;
  const edge1: Vec3 = { x: tri.b.x - tri.a.x, y: tri.b.y - tri.a.y, z: tri.b.z - tri.a.z };
  const edge2: Vec3 = { x: tri.c.x - tri.a.x, y: tri.c.y - tri.a.y, z: tri.c.z - tri.a.z };
  const h: Vec3 = {
    x: dir.y * edge2.z - dir.z * edge2.y,
    y: dir.z * edge2.x - dir.x * edge2.z,
    z: dir.x * edge2.y - dir.y * edge2.x,
  };
  const a = edge1.x * h.x + edge1.y * h.y + edge1.z * h.z;
  if (Math.abs(a) < epsilon) return null;
  const f = 1 / a;
  const s: Vec3 = { x: origin.x - tri.a.x, y: origin.y - tri.a.y, z: origin.z - tri.a.z };
  const u = f * (s.x * h.x + s.y * h.y + s.z * h.z);
  if (u < 0 || u > 1) return null;
  const q: Vec3 = {
    x: s.y * edge1.z - s.z * edge1.y,
    y: s.z * edge1.x - s.x * edge1.z,
    z: s.x * edge1.y - s.y * edge1.x,
  };
  const v = f * (dir.x * q.x + dir.y * q.y + dir.z * q.z);
  if (v < 0 || u + v > 1) return null;
  const t = f * (edge2.x * q.x + edge2.y * q.y + edge2.z * q.z);
  return t > epsilon ? t : null;
}

// ── Normals ───────────────────────────────────────────────────

function computeVertexNormals(mesh: MeshArrays): Vec3[] {
  const vertexCount = mesh.positions.length / 3;
  const normals: Vec3[] = Array.from({ length: vertexCount }, () => ({ x: 0, y: 0, z: 0 }));
  const triCount = mesh.indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    const p0 = vertexAt(mesh, i0);
    const p1 = vertexAt(mesh, i1);
    const p2 = vertexAt(mesh, i2);
    const n = triangleNormal(p0, p1, p2);
    normals[i0]!.x += n.x; normals[i0]!.y += n.y; normals[i0]!.z += n.z;
    normals[i1]!.x += n.x; normals[i1]!.y += n.y; normals[i1]!.z += n.z;
    normals[i2]!.x += n.x; normals[i2]!.y += n.y; normals[i2]!.z += n.z;
  }
  // Normalize.
  for (const n of normals) {
    const len = Math.hypot(n.x, n.y, n.z);
    if (len > 1e-9) { n.x /= len; n.y /= len; n.z /= len; }
    else { n.x = 0; n.y = 0; n.z = 1; }
  }
  return normals;
}

function triangleNormal(p0: Vec3, p1: Vec3, p2: Vec3): Vec3 {
  const ux = p1.x - p0.x, uy = p1.y - p0.y, uz = p1.z - p0.z;
  const vx = p2.x - p0.x, vy = p2.y - p0.y, vz = p2.z - p0.z;
  return { x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx };
}

function vertexAt(mesh: MeshArrays, i: number): Vec3 {
  return { x: mesh.positions[i * 3]!, y: mesh.positions[i * 3 + 1]!, z: mesh.positions[i * 3 + 2]! };
}

// ── Summary ────────────────────────────────────────────────────

export interface ThicknessSummary {
  totalVertices: number;
  validVertices: number;
  thinFraction: number;
  thickFraction: number;
  averageThicknessMm: number;
  variationMm: number;
}

export function summarize(result: ThicknessResult): ThicknessSummary {
  const total = result.perVertexThickness.length;
  const valid = result.perVertexThickness.filter(t => Number.isFinite(t)).length;
  return {
    totalVertices: total,
    validVertices: valid,
    thinFraction: total > 0 ? result.thinVertexIds.length / total : 0,
    thickFraction: total > 0 ? result.thickVertexIds.length / total : 0,
    averageThicknessMm: result.averageMm,
    variationMm: result.maxMm - result.minMm,
  };
}
