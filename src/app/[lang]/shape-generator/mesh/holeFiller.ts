/**
 * holeFiller.ts — Fill holes (boundary loops) in a triangle mesh.
 *
 * Many imported / scanned meshes have boundary loops that need
 * filling to make the mesh watertight (for STL printing, FEA).
 *
 * Strategies:
 *
 *   - Centroid fan: pick the centroid of the loop and fan triangles
 *     from it. Cheap; works for convex loops.
 *   - Ear-clipping triangulation: O(n²) classical polygon
 *     triangulation. Works for simple non-convex loops.
 *
 * Module:
 *
 *   1. Detect boundary loops (edges with only one incident triangle).
 *   2. For each loop, choose strategy by convexity heuristic.
 *   3. Insert new triangles into the mesh.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface Triangle {
  id: string;
  v0: number;
  v1: number;
  v2: number;
}

export interface MeshData {
  vertices: Vec3[];
  triangles: Triangle[];
}

export type FillStrategy = 'centroid-fan' | 'ear-clipping' | 'auto';

export interface FillOptions {
  strategy: FillStrategy;
  /** Whether to also add a centroid vertex for the fan strategy. */
  addCentroidVertex: boolean;
}

export const DEFAULT_OPTIONS: FillOptions = {
  strategy: 'auto',
  addCentroidVertex: true,
};

export interface FilledHole {
  loopVertices: number[];
  newTriangleIds: string[];
  strategy: FillStrategy;
}

export interface FillResult {
  filledMesh: MeshData;
  filledHoles: FilledHole[];
  totalFillTriangleCount: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function fillHoles(mesh: MeshData, options: Partial<FillOptions> = {}): FillResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const loops = detectBoundaryLoops(mesh);
  if (loops.length === 0) {
    return { filledMesh: { vertices: mesh.vertices.slice(), triangles: mesh.triangles.slice() }, filledHoles: [], totalFillTriangleCount: 0 };
  }

  const newVertices = mesh.vertices.slice();
  const newTriangles = mesh.triangles.slice();
  const filled: FilledHole[] = [];
  let triCounter = mesh.triangles.length;

  for (const loop of loops) {
    const strategy = pickStrategy(loop, newVertices, opts.strategy);
    const initialTriCount = newTriangles.length;
    if (strategy === 'centroid-fan') {
      let centroidIdx: number;
      if (opts.addCentroidVertex) {
        const centroid = computeCentroid(loop, newVertices);
        centroidIdx = newVertices.length;
        newVertices.push(centroid);
      } else {
        centroidIdx = loop[0]!;
      }
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        newTriangles.push({
          id: `fill-fan-${triCounter++}`,
          v0: centroidIdx,
          v1: a,
          v2: b,
        });
      }
    } else {
      // Ear-clipping.
      const ears = earClip(loop, newVertices);
      for (const tri of ears) {
        newTriangles.push({
          id: `fill-ear-${triCounter++}`,
          v0: tri[0]!,
          v1: tri[1]!,
          v2: tri[2]!,
        });
      }
    }
    filled.push({
      loopVertices: loop,
      newTriangleIds: newTriangles.slice(initialTriCount).map(t => t.id),
      strategy,
    });
  }

  return {
    filledMesh: { vertices: newVertices, triangles: newTriangles },
    filledHoles: filled,
    totalFillTriangleCount: newTriangles.length - mesh.triangles.length,
  };
}

// ── Boundary loop detection ───────────────────────────────────

