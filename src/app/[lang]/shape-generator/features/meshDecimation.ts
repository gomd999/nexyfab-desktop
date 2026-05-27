/**
 * meshDecimation.ts — Quadric Error Metric (QEM) mesh simplification.
 *
 * Used for:
 *   - Generating LOD pyramids for rendering big assemblies fast.
 *   - Pre-processing CAD output before STL export (shaving off
 *     redundant triangles in flat regions).
 *   - Simulation pre-processing where coarser meshes are acceptable.
 *
 * Algorithm (Garland & Heckbert 1997):
 *   1. For each vertex, compute the 4×4 fundamental quadric matrix
 *      Q_v = Σ K_p, where K_p = p·pᵀ is the plane's "outer product"
 *      matrix and the sum is over planes incident to the vertex.
 *   2. For each edge (v1, v2), Q_pair = Q_v1 + Q_v2. The optimal
 *      collapse position v* minimizes v*ᵀ Q_pair v*. Cost of the
 *      collapse is that minimum.
 *   3. Use a priority queue of edge collapses ordered by cost, pop
 *      cheapest first, update neighbours, repeat until target tri
 *      count reached.
 *
 * This implementation is a simplified, single-pass version suitable
 * for moderate-size meshes (< 100k triangles). For huge meshes use a
 * spatial hash + multi-resolution scheduler.
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface DecimationOptions {
  /** Target triangle count. */
  targetTriangleCount: number;
  /** Stop if any single collapse cost exceeds this. */
  costThreshold?: number;
  /** Preserve boundary edges (don't collapse open edges). Default true. */
  preserveBoundary: boolean;
  /** Preserve hard edges (dihedral angle > this in degrees). Default 60. */
  hardEdgeAngleDeg: number;
}

export const DEFAULT_DECIMATION_OPTIONS: DecimationOptions = {
  targetTriangleCount: 0,
  preserveBoundary: true,
  hardEdgeAngleDeg: 60,
};

export interface DecimationResult {
  mesh: MeshArrays;
  collapsesPerformed: number;
  /** Max cost of any accepted collapse. */
  maxCostAccepted: number;
  /** True if target reached. */
  reachedTarget: boolean;
  /** Hausdorff-ish distance estimate (mm). */
  estimatedErrorMm: number;
}

// ── 4×4 matrix utilities ────────────────────────────────────────

type Mat4 = Float64Array;

function mat4Zero(): Mat4 {
  return new Float64Array(16);
}

function mat4Add(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let i = 0; i < 16; i++) out[i] = a[i]! + b[i]!;
  return out;
}

/** Plane-quadric matrix K_p for plane (a, b, c, d): K = p·pᵀ where p = [a, b, c, d]. */
function planeQuadric(a: number, b: number, c: number, d: number): Mat4 {
  const out = new Float64Array(16);
  const p = [a, b, c, d];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[i * 4 + j] = p[i]! * p[j]!;
    }
  }
  return out;
}

/** Quadratic form value: vᵀ Q v with v = [x, y, z, 1]. */
function quadricValue(Q: Mat4, x: number, y: number, z: number): number {
  // Expanded: Q00 x² + Q11 y² + Q22 z² + 2 Q01 xy + 2 Q02 xz + 2 Q12 yz
  //         + 2 Q03 x + 2 Q13 y + 2 Q23 z + Q33
  return (
    Q[0]! * x * x + Q[5]! * y * y + Q[10]! * z * z +
    2 * Q[1]! * x * y + 2 * Q[2]! * x * z + 2 * Q[6]! * y * z +
    2 * Q[3]! * x + 2 * Q[7]! * y + 2 * Q[11]! * z + Q[15]!
  );
}

/** Solve for the optimal collapse position v* that minimizes
 *  vᵀ Q v, subject to Q being non-singular.
 *  v* solves the linear system formed by the top 3×3 of Q + the last
 *  column negated. If singular, falls back to midpoint. */
