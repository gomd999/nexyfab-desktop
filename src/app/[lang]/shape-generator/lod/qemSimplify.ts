import * as THREE from 'three';

/**
 * Quadric Error Metrics (QEM) mesh simplification.
 *
 * Based on: Garland & Heckbert (1997) "Surface Simplification Using Quadric Error Metrics"
 *
 * Algorithm:
 * 1. Compute Q matrix (4×4 symmetric) for each vertex = sum of face fundamental quadrics
 * 2. For each edge, compute optimal contraction point and cost = v^T (Q1+Q2) v
 * 3. Greedily collapse minimum-cost edges using a min-heap
 * 4. Update Q matrices and costs after each collapse
 *
 * Accuracy: Much better than vertex clustering for sharp features (gears, fillets, flanges)
 */

/** 4×4 symmetric quadric matrix stored as 10 unique values (upper triangle) */
type Quadric = Float64Array; // length 10: q00,q01,q02,q03, q11,q12,q13, q22,q23, q33

function makeZeroQuadric(): Quadric {
  return new Float64Array(10);
}

/**
 * Build the fundamental error quadric for a plane ax+by+cz+d=0.
 * Q = [a,b,c,d]^T [a,b,c,d] = outer product
 */
function planeQuadric(a: number, b: number, c: number, d: number): Quadric {
  const q = new Float64Array(10);
  q[0] = a * a; q[1] = a * b; q[2] = a * c; q[3] = a * d;
  q[4] = b * b; q[5] = b * c; q[6] = b * d;
  q[7] = c * c; q[8] = c * d;
  q[9] = d * d;
  return q;
}

function addQuadrics(a: Quadric, b: Quadric): Quadric {
  const r = new Float64Array(10);
  for (let i = 0; i < 10; i++) r[i] = a[i] + b[i];
  return r;
}

/**
 * Evaluate quadric error at point v: error = v^T Q v
 * v is [x, y, z, 1]
 */
function evalQuadric(q: Quadric, x: number, y: number, z: number): number {
  return (
    q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x +
    q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y +
    q[7] * z * z + 2 * q[8] * z +
    q[9]
  );
}

/**
 * Find optimal contraction point by solving the linear system:
 * [ q00 q01 q02 q03 ]   [ x ]   [ 0 ]
 * [ q01 q11 q12 q13 ] × [ y ] = [ 0 ]
 * [ q02 q12 q22 q23 ]   [ z ]   [ 0 ]
 * [ 0   0   0   1   ]   [ 1 ]   [ 1 ]
 *
 * Returns null if the system is near-singular (use midpoint fallback instead).
 */
function optimalPoint(q: Quadric): [number, number, number] | null {
  const a = [
    [q[0], q[1], q[2]],
    [q[1], q[4], q[5]],
    [q[2], q[5], q[7]],
  ];
  const b = [-q[3], -q[6], -q[8]];

  // Gaussian elimination with partial pivoting
  for (let col = 0; col < 3; col++) {
    let maxRow = col;
    let maxVal = Math.abs(a[col][col]);
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(a[row][col]) > maxVal) {
        maxVal = Math.abs(a[row][col]);
        maxRow = row;
      }
    }
    [a[col], a[maxRow]] = [a[maxRow], a[col]];
    [b[col], b[maxRow]] = [b[maxRow], b[col]];

    if (Math.abs(a[col][col]) < 1e-10) return null; // singular

    const pivot = a[col][col];
    for (let row = col + 1; row < 3; row++) {
      const factor = a[row][col] / pivot;
      b[row] -= factor * b[col];
      for (let k = col; k < 3; k++) a[row][k] -= factor * a[col][k];
    }
  }

  // Back substitution
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    x[i] = b[i];
    for (let j = i + 1; j < 3; j++) x[i] -= a[i][j] * x[j];
    x[i] /= a[i][i];
  }

  if (!isFinite(x[0]) || !isFinite(x[1]) || !isFinite(x[2])) return null;
  return [x[0], x[1], x[2]];
}

/** Simple min-heap for the edge collapse priority queue. */
class MinHeap<T> {
  private data: { cost: number; item: T }[] = [];

  push(cost: number, item: T) {
    this.data.push({ cost, item });
    this._bubbleUp(this.data.length - 1);
  }

  pop(): { cost: number; item: T } | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  get size() { return this.data.length; }

  private _bubbleUp(i: number) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[parent].cost <= this.data[i].cost) break;
      [this.data[parent], this.data[i]] = [this.data[i], this.data[parent]];
      i = parent;
    }
  }

  private _sinkDown(i: number) {
    const n = this.data.length;
    while (true) {
      let min = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.data[l].cost < this.data[min].cost) min = l;
      if (r < n && this.data[r].cost < this.data[min].cost) min = r;
      if (min === i) break;
      [this.data[min], this.data[i]] = [this.data[i], this.data[min]];
      i = min;
    }
  }
}