function detectBoundaryLoops(mesh: MeshData): number[][] {
  const edgeMap = new Map<string, { a: number; b: number; count: number }>();
  for (const t of mesh.triangles) {
    for (const [a, b] of [[t.v0, t.v1], [t.v1, t.v2], [t.v2, t.v0]] as [number, number][]) {
      const key = edgeKey(a, b);
      const rec = edgeMap.get(key);
      if (rec) rec.count++;
      else edgeMap.set(key, { a: Math.min(a, b), b: Math.max(a, b), count: 1 });
    }
  }
  const boundary: { a: number; b: number }[] = [];
  for (const rec of edgeMap.values()) {
    if (rec.count === 1) boundary.push({ a: rec.a, b: rec.b });
  }
  if (boundary.length === 0) return [];
  // Connect boundary edges into loops.
  const adjacency = new Map<number, number[]>();
  for (const e of boundary) {
    if (!adjacency.has(e.a)) adjacency.set(e.a, []);
    if (!adjacency.has(e.b)) adjacency.set(e.b, []);
    adjacency.get(e.a)!.push(e.b);
    adjacency.get(e.b)!.push(e.a);
  }
  const visited = new Set<number>();
  const loops: number[][] = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const loop: number[] = [start];
    visited.add(start);
    let cur = start;
    while (true) {
      const next = (adjacency.get(cur) ?? []).find(n => !visited.has(n));
      if (next === undefined) break;
      visited.add(next);
      loop.push(next);
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

// ── Strategy picker ──────────────────────────────────────────

function pickStrategy(loop: number[], vertices: Vec3[], requested: FillStrategy): FillStrategy {
  if (requested !== 'auto') return requested;
  if (loop.length <= 4) return 'centroid-fan';
  return isConvexPlanar(loop, vertices) ? 'centroid-fan' : 'ear-clipping';
}

function isConvexPlanar(loop: number[], vertices: Vec3[]): boolean {
  // Cross products of successive edges should have consistent signs.
  if (loop.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = vertices[loop[i]!]!;
    const b = vertices[loop[(i + 1) % loop.length]!]!;
    const c = vertices[loop[(i + 2) % loop.length]!]!;
    const cx = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cx) < 1e-9) continue;
    const s = cx > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return true;
}

function computeCentroid(loop: number[], vertices: Vec3[]): Vec3 {
  let cx = 0, cy = 0, cz = 0;
  for (const idx of loop) {
    const v = vertices[idx]!;
    cx += v.x;
    cy += v.y;
    cz += v.z;
  }
  const n = loop.length;
  return { x: cx / n, y: cy / n, z: cz / n };
}

// ── Ear clipping (planar XY projection) ──────────────────────

function earClip(loop: number[], vertices: Vec3[]): number[][] {
  const indices = loop.slice();
  const triangles: number[][] = [];
  let guard = indices.length * indices.length;
  while (indices.length > 3 && guard-- > 0) {
    let found = false;
    for (let i = 0; i < indices.length; i++) {
      const prev = indices[(i - 1 + indices.length) % indices.length]!;
      const cur = indices[i]!;
      const next = indices[(i + 1) % indices.length]!;
      if (isEar(prev, cur, next, indices, vertices)) {
        triangles.push([prev, cur, next]);
        indices.splice(i, 1);
        found = true;
        break;
      }
    }
    if (!found) break;
  }
  if (indices.length === 3) triangles.push([indices[0]!, indices[1]!, indices[2]!]);
  return triangles;
}

function isEar(prev: number, cur: number, next: number, indices: number[], vertices: Vec3[]): boolean {
  const a = vertices[prev]!;
  const b = vertices[cur]!;
  const c = vertices[next]!;
  // Use XY plane check.
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (cross <= 0) return false;
  // No other vertex inside this triangle.
  for (const idx of indices) {
    if (idx === prev || idx === cur || idx === next) continue;
    const p = vertices[idx]!;
    if (pointInTriangle(p, a, b, c)) return false;
  }
  return true;
}

function pointInTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): boolean {
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function sign(p: Vec3, a: Vec3, b: Vec3): number {
  return (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
}

// ── Summary ────────────────────────────────────────────────────

export interface FillSummary {
  holesFilled: number;
  trianglesAdded: number;
  byStrategy: Record<FillStrategy, number>;
}

export function summarize(result: FillResult): FillSummary {
  const byStrategy: Record<FillStrategy, number> = { 'centroid-fan': 0, 'ear-clipping': 0, auto: 0 };
  for (const f of result.filledHoles) byStrategy[f.strategy]++;
  return {
    holesFilled: result.filledHoles.length,
    trianglesAdded: result.totalFillTriangleCount,
    byStrategy,
  };
}