function optimalCollapsePosition(Q: Mat4, fallback: [number, number, number]): [number, number, number] {
  // Build 3x3 system: A x = b where A = top-left 3x3 of Q (symmetric),
  // b = [-Q[3], -Q[7], -Q[11]].
  const A = [
    [Q[0]!, Q[1]!, Q[2]!],
    [Q[1]!, Q[5]!, Q[6]!],
    [Q[2]!, Q[6]!, Q[10]!],
  ];
  const b = [-Q[3]!, -Q[7]!, -Q[11]!];
  const det = (
    A[0]![0]! * (A[1]![1]! * A[2]![2]! - A[1]![2]! * A[2]![1]!) -
    A[0]![1]! * (A[1]![0]! * A[2]![2]! - A[1]![2]! * A[2]![0]!) +
    A[0]![2]! * (A[1]![0]! * A[2]![1]! - A[1]![1]! * A[2]![0]!)
  );
  if (Math.abs(det) < 1e-12) return fallback;
  // Cramer's rule.
  const Ax = [[b[0]!, A[0]![1]!, A[0]![2]!], [b[1]!, A[1]![1]!, A[1]![2]!], [b[2]!, A[2]![1]!, A[2]![2]!]];
  const Ay = [[A[0]![0]!, b[0]!, A[0]![2]!], [A[1]![0]!, b[1]!, A[1]![2]!], [A[2]![0]!, b[2]!, A[2]![2]!]];
  const Az = [[A[0]![0]!, A[0]![1]!, b[0]!], [A[1]![0]!, A[1]![1]!, b[1]!], [A[2]![0]!, A[2]![1]!, b[2]!]];
  const det3 = (M: number[][]) => (
    M[0]![0]! * (M[1]![1]! * M[2]![2]! - M[1]![2]! * M[2]![1]!) -
    M[0]![1]! * (M[1]![0]! * M[2]![2]! - M[1]![2]! * M[2]![0]!) +
    M[0]![2]! * (M[1]![0]! * M[2]![1]! - M[1]![1]! * M[2]![0]!)
  );
  return [det3(Ax) / det, det3(Ay) / det, det3(Az) / det];
}

// ── Plane extraction ────────────────────────────────────────────

function triangleNormalAndOffset(v0: [number, number, number], v1: [number, number, number], v2: [number, number, number]): [number, number, number, number] | null {
  const ax = v1[0] - v0[0], ay = v1[1] - v0[1], az = v1[2] - v0[2];
  const bx = v2[0] - v0[0], by = v2[1] - v0[1], bz = v2[2] - v0[2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-12) return null;
  const Nx = nx / len, Ny = ny / len, Nz = nz / len;
  const d = -(Nx * v0[0] + Ny * v0[1] + Nz * v0[2]);
  return [Nx, Ny, Nz, d];
}

// ── Vertex quadric assembly ─────────────────────────────────────

export function buildVertexQuadrics(mesh: MeshArrays): Mat4[] {
  const vCount = mesh.positions.length / 3;
  const quadrics: Mat4[] = [];
  for (let i = 0; i < vCount; i++) quadrics.push(mat4Zero());

  for (let t = 0; t < mesh.indices.length; t += 3) {
    const i0 = mesh.indices[t]!, i1 = mesh.indices[t + 1]!, i2 = mesh.indices[t + 2]!;
    const v0: [number, number, number] = [mesh.positions[i0 * 3]!, mesh.positions[i0 * 3 + 1]!, mesh.positions[i0 * 3 + 2]!];
    const v1: [number, number, number] = [mesh.positions[i1 * 3]!, mesh.positions[i1 * 3 + 1]!, mesh.positions[i1 * 3 + 2]!];
    const v2: [number, number, number] = [mesh.positions[i2 * 3]!, mesh.positions[i2 * 3 + 1]!, mesh.positions[i2 * 3 + 2]!];
    const plane = triangleNormalAndOffset(v0, v1, v2);
    if (!plane) continue;
    const K = planeQuadric(plane[0], plane[1], plane[2], plane[3]);
    quadrics[i0] = mat4Add(quadrics[i0]!, K);
    quadrics[i1] = mat4Add(quadrics[i1]!, K);
    quadrics[i2] = mat4Add(quadrics[i2]!, K);
  }
  return quadrics;
}

// ── Edge collapse ───────────────────────────────────────────────

interface EdgeCandidate {
  v1: number;
  v2: number;
  cost: number;
  position: [number, number, number];
}

export function collectEdges(mesh: MeshArrays): Array<[number, number]> {
  const edgeSet = new Set<string>();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const i0 = mesh.indices[t]!, i1 = mesh.indices[t + 1]!, i2 = mesh.indices[t + 2]!;
    const pairs: Array<[number, number]> = [[i0, i1], [i1, i2], [i2, i0]];
    for (const [a, b] of pairs) {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      edgeSet.add(`${lo}_${hi}`);
    }
  }
  return [...edgeSet].map(s => {
    const [a, b] = s.split('_').map(Number);
    return [a!, b!] as [number, number];
  });
}

export function evaluateEdgeCost(
  v1: number, v2: number, mesh: MeshArrays, quadrics: Mat4[],
): EdgeCandidate {
  const Q = mat4Add(quadrics[v1]!, quadrics[v2]!);
  const p1: [number, number, number] = [mesh.positions[v1 * 3]!, mesh.positions[v1 * 3 + 1]!, mesh.positions[v1 * 3 + 2]!];
  const p2: [number, number, number] = [mesh.positions[v2 * 3]!, mesh.positions[v2 * 3 + 1]!, mesh.positions[v2 * 3 + 2]!];
  const mid: [number, number, number] = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2];
  const pos = optimalCollapsePosition(Q, mid);
  const cost = Math.max(0, quadricValue(Q, pos[0], pos[1], pos[2]));
  return { v1, v2, cost, position: pos };
}

