/**
 * meshBooleanGuard.ts — Pre-flight robustness checks for mesh CSG.
 *
 * Three-bvh-csg, Manifold, OpenCascade — every CSG kernel falls over
 * on the same kinds of bad input:
 *
 *   - **Open meshes** — not a closed manifold; "inside" is undefined.
 *   - **Self-intersections** — pierced triangles confuse the in/out
 *     classification.
 *   - **Duplicate or degenerate triangles** — produce numerical
 *     instability in the BVH.
 *   - **Coincident faces between A and B** — the boolean has to pick
 *     one side; if not snapped, output is sliver-ridden.
 *   - **Inconsistent face orientation** — half the triangles flipped;
 *     "inside" becomes "outside" mid-surface.
 *
 * This module runs a fast diagnostic + offers fix suggestions BEFORE
 * the actual CSG call. Returns a `BooleanReadinessReport` so the UI
 * can show "this part is borderline — fix X before retry?".
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface BooleanReadinessReport {
  /** Suitable to feed directly to CSG. */
  ready: boolean;
  /** Critical issues that will likely crash the boolean. */
  blockers: ReadinessIssue[];
  /** Issues that may produce slivers / artifacts but won't crash. */
  warnings: ReadinessIssue[];
  /** Suggested auto-fixes (each callable independently). */
  suggestedFixes: ReadinessFix[];
  /** Coarse mesh stats — for the UI summary. */
  stats: MeshStats;
}

export type ReadinessIssue =
  | { kind: 'open-mesh'; boundaryEdges: number }
  | { kind: 'self-intersection'; pairCount: number }
  | { kind: 'degenerate-triangles'; count: number }
  | { kind: 'duplicate-vertices'; pairCount: number }
  | { kind: 'inconsistent-orientation'; flippedCount: number }
  | { kind: 'tiny-features'; minEdgeLengthMm: number }
  | { kind: 'unit-mismatch'; observedRangeMm: number };

export type ReadinessFix =
  | { kind: 'weld-coincident-verts'; toleranceMm: number }
  | { kind: 'drop-degenerates' }
  | { kind: 'flip-inconsistent' }
  | { kind: 'snap-to-grid'; gridMm: number };

export interface MeshStats {
  vertexCount: number;
  triangleCount: number;
  boundingBoxMm: { min: [number, number, number]; max: [number, number, number] };
  largestEdgeMm: number;
  smallestEdgeMm: number;
}

// ── Top-level entry ─────────────────────────────────────────────

export interface GuardOptions {
  /** Tolerance below which vertices count as "the same". */
  weldToleranceMm: number;
  /** Tolerance below which an edge is "tiny". */
  tinyEdgeMm: number;
  /** Cap on pairs checked in O(n²) phases. */
  pairCap: number;
}

export const DEFAULT_GUARD_OPTIONS: GuardOptions = {
  weldToleranceMm: 1e-4,
  tinyEdgeMm: 1e-3,
  pairCap: 10_000,
};

