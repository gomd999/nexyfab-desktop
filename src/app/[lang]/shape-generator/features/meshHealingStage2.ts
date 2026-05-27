/**
 * meshHealingStage2.ts — Topological repairs that go beyond welding.
 *
 * Stage 1 (in `meshHealing.ts`) handles geometric duplicates: degenerate
 * triangles, near-coincident vertices, isolated vertices.
 *
 * Stage 2 (here) handles *topology* — the mesh holes, flipped normals,
 * and non-manifold edges that import-from-STL or STEP-tessellation
 * routinely leave behind. These are what blocks downstream booleans
 * + 3D-printing slicing.
 *
 * Operations:
 *   1. `analyzeManifold` — classify every edge as boundary (1 use),
 *      manifold (2 uses), or non-manifold (3+ uses).
 *   2. `detectBoundaryLoops` — walk the boundary edges to find the
 *      closed loops that delimit holes.
 *   3. `fillHole` — fan-triangulate a boundary loop from its centroid.
 *   4. `consistentNormals` — BFS-flood from a seed triangle, flipping
 *      neighbour triangle winding when it disagrees so all triangles
 *      consistently point "outward".
 *
 * Each operation is pure on the input buffer arrays — caller composes
 * them into a pipeline. The functions take `positions` + `indices`
 * arrays directly (not BufferGeometry) so they're equally usable from
 * non-Three.js code paths (workers, SCAD pipeline, lattice export).
 */

export type EdgeKey = string; // "minIdx-maxIdx"

export interface ManifoldReport {
  /** Edges shared by exactly 1 triangle — i.e. mesh boundary. */
  boundaryEdges: Array<[number, number]>;
  /** Edges shared by 3+ triangles. */
  nonManifoldEdges: Array<[number, number]>;
  /** Total edge count. */
  totalEdges: number;
  /** True when every edge is shared by exactly 2 triangles. */
  isManifold: boolean;
}

function edgeKey(a: number, b: number): EdgeKey {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function analyzeManifold(indices: number[]): ManifoldReport {
  const counts = new Map<EdgeKey, number>();
  const seenEdges = new Map<EdgeKey, [number, number]>();
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!, b = indices[i + 1]!, c = indices[i + 2]!;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      const k = edgeKey(u, v);
      counts.set(k, (counts.get(k) ?? 0) + 1);
      if (!seenEdges.has(k)) seenEdges.set(k, [Math.min(u, v), Math.max(u, v)]);
    }
  }
  const boundary: Array<[number, number]> = [];
  const nonManifold: Array<[number, number]> = [];
  for (const [k, n] of counts) {
    const edge = seenEdges.get(k)!;
    if (n === 1) boundary.push(edge);
    else if (n >= 3) nonManifold.push(edge);
  }
  return {
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    totalEdges: counts.size,
    isManifold: boundary.length === 0 && nonManifold.length === 0,
  };
}

/** Walk boundary edges to find ordered closed loops. Each loop is a
 *  list of vertex indices in cyclic order. */
