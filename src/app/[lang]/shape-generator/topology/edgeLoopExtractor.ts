/**
 * edgeLoopExtractor.ts — Extract closed edge loops from a triangle mesh
 * by feature angle.
 *
 * An *edge loop* is a closed chain of mesh edges that lies along a
 * crease — i.e., where the dihedral angle between adjacent faces is
 * greater than a threshold. Loops define the visual structure of a
 * part (the outline of a hole, the perimeter of a pad, the silhouette
 * of a step) and are the natural selection unit for fillet/chamfer
 * operators in CAD UIs.
 *
 * Algorithm:
 *
 *   1. Compute per-triangle face normals.
 *   2. For each manifold edge (shared by exactly 2 triangles), compute
 *      the dihedral angle. If it exceeds the threshold, mark the edge
 *      as a "feature edge".
 *   3. Chain feature edges into closed loops by following shared
 *      vertices in a greedy manner.
 *
 * Output: ordered loops + per-loop stats + count of boundary edges
 * (edges with only 1 incident triangle — the mesh boundary).
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface FeatureEdge {
  /** Vertex indices of the two endpoints. */
  vA: number;
  vB: number;
  /** The two incident triangles. */
  triA: number;
  triB: number;
  /** Dihedral angle in degrees (0 = coplanar, 180 = folded back). */
  dihedralDeg: number;
}

export interface EdgeLoop {
  /** Ordered vertex indices forming the loop. */
  vertices: number[];
  /** True if last vertex connects back to first. */
  closed: boolean;
  /** Total 3D length of the loop. */
  totalLengthMm: number;
}

export interface ExtractResult {
  featureEdges: FeatureEdge[];
  loops: EdgeLoop[];
  /** Mesh-boundary edges (1 triangle only). */
  boundaryEdges: Array<{ vA: number; vB: number; triId: number }>;
}

export interface ExtractOptions {
  /** Minimum dihedral to be a feature edge (degrees). */
  thresholdDeg: number;
}

export const DEFAULT_OPTIONS: ExtractOptions = {
  thresholdDeg: 30,
};

// ── Top-level entry ────────────────────────────────────────────

export function extractEdgeLoops(mesh: MeshArrays, options: Partial<ExtractOptions> = {}): ExtractResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const triCount = mesh.indices.length / 3;
  if (triCount === 0) {
    return { featureEdges: [], loops: [], boundaryEdges: [] };
  }
  const normals: Array<[number, number, number]> = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    normals.push(triangleNormal(vertex(mesh, i0), vertex(mesh, i1), vertex(mesh, i2)));
  }

  // Build edge → triangle list.
  const edgeMap = new Map<string, { vA: number; vB: number; tris: number[] }>();
  for (let t = 0; t < triCount; t++) {
    const idx = [mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!];
    for (let e = 0; e < 3; e++) {
      const a = idx[e]!;
      const b = idx[(e + 1) % 3]!;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo}-${hi}`;
      const slot = edgeMap.get(key);
      if (slot) {
        slot.tris.push(t);
      } else {
        edgeMap.set(key, { vA: lo, vB: hi, tris: [t] });
      }
    }
  }

  const featureEdges: FeatureEdge[] = [];
  const boundary: Array<{ vA: number; vB: number; triId: number }> = [];
  for (const e of edgeMap.values()) {
    if (e.tris.length === 1) {
      boundary.push({ vA: e.vA, vB: e.vB, triId: e.tris[0]! });
      continue;
    }
    if (e.tris.length !== 2) continue;
    const t0 = e.tris[0]!;
    const t1 = e.tris[1]!;
    const n0 = normals[t0]!;
    const n1 = normals[t1]!;
    const cos = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2];
    const angle = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    if (angle >= opts.thresholdDeg) {
      featureEdges.push({ vA: e.vA, vB: e.vB, triA: t0, triB: t1, dihedralDeg: angle });
    }
  }

  const loops = chainEdgesIntoLoops(featureEdges, mesh);
  return { featureEdges, loops, boundaryEdges: boundary };
}

// ── Loop chaining ──────────────────────────────────────────────

function chainEdgesIntoLoops(edges: FeatureEdge[], mesh: MeshArrays): EdgeLoop[] {
  // Build adjacency: vertex → connected edges.
  const adj = new Map<number, number[]>();
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    (adj.get(e.vA) ?? adj.set(e.vA, []).get(e.vA)!).push(i);
    (adj.get(e.vB) ?? adj.set(e.vB, []).get(e.vB)!).push(i);
  }

  const used = new Set<number>();
  const loops: EdgeLoop[] = [];

  for (let i = 0; i < edges.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const start = edges[i]!;
    const vertices: number[] = [start.vA, start.vB];

    let extended = true;
    while (extended) {
      extended = false;
      const tail = vertices[vertices.length - 1]!;
      const cands = adj.get(tail) ?? [];
      for (const ci of cands) {
        if (used.has(ci)) continue;
        const ce = edges[ci]!;
        const next = ce.vA === tail ? ce.vB : ce.vA;
        vertices.push(next);
        used.add(ci);
        extended = true;
        break;
      }
    }

    let extendedBack = true;
    while (extendedBack) {
      extendedBack = false;
      const head = vertices[0]!;
      const cands = adj.get(head) ?? [];
      for (const ci of cands) {
        if (used.has(ci)) continue;
        const ce = edges[ci]!;
        const prev = ce.vA === head ? ce.vB : ce.vA;
        vertices.unshift(prev);
        used.add(ci);
        extendedBack = true;
        break;
      }
    }

    const closed = vertices.length > 2 && vertices[0]! === vertices[vertices.length - 1]!;
    let length = 0;
    for (let j = 1; j < vertices.length; j++) {
      const a = vertex(mesh, vertices[j - 1]!);
      const b = vertex(mesh, vertices[j]!);
      length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    loops.push({ vertices, closed, totalLengthMm: length });
  }
  return loops;
}

// ── Helpers ────────────────────────────────────────────────────

function vertex(mesh: MeshArrays, i: number): [number, number, number] {
  return [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
}

export function triangleNormal(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
): [number, number, number] {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  const len = Math.hypot(cx, cy, cz);
  if (len < 1e-9) return [0, 0, 1];
  return [cx / len, cy / len, cz / len];
}

// ── Summary ────────────────────────────────────────────────────

export interface ExtractSummary {
  featureEdgeCount: number;
  loopCount: number;
  closedLoopCount: number;
  longestLoopMm: number;
  totalFeatureLengthMm: number;
  boundaryEdgeCount: number;
  averageDihedralDeg: number;
}

export function summarize(result: ExtractResult): ExtractSummary {
  let closed = 0;
  let longest = 0;
  let total = 0;
  for (const loop of result.loops) {
    if (loop.closed) closed++;
    if (loop.totalLengthMm > longest) longest = loop.totalLengthMm;
    total += loop.totalLengthMm;
  }
  const avgDihedral = result.featureEdges.length === 0
    ? 0
    : result.featureEdges.reduce((s, e) => s + e.dihedralDeg, 0) / result.featureEdges.length;
  return {
    featureEdgeCount: result.featureEdges.length,
    loopCount: result.loops.length,
    closedLoopCount: closed,
    longestLoopMm: longest,
    totalFeatureLengthMm: total,
    boundaryEdgeCount: result.boundaryEdges.length,
    averageDihedralDeg: avgDihedral,
  };
}
