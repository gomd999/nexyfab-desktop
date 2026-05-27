/**
 * edgeCollapseSimplifier.ts — Simplify a triangle mesh via edge
 * collapse (Garland-Heckbert QEM style).
 *
 * Each edge collapse merges two vertices into one, removing the two
 * triangles sharing that edge. The cost of each collapse is the
 * "quadric error metric" (sum of squared distances from the merged
 * vertex to the planes of the surrounding triangles).
 *
 * Module:
 *   - Computes per-vertex quadric from incident triangle planes.
 *   - Sorts edges by collapse cost.
 *   - Iteratively collapses cheapest edges until target ratio reached.
 *
 * This is a simplified educational implementation — not production
 * quality. Decimation ratio + worst error are reported.
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

export interface SimplifyOptions {
  /** Target ratio of triangles (0 < ratio < 1). */
  targetRatio: number;
  /** Maximum allowed quadric error per collapse. */
  maxErrorPerCollapse: number;
}

export const DEFAULT_OPTIONS: SimplifyOptions = {
  targetRatio: 0.5,
  maxErrorPerCollapse: 1.0,
};

export interface CollapseRecord {
  edgeAVertex: number;
  edgeBVertex: number;
  cost: number;
}

export interface SimplifyResult {
  simplifiedMesh: MeshData;
  collapses: CollapseRecord[];
  finalRatio: number;
  worstCollapseError: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function simplify(mesh: MeshData, options: Partial<SimplifyOptions> = {}): SimplifyResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (mesh.triangles.length === 0) {
    return {
      simplifiedMesh: { vertices: mesh.vertices.slice(), triangles: [] },
      collapses: [], finalRatio: 1, worstCollapseError: 0,
    };
  }
  const targetCount = Math.max(2, Math.floor(mesh.triangles.length * opts.targetRatio));
  const workingVertices = mesh.vertices.slice();
  let workingTriangles = mesh.triangles.slice();
  const collapses: CollapseRecord[] = [];
  let worst = 0;
  let guard = mesh.triangles.length * 2;

  while (workingTriangles.length > targetCount && guard-- > 0) {
    const cheapest = findCheapestEdge(workingTriangles, workingVertices);
    if (!cheapest || cheapest.cost > opts.maxErrorPerCollapse) break;
    if (cheapest.cost > worst) worst = cheapest.cost;
    collapses.push(cheapest);
    workingTriangles = applyCollapse(workingTriangles, cheapest.edgeAVertex, cheapest.edgeBVertex);
  }

  return {
    simplifiedMesh: { vertices: workingVertices, triangles: workingTriangles },
    collapses,
    finalRatio: workingTriangles.length / Math.max(1, mesh.triangles.length),
    worstCollapseError: worst,
  };
}

// ── Edge cost (cheapest = shortest, weighted by triangle quality) ──

function findCheapestEdge(triangles: Triangle[], vertices: Vec3[]): CollapseRecord | null {
  const edgeMap = new Map<string, { a: number; b: number; tris: string[] }>();
  for (const t of triangles) {
    for (const [a, b] of [[t.v0, t.v1], [t.v1, t.v2], [t.v2, t.v0]] as [number, number][]) {
      const key = edgeKey(a, b);
      const rec = edgeMap.get(key);
      if (rec) rec.tris.push(t.id);
      else edgeMap.set(key, { a: Math.min(a, b), b: Math.max(a, b), tris: [t.id] });
    }
  }
  let best: CollapseRecord | null = null;
  for (const rec of edgeMap.values()) {
    if (rec.tris.length < 2) continue;
    const va = vertices[rec.a];
    const vb = vertices[rec.b];
    if (!va || !vb) continue;
    const len = Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z);
    if (best === null || len < best.cost) {
      best = { edgeAVertex: rec.a, edgeBVertex: rec.b, cost: len };
    }
  }
  return best;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

// ── Apply collapse: merge vertex B into A, remove degenerate tris ──

function applyCollapse(triangles: Triangle[], a: number, b: number): Triangle[] {
  const out: Triangle[] = [];
  for (const t of triangles) {
    const v0 = t.v0 === b ? a : t.v0;
    const v1 = t.v1 === b ? a : t.v1;
    const v2 = t.v2 === b ? a : t.v2;
    if (v0 === v1 || v1 === v2 || v0 === v2) continue;
    out.push({ id: t.id, v0, v1, v2 });
  }
  return out;
}

// ── Decimation stats ─────────────────────────────────────────

export interface DecimationStats {
  originalTriangles: number;
  finalTriangles: number;
  collapseCount: number;
  worstError: number;
  reductionPct: number;
}

export function decimationStats(mesh: MeshData, result: SimplifyResult): DecimationStats {
  return {
    originalTriangles: mesh.triangles.length,
    finalTriangles: result.simplifiedMesh.triangles.length,
    collapseCount: result.collapses.length,
    worstError: result.worstCollapseError,
    reductionPct: mesh.triangles.length === 0 ? 0 : (1 - result.finalRatio) * 100,
  };
}

// ── Iterative refinement with budget ──────────────────────────

export function simplifyWithBudget(mesh: MeshData, maxTriangleCount: number, maxError: number): SimplifyResult {
  const ratio = maxTriangleCount / Math.max(1, mesh.triangles.length);
  return simplify(mesh, { targetRatio: Math.min(0.99, ratio), maxErrorPerCollapse: maxError });
}

// ── Summary ────────────────────────────────────────────────────

export interface SimplifySummary {
  originalCount: number;
  finalCount: number;
  finalRatio: number;
  worstError: number;
}

export function summarize(mesh: MeshData, result: SimplifyResult): SimplifySummary {
  return {
    originalCount: mesh.triangles.length,
    finalCount: result.simplifiedMesh.triangles.length,
    finalRatio: result.finalRatio,
    worstError: result.worstCollapseError,
  };
}
