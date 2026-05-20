/**
 * laplacianSmoothing.ts — Mesh smoothing via Laplacian iteration.
 *
 * Moves each vertex toward the average of its neighbors, slightly,
 * over N iterations. Two variants:
 *
 *   - **Uniform Laplacian**: average all neighbors equally.
 *     Simple, fast; tends to *shrink* convex shapes.
 *   - **Cotangent Laplacian (Desbrun)**: weight by cotangent of
 *     the opposite angle in each adjacent triangle. Preserves
 *     features better; no significant shrinkage.
 *
 * Module also offers:
 *
 *   - λ (relaxation) per iteration to control strength.
 *   - Optional boundary preservation (don't move boundary verts).
 *   - Adaptive stopping (max-displacement falls below ε).
 *   - Per-vertex history for the UI scrubber.
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export type SmoothingKind = 'uniform' | 'cotangent';

export interface SmoothResult {
  /** Smoothed mesh. */
  mesh: MeshArrays;
  /** Iterations actually performed. */
  iterationsRun: number;
  /** Max displacement (mm) on the final iteration. */
  finalMaxDisplacementMm: number;
  /** Vertex positions across iterations (for animation). */
  history?: number[][];
}

export interface SmoothOptions {
  kind: SmoothingKind;
  /** Number of iterations. */
  iterations: number;
  /** Relaxation factor (0..1). */
  lambdaPerIter: number;
  /** Preserve boundary vertices. */
  preserveBoundary: boolean;
  /** Stop when max displacement falls below this. */
  toleranceMm: number;
  /** Record per-iteration positions. */
  recordHistory: boolean;
}

export const DEFAULT_OPTIONS: SmoothOptions = {
  kind: 'uniform',
  iterations: 10,
  lambdaPerIter: 0.5,
  preserveBoundary: true,
  toleranceMm: 1e-5,
  recordHistory: false,
};

// ── Top-level entry ────────────────────────────────────────────

export function smoothMesh(mesh: MeshArrays, options: Partial<SmoothOptions> = {}): SmoothResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const vertexCount = mesh.positions.length / 3;
  if (vertexCount === 0) {
    const result: SmoothResult = {
      mesh: { positions: [], indices: mesh.indices.slice() },
      iterationsRun: 0,
      finalMaxDisplacementMm: 0,
    };
    if (opts.recordHistory) result.history = [];
    return result;
  }

  const positions = mesh.positions.slice();
  const adjacency = buildVertexAdjacency(mesh);
  const isBoundary = opts.preserveBoundary ? detectBoundaryVertices(mesh) : new Set<number>();

  const cotanWeights = opts.kind === 'cotangent' ? computeCotangentWeights(mesh) : null;
  const history: number[][] = [];
  let iter = 0;
  let lastMaxDisp = 0;

  for (iter = 0; iter < opts.iterations; iter++) {
    const newPositions = positions.slice();
    let maxDisp = 0;
    for (let v = 0; v < vertexCount; v++) {
      if (isBoundary.has(v)) continue;
      const neighbors = adjacency[v];
      if (!neighbors || neighbors.length === 0) continue;
      let sumX = 0, sumY = 0, sumZ = 0;
      let totalWeight = 0;
      for (const n of neighbors) {
        const w = cotanWeights ? (cotanWeights.get(edgeKey(v, n)) ?? 1) : 1;
        sumX += positions[n * 3]! * w;
        sumY += positions[n * 3 + 1]! * w;
        sumZ += positions[n * 3 + 2]! * w;
        totalWeight += w;
      }
      if (totalWeight === 0) continue;
      const avgX = sumX / totalWeight;
      const avgY = sumY / totalWeight;
      const avgZ = sumZ / totalWeight;
      const dx = (avgX - positions[v * 3]!) * opts.lambdaPerIter;
      const dy = (avgY - positions[v * 3 + 1]!) * opts.lambdaPerIter;
      const dz = (avgZ - positions[v * 3 + 2]!) * opts.lambdaPerIter;
      newPositions[v * 3] = positions[v * 3]! + dx;
      newPositions[v * 3 + 1] = positions[v * 3 + 1]! + dy;
      newPositions[v * 3 + 2] = positions[v * 3 + 2]! + dz;
      const disp = Math.hypot(dx, dy, dz);
      if (disp > maxDisp) maxDisp = disp;
    }
    for (let i = 0; i < positions.length; i++) positions[i] = newPositions[i]!;
    lastMaxDisp = maxDisp;
    if (opts.recordHistory) history.push(positions.slice());
    if (maxDisp < opts.toleranceMm) {
      iter++;
      break;
    }
  }

  const result: SmoothResult = {
    mesh: { positions, indices: mesh.indices.slice() },
    iterationsRun: iter,
    finalMaxDisplacementMm: lastMaxDisp,
  };
  if (opts.recordHistory) result.history = history;
  return result;
}