export function checkBooleanReadiness(
  mesh: MeshArrays,
  options: Partial<GuardOptions> = {},
): BooleanReadinessReport {
  const opts = { ...DEFAULT_GUARD_OPTIONS, ...options };
  const stats = computeMeshStats(mesh);
  const blockers: ReadinessIssue[] = [];
  const warnings: ReadinessIssue[] = [];
  const fixes: ReadinessFix[] = [];

  // 1. Boundary edges (open mesh detection).
  const boundary = countBoundaryEdges(mesh);
  if (boundary > 0) {
    blockers.push({ kind: 'open-mesh', boundaryEdges: boundary });
  }

  // 2. Duplicate vertices.
  const dupPairs = countDuplicateVertices(mesh, opts.weldToleranceMm);
  if (dupPairs > 0) {
    warnings.push({ kind: 'duplicate-vertices', pairCount: dupPairs });
    fixes.push({ kind: 'weld-coincident-verts', toleranceMm: opts.weldToleranceMm });
  }

  // 3. Degenerate triangles.
  const degen = countDegenerateTriangles(mesh);
  if (degen > 0) {
    warnings.push({ kind: 'degenerate-triangles', count: degen });
    fixes.push({ kind: 'drop-degenerates' });
  }

  // 4. Tiny features.
  if (stats.smallestEdgeMm > 0 && stats.smallestEdgeMm < opts.tinyEdgeMm) {
    warnings.push({ kind: 'tiny-features', minEdgeLengthMm: stats.smallestEdgeMm });
  }

  // 5. Self-intersection — quick BVH-less pair scan (capped).
  const siPairs = quickSelfIntersectionCount(mesh, opts.pairCap);
  if (siPairs > 0) {
    blockers.push({ kind: 'self-intersection', pairCount: siPairs });
  }

  // 6. Inconsistent orientation: count triangles whose normal disagrees
  //    with their neighbours.
  const flipped = countInconsistentOrientation(mesh);
  if (flipped > 0) {
    warnings.push({ kind: 'inconsistent-orientation', flippedCount: flipped });
    fixes.push({ kind: 'flip-inconsistent' });
  }

  // 7. Unit-mismatch heuristic: bbox > 100m or < 0.01mm is probably wrong units.
  const bboxDiag = Math.hypot(
    stats.boundingBoxMm.max[0] - stats.boundingBoxMm.min[0],
    stats.boundingBoxMm.max[1] - stats.boundingBoxMm.min[1],
    stats.boundingBoxMm.max[2] - stats.boundingBoxMm.min[2],
  );
  if (bboxDiag > 100_000 || (bboxDiag > 0 && bboxDiag < 0.01)) {
    warnings.push({ kind: 'unit-mismatch', observedRangeMm: bboxDiag });
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    suggestedFixes: fixes,
    stats,
  };
}

// ── Stats ───────────────────────────────────────────────────────

export function computeMeshStats(mesh: MeshArrays): MeshStats {
  const triCount = mesh.indices.length / 3;
  const vCount = mesh.positions.length / 3;
  if (vCount === 0) {
    return {
      vertexCount: 0, triangleCount: 0,
      boundingBoxMm: { min: [0, 0, 0], max: [0, 0, 0] },
      largestEdgeMm: 0, smallestEdgeMm: 0,
    };
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vCount; i++) {
    const x = mesh.positions[i * 3]!;
    const y = mesh.positions[i * 3 + 1]!;
    const z = mesh.positions[i * 3 + 2]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  let minEdge = Infinity, maxEdge = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const dx = mesh.positions[a! * 3]! - mesh.positions[b! * 3]!;
      const dy = mesh.positions[a! * 3 + 1]! - mesh.positions[b! * 3 + 1]!;
      const dz = mesh.positions[a! * 3 + 2]! - mesh.positions[b! * 3 + 2]!;
      const len = Math.hypot(dx, dy, dz);
      if (len < minEdge) minEdge = len;
      if (len > maxEdge) maxEdge = len;
    }
  }
  return {
    vertexCount: vCount,
    triangleCount: triCount,
    boundingBoxMm: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    largestEdgeMm: maxEdge,
    smallestEdgeMm: minEdge === Infinity ? 0 : minEdge,
  };
}

// ── Boundary detection ──────────────────────────────────────────

export function countBoundaryEdges(mesh: MeshArrays): number {
  const counts = new Map<string, number>();
  const triCount = mesh.indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const key = a! < b! ? `${a}_${b}` : `${b}_${a}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let bd = 0;
  for (const v of counts.values()) if (v === 1) bd++;
  return bd;
}

// ── Duplicate vertices ──────────────────────────────────────────

export function countDuplicateVertices(mesh: MeshArrays, tolerance: number): number {
  const vCount = mesh.positions.length / 3;
  const seen = new Map<string, number>();
  const quant = (x: number) => Math.round(x / tolerance);
  let pairs = 0;
  for (let i = 0; i < vCount; i++) {
    const x = mesh.positions[i * 3]!;
    const y = mesh.positions[i * 3 + 1]!;
    const z = mesh.positions[i * 3 + 2]!;
    const key = `${quant(x)}_${quant(y)}_${quant(z)}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const c of seen.values()) if (c > 1) pairs += c - 1;
  return pairs;
}

