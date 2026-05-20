/**
 * planarSurfaceExtractor.ts — Group coplanar triangles into planar
 * surface patches.
 *
 * Detecting flat faces in a mesh is useful for:
 *
 *   - Reverse engineering (recreate planes for sketches).
 *   - DFM hole-pattern + flat-surface detection.
 *   - Boolean prep (planar faces are well-behaved).
 *
 * Algorithm:
 *
 *   1. Compute per-triangle normal.
 *   2. Build edge adjacency (shared-edge neighbours).
 *   3. Region-grow: seed = unvisited triangle; expand to neighbours
 *     whose normal differs by < angleToleranceDeg AND whose plane
 *     offset from the seed plane is < offsetToleranceMm.
 *   4. Return the patches with their fitted plane.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface Triangle {
  id: string;
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
}

export interface ExtractOptions {
  angleToleranceDeg: number;
  offsetToleranceMm: number;
  minTriangleCount: number;
}

export const DEFAULT_OPTIONS: ExtractOptions = {
  angleToleranceDeg: 3,
  offsetToleranceMm: 0.05,
  minTriangleCount: 2,
};

export interface PlanarPatch {
  id: number;
  triangleIds: string[];
  /** Average normal. */
  normal: Vec3;
  /** Plane offset d in equation n·x + d = 0. */
  d: number;
  /** Plane area (mm²). */
  areaMm2: number;
}

export interface ExtractionResult {
  patches: PlanarPatch[];
  unassignedTriangles: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function extractPlanarSurfaces(triangles: Triangle[], options: Partial<ExtractOptions> = {}): ExtractionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const cosTol = Math.cos((opts.angleToleranceDeg * Math.PI) / 180);
  const normals = triangles.map(t => normalize(triangleNormal(t)));
  const adjacency = buildAdjacency(triangles);
  const visited = new Set<string>();
  const patches: PlanarPatch[] = [];
  let nextId = 0;

  for (let i = 0; i < triangles.length; i++) {
    const seed = triangles[i]!;
    if (visited.has(seed.id)) continue;
    visited.add(seed.id);
    const seedNormal = normals[i]!;
    const seedD = -(seedNormal.x * seed.v0.x + seedNormal.y * seed.v0.y + seedNormal.z * seed.v0.z);
    const cluster: string[] = [seed.id];
    const queue: string[] = [seed.id];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const neighbours = adjacency.get(currentId) ?? new Set<string>();
      for (const nId of neighbours) {
        if (visited.has(nId)) continue;
        const nIdx = triangles.findIndex(t => t.id === nId);
        if (nIdx < 0) continue;
        const nNormal = normals[nIdx]!;
        const nTri = triangles[nIdx]!;
        const cosAngle = nNormal.x * seedNormal.x + nNormal.y * seedNormal.y + nNormal.z * seedNormal.z;
        if (cosAngle < cosTol) continue;
        // Distance of one neighbour vertex to seed plane.
        const dist = Math.abs(seedNormal.x * nTri.v0.x + seedNormal.y * nTri.v0.y + seedNormal.z * nTri.v0.z + seedD);
        if (dist > opts.offsetToleranceMm) continue;
        visited.add(nId);
        cluster.push(nId);
        queue.push(nId);
      }
    }

    if (cluster.length >= opts.minTriangleCount) {
      const area = cluster.reduce((acc, id) => {
        const t = triangles.find(x => x.id === id)!;
        return acc + triangleArea(t);
      }, 0);
      patches.push({
        id: nextId++,
        triangleIds: cluster,
        normal: seedNormal,
        d: seedD,
        areaMm2: area,
      });
    }
  }

  const assigned = patches.reduce((s, p) => s + p.triangleIds.length, 0);
  return {
    patches,
    unassignedTriangles: triangles.length - assigned,
  };
}

// ── Geometry helpers ──────────────────────────────────────────

function triangleNormal(t: Triangle): Vec3 {
  return cross(sub(t.v1, t.v0), sub(t.v2, t.v0));
}

function triangleArea(t: Triangle): number {
  return norm(cross(sub(t.v1, t.v0), sub(t.v2, t.v0))) / 2;
}

function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function norm(v: Vec3): number { return Math.hypot(v.x, v.y, v.z); }
function normalize(v: Vec3): Vec3 {
  const n = norm(v);
  if (n === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

// ── Adjacency builder ────────────────────────────────────────

function buildAdjacency(triangles: Triangle[]): Map<string, Set<string>> {
  const edgeMap = new Map<string, string[]>();
  for (const t of triangles) {
    for (const [a, b] of [[t.v0, t.v1], [t.v1, t.v2], [t.v2, t.v0]] as [Vec3, Vec3][]) {
      const key = edgeKey(a, b);
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key)!.push(t.id);
    }
  }
  const adj = new Map<string, Set<string>>();
  for (const tris of edgeMap.values()) {
    for (const a of tris) {
      for (const b of tris) {
        if (a === b) continue;
        if (!adj.has(a)) adj.set(a, new Set());
        adj.get(a)!.add(b);
      }
    }
  }
  return adj;
}

function edgeKey(a: Vec3, b: Vec3): string {
  const aKey = `${a.x.toFixed(4)}_${a.y.toFixed(4)}_${a.z.toFixed(4)}`;
  const bKey = `${b.x.toFixed(4)}_${b.y.toFixed(4)}_${b.z.toFixed(4)}`;
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

// ── Patch classification ─────────────────────────────────────

export type PatchKind = 'horizontal' | 'vertical' | 'oblique';

export function classifyPatch(patch: PlanarPatch): PatchKind {
  const zComp = Math.abs(patch.normal.z);
  if (zComp > 0.95) return 'horizontal';
  if (zComp < 0.05) return 'vertical';
  return 'oblique';
}

// ── Summary ────────────────────────────────────────────────────

export interface ExtractionSummary {
  patchCount: number;
  largestPatchAreaMm2: number;
  unassignedTriangles: number;
  horizontalCount: number;
}

export function summarize(result: ExtractionResult): ExtractionSummary {
  let largest = 0;
  let horizontal = 0;
  for (const p of result.patches) {
    if (p.areaMm2 > largest) largest = p.areaMm2;
    if (classifyPatch(p) === 'horizontal') horizontal++;
  }
  return {
    patchCount: result.patches.length,
    largestPatchAreaMm2: largest,
    unassignedTriangles: result.unassignedTriangles,
    horizontalCount: horizontal,
  };
}