export interface QEMOptions {
  /** Target ratio of triangles to keep (0–1). E.g. 0.5 = keep 50% of faces. */
  targetRatio: number;
  /** Maximum allowed quadric error (units²). Stops early if all remaining errors exceed this. */
  maxError?: number;
  /** Preserve boundary edges to prevent holes appearing. Default: true. */
  preserveBoundary?: boolean;
}

export interface QEMResult {
  geometry: THREE.BufferGeometry;
  originalTriCount: number;
  resultTriCount: number;
  reductionPercent: number;
}

/**
 * Simplify a mesh using Quadric Error Metrics.
 * Handles both non-indexed and indexed BufferGeometry inputs.
 */
export function simplifyQEM(
  inputGeo: THREE.BufferGeometry,
  options: QEMOptions,
): QEMResult {
  const geo = inputGeo.toNonIndexed();
  geo.computeVertexNormals();

  const positions = geo.getAttribute('position') as THREE.BufferAttribute;
  const originalTriCount = positions.count / 3;

  if (originalTriCount < 4) {
    return {
      geometry: geo,
      originalTriCount,
      resultTriCount: originalTriCount,
      reductionPercent: 0,
    };
  }

  // --- Step 1: Collect unique vertices (weld near-coincident vertices) ---
  const MERGE_EPS = 1e-6;
  const vertArr: THREE.Vector3[] = [];
  const triIndices: number[] = []; // 3 entries per triangle
  const vertMap = new Map<string, number>();

  const quantize = (v: number) => Math.round(v / MERGE_EPS) * MERGE_EPS;
  const posKey = (x: number, y: number, z: number) =>
    `${quantize(x).toFixed(6)},${quantize(y).toFixed(6)},${quantize(z).toFixed(6)}`;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const k = posKey(x, y, z);
    if (!vertMap.has(k)) {
      vertMap.set(k, vertArr.length);
      vertArr.push(new THREE.Vector3(x, y, z));
    }
    triIndices.push(vertMap.get(k)!);
  }

  const nVerts = vertArr.length;
  const nTris = triIndices.length / 3;

  // --- Step 2: Compute per-vertex quadrics ---
  const quadrics: Quadric[] = Array.from({ length: nVerts }, makeZeroQuadric);

  // Detect boundary edges (edges shared by exactly one triangle)
  const edgeCount = new Map<string, number>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

  for (let t = 0; t < nTris; t++) {
    const i0 = triIndices[t * 3], i1 = triIndices[t * 3 + 1], i2 = triIndices[t * 3 + 2];
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const k = edgeKey(a, b);
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  }

  const isBoundaryEdge = (a: number, b: number) =>
    (edgeCount.get(edgeKey(a, b)) ?? 0) === 1;

  // Build vertex → triangle adjacency
  const vertTris: number[][] = Array.from({ length: nVerts }, () => []);
  for (let t = 0; t < nTris; t++) {
    vertTris[triIndices[t * 3]].push(t);
    vertTris[triIndices[t * 3 + 1]].push(t);
    vertTris[triIndices[t * 3 + 2]].push(t);
  }

  // Compute face planes and accumulate fundamental quadrics onto each vertex
  for (let t = 0; t < nTris; t++) {
    const i0 = triIndices[t * 3], i1 = triIndices[t * 3 + 1], i2 = triIndices[t * 3 + 2];
    const v0 = vertArr[i0], v1 = vertArr[i1], v2 = vertArr[i2];

    const e1 = v1.clone().sub(v0);
    const e2 = v2.clone().sub(v0);
    const n = e1.cross(e2);
    const len = n.length();
    if (len < 1e-10) continue; // degenerate face — skip
    n.divideScalar(len);

    const d = -n.dot(v0);
    const fq = planeQuadric(n.x, n.y, n.z, d);

    for (const vi of [i0, i1, i2]) {
      quadrics[vi] = addQuadrics(quadrics[vi], fq);
    }
  }

  // --- Step 3: Build initial edge collapse candidates ---
  interface EdgeCollapse {
    v0: number;
    v1: number;
    cost: number;
    optX: number;
    optY: number;
    optZ: number;
    /** Invalidation token: sum of both vertex versions at creation time. */
    version: number;
  }

  const vertVersion = new Int32Array(nVerts);
  const deleted = new Uint8Array(nVerts);
  const deletedTri = new Uint8Array(nTris);

  const heap = new MinHeap<EdgeCollapse>();

  const computeEdgeCollapse = (v0: number, v1: number): EdgeCollapse => {
    const combinedQ = addQuadrics(quadrics[v0], quadrics[v1]);
    const opt = optimalPoint(combinedQ);

    let ox: number, oy: number, oz: number;
    if (opt) {
      [ox, oy, oz] = opt;
    } else {
      // Singular system: compare midpoint and both endpoints, pick lowest cost
      const mx = (vertArr[v0].x + vertArr[v1].x) / 2;
      const my = (vertArr[v0].y + vertArr[v1].y) / 2;
      const mz = (vertArr[v0].z + vertArr[v1].z) / 2;
      const c0 = evalQuadric(combinedQ, vertArr[v0].x, vertArr[v0].y, vertArr[v0].z);
      const c1 = evalQuadric(combinedQ, vertArr[v1].x, vertArr[v1].y, vertArr[v1].z);
      const cm = evalQuadric(combinedQ, mx, my, mz);
      if (cm <= c0 && cm <= c1) { ox = mx; oy = my; oz = mz; }
      else if (c0 <= c1) { ox = vertArr[v0].x; oy = vertArr[v0].y; oz = vertArr[v0].z; }
      else { ox = vertArr[v1].x; oy = vertArr[v1].y; oz = vertArr[v1].z; }
    }

    const cost = evalQuadric(combinedQ, ox, oy, oz);
    return { v0, v1, cost, optX: ox, optY: oy, optZ: oz, version: vertVersion[v0] + vertVersion[v1] };
  };

  // Add all unique mesh edges to the heap with correct costs
  const seenEdges = new Set<string>();
  for (let t = 0; t < nTris; t++) {
    const i0 = triIndices[t * 3], i1 = triIndices[t * 3 + 1], i2 = triIndices[t * 3 + 2];
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]] as [number, number][]) {
      const k = edgeKey(a, b);
      if (!seenEdges.has(k)) {
        seenEdges.add(k);
        if ((options.preserveBoundary !== false) && isBoundaryEdge(a, b)) continue;
        const ec = computeEdgeCollapse(a, b);
        heap.push(ec.cost, ec);
      }
    }
  }

  // --- Step 4: Greedy edge collapse loop ---
  const targetTris = Math.max(4, Math.round(originalTriCount * options.targetRatio));
  let currentTris = nTris;
  const maxError = options.maxError ?? Infinity;

  while (currentTris > targetTris && heap.size > 0) {
    const entry = heap.pop();
    if (!entry) break;
    const ec = entry.item;

    // Stale check: if either vertex was modified since this entry was created, skip it
    if (ec.version !== vertVersion[ec.v0] + vertVersion[ec.v1]) continue;
    if (deleted[ec.v0] || deleted[ec.v1]) continue;
    if (ec.cost > maxError) break;

    const { v0, v1, optX, optY, optZ } = ec;

    // Collapse v1 into v0: move v0 to optimal point, accumulate quadric, mark v1 deleted
    vertArr[v0].set(optX, optY, optZ);
    quadrics[v0] = addQuadrics(quadrics[v0], quadrics[v1]);
    deleted[v1] = 1;
    vertVersion[v0]++;

    // Redirect all v1 references to v0; detect and mark newly degenerate triangles
    let collapsedCount = 0;
    for (const t of vertTris[v1]) {
      if (deletedTri[t]) continue;
      for (let k = 0; k < 3; k++) {
        if (triIndices[t * 3 + k] === v1) triIndices[t * 3 + k] = v0;
      }
      const a = triIndices[t * 3], b = triIndices[t * 3 + 1], c = triIndices[t * 3 + 2];
      if (a === b || b === c || a === c) {
        deletedTri[t] = 1;
        collapsedCount++;
      } else {
        vertTris[v0].push(t);
      }
    }
    currentTris -= collapsedCount;

    // Re-compute costs for all edges now incident on v0
    const recomputedEdges = new Set<string>();
    for (const t of vertTris[v0]) {
      if (deletedTri[t]) continue;
      const i0 = triIndices[t * 3], i1 = triIndices[t * 3 + 1], i2 = triIndices[t * 3 + 2];
      for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]] as [number, number][]) {
        const k = edgeKey(a, b);
        if (!recomputedEdges.has(k) && a !== b) {
          recomputedEdges.add(k);
          if ((options.preserveBoundary !== false) && isBoundaryEdge(a, b)) continue;
          const newEc = computeEdgeCollapse(a, b);
          heap.push(newEc.cost, newEc);
        }
      }
    }
  }

  // --- Step 5: Build output geometry ---
  const outputPositions: number[] = [];

  for (let t = 0; t < nTris; t++) {
    if (deletedTri[t]) continue;
    const i0 = triIndices[t * 3], i1 = triIndices[t * 3 + 1], i2 = triIndices[t * 3 + 2];
    if (deleted[i0] || deleted[i1] || deleted[i2]) continue;
    if (i0 === i1 || i1 === i2 || i0 === i2) continue;

    for (const vi of [i0, i1, i2]) {
      outputPositions.push(vertArr[vi].x, vertArr[vi].y, vertArr[vi].z);
    }
  }

  const outGeo = new THREE.BufferGeometry();
  outGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(outputPositions), 3),
  );
  outGeo.computeVertexNormals();
  outGeo.computeBoundingBox();
  outGeo.computeBoundingSphere();

  const resultTriCount = outputPositions.length / 9;

  return {
    geometry: outGeo,
    originalTriCount,
    resultTriCount,
    reductionPercent: Math.round((1 - resultTriCount / originalTriCount) * 100),
  };
}