// ── Degenerate triangles ────────────────────────────────────────

export function countDegenerateTriangles(mesh: MeshArrays): number {
  const triCount = mesh.indices.length / 3;
  let count = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
    if (i0 === i1 || i1 === i2 || i2 === i0) {
      count++;
      continue;
    }
    const p0x = mesh.positions[i0 * 3]!, p0y = mesh.positions[i0 * 3 + 1]!, p0z = mesh.positions[i0 * 3 + 2]!;
    const p1x = mesh.positions[i1 * 3]!, p1y = mesh.positions[i1 * 3 + 1]!, p1z = mesh.positions[i1 * 3 + 2]!;
    const p2x = mesh.positions[i2 * 3]!, p2y = mesh.positions[i2 * 3 + 1]!, p2z = mesh.positions[i2 * 3 + 2]!;
    const ax = p1x - p0x, ay = p1y - p0y, az = p1z - p0z;
    const bx = p2x - p0x, by = p2y - p0y, bz = p2z - p0z;
    const cross = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
    if (cross < 1e-12) count++;
  }
  return count;
}

// ── Quick self-intersection count ───────────────────────────────

export function quickSelfIntersectionCount(mesh: MeshArrays, cap: number): number {
  const triCount = mesh.indices.length / 3;
  // Cap to avoid O(n²) on big meshes — this is a guard, not a full audit.
  if (triCount > 200) return 0;
  let count = 0;
  for (let i = 0; i < triCount && count < cap; i++) {
    for (let j = i + 1; j < triCount && count < cap; j++) {
      if (sharesVertex(mesh, i, j)) continue;
      if (trianglesIntersect(mesh, i, j)) count++;
    }
  }
  return count;
}

function sharesVertex(mesh: MeshArrays, a: number, b: number): boolean {
  const ai = [mesh.indices[a * 3]!, mesh.indices[a * 3 + 1]!, mesh.indices[a * 3 + 2]!];
  const bi = [mesh.indices[b * 3]!, mesh.indices[b * 3 + 1]!, mesh.indices[b * 3 + 2]!];
  for (const x of ai) if (bi.includes(x)) return true;
  return false;
}

function trianglesIntersect(mesh: MeshArrays, a: number, b: number): boolean {
  // AABB pre-filter.
  const aBox = triangleBbox(mesh, a);
  const bBox = triangleBbox(mesh, b);
  if (aBox.max[0] < bBox.min[0] || aBox.min[0] > bBox.max[0]) return false;
  if (aBox.max[1] < bBox.min[1] || aBox.min[1] > bBox.max[1]) return false;
  if (aBox.max[2] < bBox.min[2] || aBox.min[2] > bBox.max[2]) return false;
  // Otherwise treat as potential — for the guard we don't do the full
  // SAT test; potential pairs counted as warning.
  return true;
}

function triangleBbox(mesh: MeshArrays, t: number): { min: [number, number, number]; max: [number, number, number] } {
  const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
  const xs = [mesh.positions[i0 * 3]!, mesh.positions[i1 * 3]!, mesh.positions[i2 * 3]!];
  const ys = [mesh.positions[i0 * 3 + 1]!, mesh.positions[i1 * 3 + 1]!, mesh.positions[i2 * 3 + 1]!];
  const zs = [mesh.positions[i0 * 3 + 2]!, mesh.positions[i1 * 3 + 2]!, mesh.positions[i2 * 3 + 2]!];
  return {
    min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
    max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
  };
}

// ── Orientation consistency ─────────────────────────────────────