// ── Adjacency / boundary helpers ───────────────────────────────

function buildVertexAdjacency(mesh: MeshArrays): number[][] {
  const vertexCount = mesh.positions.length / 3;
  const adj: number[][] = [];
  for (let i = 0; i < vertexCount; i++) adj.push([]);
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const i0 = mesh.indices[t]!;
    const i1 = mesh.indices[t + 1]!;
    const i2 = mesh.indices[t + 2]!;
    addUnique(adj[i0]!, i1);
    addUnique(adj[i0]!, i2);
    addUnique(adj[i1]!, i0);
    addUnique(adj[i1]!, i2);
    addUnique(adj[i2]!, i0);
    addUnique(adj[i2]!, i1);
  }
  return adj;
}

function addUnique(arr: number[], v: number): void {
  if (!arr.includes(v)) arr.push(v);
}

function detectBoundaryVertices(mesh: MeshArrays): Set<number> {
  const edgeUses = new Map<string, number>();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const idx = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!];
    for (let e = 0; e < 3; e++) {
      const a = idx[e]!;
      const b = idx[(e + 1) % 3]!;
      const key = edgeKey(a, b);
      edgeUses.set(key, (edgeUses.get(key) ?? 0) + 1);
    }
  }
  const boundary = new Set<number>();
  for (const [key, count] of edgeUses) {
    if (count === 1) {
      const [aStr, bStr] = key.split('-');
      boundary.add(Number(aStr));
      boundary.add(Number(bStr));
    }
  }
  return boundary;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function computeCotangentWeights(mesh: MeshArrays): Map<string, number> {
  // For each undirected edge (i, j), sum cot(α) + cot(β) where α, β are the
  // angles opposite the edge in the two adjacent triangles.
  const weights = new Map<string, number>();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t]!;
    const b = mesh.indices[t + 1]!;
    const c = mesh.indices[t + 2]!;
    addCot(mesh, a, b, c, weights);
    addCot(mesh, b, c, a, weights);
    addCot(mesh, c, a, b, weights);
  }
  return weights;
}

function addCot(mesh: MeshArrays, i: number, j: number, opp: number, weights: Map<string, number>): void {
  const p1 = vertexAt(mesh, i);
  const p2 = vertexAt(mesh, j);
  const p3 = vertexAt(mesh, opp);
  // cot(angle at opp) = (e1 · e2) / |e1 × e2|, where e1 = p1-opp, e2 = p2-opp.
  const e1 = [p1[0] - p3[0], p1[1] - p3[1], p1[2] - p3[2]];
  const e2 = [p2[0] - p3[0], p2[1] - p3[1], p2[2] - p3[2]];
  const dot = e1[0]! * e2[0]! + e1[1]! * e2[1]! + e1[2]! * e2[2]!;
  const crossX = e1[1]! * e2[2]! - e1[2]! * e2[1]!;
  const crossY = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
  const crossZ = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
  const crossLen = Math.hypot(crossX, crossY, crossZ);
  if (crossLen < 1e-9) return;
  const cot = dot / crossLen;
  const key = edgeKey(i, j);
  weights.set(key, (weights.get(key) ?? 0) + cot);
}

function vertexAt(mesh: MeshArrays, i: number): [number, number, number] {
  return [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
}

// ── Summary ────────────────────────────────────────────────────

export interface SmoothSummary {
  iterationsRun: number;
  finalMaxDisplacementMm: number;
  converged: boolean;
  boundaryVertexCount: number;
}

export function summarize(originalMesh: MeshArrays, result: SmoothResult, toleranceMm: number = 1e-5): SmoothSummary {
  const boundary = detectBoundaryVertices(originalMesh);
  return {
    iterationsRun: result.iterationsRun,
    finalMaxDisplacementMm: result.finalMaxDisplacementMm,
    converged: result.finalMaxDisplacementMm < toleranceMm,
    boundaryVertexCount: boundary.size,
  };
}