export function detectBoundaryLoops(boundaryEdges: Array<[number, number]>): number[][] {
  // Adjacency: each vertex → list of vertices it shares a boundary edge with.
  const adj = new Map<number, number[]>();
  for (const [a, b] of boundaryEdges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  const loops: number[][] = [];
  const visited = new Set<EdgeKey>();
  for (const [start] of adj) {
    let cur = start;
    let prev = -1;
    const loop: number[] = [];
    while (true) {
      loop.push(cur);
      const neighbours = adj.get(cur) ?? [];
      let next = -1;
      for (const n of neighbours) {
        if (n === prev) continue;
        const k = edgeKey(cur, n);
        if (visited.has(k)) continue;
        next = n;
        visited.add(k);
        break;
      }
      if (next === -1) break;
      if (next === start) break;
      prev = cur;
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Fan-triangulate a boundary loop by inserting a new vertex at the
 *  loop centroid + adding `loop.length` triangles. Returns the new
 *  positions/indices arrays. */
export function fillHole(
  positions: number[],
  indices: number[],
  loop: number[],
): { positions: number[]; indices: number[]; addedTriangles: number } {
  if (loop.length < 3) return { positions, indices, addedTriangles: 0 };

  // Centroid of loop vertices.
  let cx = 0, cy = 0, cz = 0;
  for (const v of loop) {
    cx += positions[v * 3]!;
    cy += positions[v * 3 + 1]!;
    cz += positions[v * 3 + 2]!;
  }
  cx /= loop.length; cy /= loop.length; cz /= loop.length;

  const newPositions = positions.slice();
  const centerIdx = newPositions.length / 3;
  newPositions.push(cx, cy, cz);

  const newIndices = indices.slice();
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    newIndices.push(a, b, centerIdx);
  }
  return {
    positions: newPositions,
    indices: newIndices,
    addedTriangles: loop.length,
  };
}

/** Flip every triangle's winding so the mesh has consistent outward
 *  normals. Uses BFS from a seed triangle, propagating the seed's
 *  winding through shared edges. */
export function consistentNormals(indices: number[]): { indices: number[]; flippedCount: number } {
  const triCount = indices.length / 3;
  if (triCount < 2) return { indices: indices.slice(), flippedCount: 0 };

  // Build edge → list of triangle indices.
  const edgeTris = new Map<EdgeKey, number[]>();
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3]!, b = indices[t * 3 + 1]!, c = indices[t * 3 + 2]!;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      const k = edgeKey(u, v);
      if (!edgeTris.has(k)) edgeTris.set(k, []);
      edgeTris.get(k)!.push(t);
    }
  }

  const newIndices = indices.slice();
  const visited = new Uint8Array(triCount);
  const flipped = new Uint8Array(triCount);
  let flippedCount = 0;
  const queue: number[] = [0];
  visited[0] = 1;

  while (queue.length > 0) {
    const t = queue.shift()!;
    const a = newIndices[t * 3]!, b = newIndices[t * 3 + 1]!, c = newIndices[t * 3 + 2]!;
    const tOrient = [[a, b], [b, c], [c, a]] as Array<[number, number]>;
    for (const [u, v] of tOrient) {
      const k = edgeKey(u, v);
      const neighbours = edgeTris.get(k) ?? [];
      for (const n of neighbours) {
        if (n === t || visited[n]) continue;
        visited[n] = 1;
        // Check neighbour's orientation on this edge — if it traverses
        // the edge the same direction as `t`, normals disagree → flip.
        const na = newIndices[n * 3]!, nb = newIndices[n * 3 + 1]!, nc = newIndices[n * 3 + 2]!;
        const nOrient = [[na, nb], [nb, nc], [nc, na]] as Array<[number, number]>;
        const sameDir = nOrient.some(([nu, nv]) => nu === u && nv === v);
        if (sameDir) {
          newIndices[n * 3]     = na;
          newIndices[n * 3 + 1] = nc;
          newIndices[n * 3 + 2] = nb;
          flipped[n] = 1;
          flippedCount++;
        }
        queue.push(n);
      }
    }
  }
  void flipped;
  return { indices: newIndices, flippedCount };
}

/** Combined pipeline — analyze, fill holes, harmonise normals. Returns
 *  the fully healed mesh + a report describing what was repaired. */
export interface Stage2HealReport {
  filledHoles: number;
  addedTriangles: number;
  flippedTriangles: number;
  initialBoundaryEdges: number;
  finalBoundaryEdges: number;
  nonManifoldEdges: number;
}

export function healMeshStage2(
  positions: number[],
  indices: number[],
): { positions: number[]; indices: number[]; report: Stage2HealReport } {
  const initial = analyzeManifold(indices);
  const loops = detectBoundaryLoops(initial.boundaryEdges);

  let workingPos = positions;
  let workingIdx = indices;
  let addedTris = 0;
  let filled = 0;
  for (const loop of loops) {
    const r = fillHole(workingPos, workingIdx, loop);
    workingPos = r.positions;
    workingIdx = r.indices;
    addedTris += r.addedTriangles;
    if (r.addedTriangles > 0) filled++;
  }

  const oriented = consistentNormals(workingIdx);
  workingIdx = oriented.indices;
  const final = analyzeManifold(workingIdx);
  return {
    positions: workingPos,
    indices: workingIdx,
    report: {
      filledHoles: filled,
      addedTriangles: addedTris,
      flippedTriangles: oriented.flippedCount,
      initialBoundaryEdges: initial.boundaryEdges.length,
      finalBoundaryEdges: final.boundaryEdges.length,
      nonManifoldEdges: final.nonManifoldEdges.length,
    },
  };
}