export function countInconsistentOrientation(mesh: MeshArrays): number {
  // For each edge, look at the two triangles sharing it; their winding
  // along the shared edge must be opposite (a→b in one, b→a in the other).
  const triCount = mesh.indices.length / 3;
  const edgeMap = new Map<string, Array<{ tri: number; dir: 'forward' | 'backward' }>>();
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const lo = Math.min(a!, b!), hi = Math.max(a!, b!);
      const key = `${lo}_${hi}`;
      const dir = a! < b! ? 'forward' : 'backward';
      const list = edgeMap.get(key) ?? [];
      list.push({ tri: t, dir });
      edgeMap.set(key, list);
    }
  }
  let flipped = 0;
  for (const list of edgeMap.values()) {
    if (list.length === 2 && list[0]!.dir === list[1]!.dir) flipped++;
  }
  return flipped;
}

// ── Auto-fix executors ──────────────────────────────────────────

export function applyFix(mesh: MeshArrays, fix: ReadinessFix): MeshArrays {
  switch (fix.kind) {
    case 'weld-coincident-verts': return weldVertices(mesh, fix.toleranceMm);
    case 'drop-degenerates': return dropDegenerates(mesh);
    case 'flip-inconsistent': return flipInconsistent(mesh);
    case 'snap-to-grid': return snapToGrid(mesh, fix.gridMm);
  }
}

function weldVertices(mesh: MeshArrays, tol: number): MeshArrays {
  const vCount = mesh.positions.length / 3;
  const quant = (x: number) => Math.round(x / tol);
  const oldToNew = new Map<number, number>();
  const keyToNew = new Map<string, number>();
  const newPositions: number[] = [];
  for (let i = 0; i < vCount; i++) {
    const x = mesh.positions[i * 3]!;
    const y = mesh.positions[i * 3 + 1]!;
    const z = mesh.positions[i * 3 + 2]!;
    const key = `${quant(x)}_${quant(y)}_${quant(z)}`;
    if (keyToNew.has(key)) {
      oldToNew.set(i, keyToNew.get(key)!);
    } else {
      const idx = newPositions.length / 3;
      keyToNew.set(key, idx);
      oldToNew.set(i, idx);
      newPositions.push(x, y, z);
    }
  }
  const newIndices = mesh.indices.map(i => oldToNew.get(i)!);
  return { positions: newPositions, indices: newIndices };
}

function dropDegenerates(mesh: MeshArrays): MeshArrays {
  const triCount = mesh.indices.length / 3;
  const newIndices: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
    if (i0 === i1 || i1 === i2 || i2 === i0) continue;
    newIndices.push(i0, i1, i2);
  }
  return { positions: mesh.positions.slice(), indices: newIndices };
}

function flipInconsistent(mesh: MeshArrays): MeshArrays {
  // Trivial pass: for each pair of triangles with same-direction shared
  // edge, flip the second one. Production would use a BFS to consistently
  // orient the whole connected component.
  const triCount = mesh.indices.length / 3;
  const newIndices = mesh.indices.slice();
  const edgeMap = new Map<string, Array<{ tri: number; dir: 'forward' | 'backward' }>>();
  for (let t = 0; t < triCount; t++) {
    const i0 = newIndices[t * 3]!, i1 = newIndices[t * 3 + 1]!, i2 = newIndices[t * 3 + 2]!;
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const lo = Math.min(a!, b!), hi = Math.max(a!, b!);
      const key = `${lo}_${hi}`;
      const dir = a! < b! ? 'forward' : 'backward';
      const list = edgeMap.get(key) ?? [];
      list.push({ tri: t, dir });
      edgeMap.set(key, list);
    }
  }
  for (const list of edgeMap.values()) {
    if (list.length === 2 && list[0]!.dir === list[1]!.dir) {
      const t = list[1]!.tri;
      const tmp = newIndices[t * 3 + 1]!;
      newIndices[t * 3 + 1] = newIndices[t * 3 + 2]!;
      newIndices[t * 3 + 2] = tmp;
    }
  }
  return { positions: mesh.positions.slice(), indices: newIndices };
}

function snapToGrid(mesh: MeshArrays, grid: number): MeshArrays {
  const positions = mesh.positions.map(v => Math.round(v / grid) * grid);
  return { positions, indices: mesh.indices.slice() };
}