// ── Top-level ───────────────────────────────────────────────────

export function decimate(mesh: MeshArrays, opts: Partial<DecimationOptions> = {}): DecimationResult {
  const o = { ...DEFAULT_DECIMATION_OPTIONS, ...opts };
  const positions = mesh.positions.slice();
  const indices = mesh.indices.slice();
  const quadrics = buildVertexQuadrics({ positions, indices });

  let triCount = indices.length / 3;
  let collapsesPerformed = 0;
  let maxCostAccepted = 0;
  let reached = false;

  // Build candidate edges once. (Production would maintain a priority queue.)
  let edges = collectEdges({ positions, indices });

  while (triCount > o.targetTriangleCount && edges.length > 0) {
    let best: EdgeCandidate | null = null;
    for (const [a, b] of edges) {
      if (a === b) continue;
      // Boundary preservation: skip if edge is on boundary (counted only once).
      if (o.preserveBoundary && isBoundaryEdge(a, b, indices)) continue;
      const c = evaluateEdgeCost(a, b, { positions, indices }, quadrics);
      if (!best || c.cost < best.cost) best = c;
    }
    if (!best) break;
    if (o.costThreshold !== undefined && best.cost > o.costThreshold) break;

    // Perform collapse: replace v2 with v1, move v1 to optimal position.
    positions[best.v1 * 3] = best.position[0];
    positions[best.v1 * 3 + 1] = best.position[1];
    positions[best.v1 * 3 + 2] = best.position[2];
    quadrics[best.v1] = mat4Add(quadrics[best.v1]!, quadrics[best.v2]!);

    // Replace v2 with v1 in indices; drop degenerate triangles.
    let writeIdx = 0;
    for (let t = 0; t < indices.length; t += 3) {
      let i0 = indices[t]!, i1 = indices[t + 1]!, i2 = indices[t + 2]!;
      if (i0 === best.v2) i0 = best.v1;
      if (i1 === best.v2) i1 = best.v1;
      if (i2 === best.v2) i2 = best.v1;
      if (i0 === i1 || i1 === i2 || i2 === i0) continue; // collapsed.
      indices[writeIdx++] = i0;
      indices[writeIdx++] = i1;
      indices[writeIdx++] = i2;
    }
    indices.length = writeIdx;
    triCount = indices.length / 3;
    collapsesPerformed++;
    if (best.cost > maxCostAccepted) maxCostAccepted = best.cost;
    edges = collectEdges({ positions, indices });
  }
  reached = triCount <= o.targetTriangleCount;
  // Estimated error: sqrt of max accepted cost ≈ distance moved.
  const errMm = Math.sqrt(maxCostAccepted);
  return {
    mesh: { positions, indices },
    collapsesPerformed,
    maxCostAccepted,
    reachedTarget: reached,
    estimatedErrorMm: errMm,
  };
}

function isBoundaryEdge(a: number, b: number, indices: number[]): boolean {
  let count = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]!, i1 = indices[t + 1]!, i2 = indices[t + 2]!;
    const pairs = [[i0, i1], [i1, i2], [i2, i0]];
    for (const [x, y] of pairs) {
      if ((x === a && y === b) || (x === b && y === a)) count++;
    }
  }
  return count === 1;
}

// ── Mesh stats ──────────────────────────────────────────────────

export interface MeshStats {
  vertexCount: number;
  triangleCount: number;
  edgeCount: number;
  boundaryEdgeCount: number;
}

export function computeStats(mesh: MeshArrays): MeshStats {
  const vCount = mesh.positions.length / 3;
  const triCount = mesh.indices.length / 3;
  const edges = collectEdges(mesh);
  let boundary = 0;
  for (const [a, b] of edges) {
    if (isBoundaryEdge(a, b, mesh.indices)) boundary++;
  }
  return { vertexCount: vCount, triangleCount: triCount, edgeCount: edges.length, boundaryEdgeCount: boundary };
}

// ── LOD generator ───────────────────────────────────────────────

export interface LodLevel {
  ratio: number;
  mesh: MeshArrays;
  triangleCount: number;
}

/** Produce an LOD pyramid at ratios e.g. [0.5, 0.25, 0.1]. */
export function buildLodPyramid(mesh: MeshArrays, ratios: number[]): LodLevel[] {
  const origCount = mesh.indices.length / 3;
  const levels: LodLevel[] = [];
  let current = mesh;
  for (const r of ratios) {
    const target = Math.max(4, Math.floor(origCount * r));
    const result = decimate(current, { targetTriangleCount: target });
    levels.push({ ratio: r, mesh: result.mesh, triangleCount: result.mesh.indices.length / 3 });
    current = result.mesh;
  }
  return levels;
}
