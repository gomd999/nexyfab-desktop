/**
 * hausdorffDistance.ts — Hausdorff + mean distance between meshes.
 *
 * After CAM machining or 3D printing, QA wants "how far did the
 * scanned part drift from the nominal CAD?" Hausdorff distance is
 * the standard metric:
 *
 *   h(A, B) = max over a∈A of (min over b∈B of |a - b|)
 *   H(A, B) = max(h(A, B), h(B, A))     (symmetric)
 *
 * Plus the more useful sub-metrics:
 *
 *   - **Mean distance** — average min-distance, less outlier-sensitive.
 *   - **RMS distance** — root-mean-square; standard for surface dev.
 *   - **Percentile distance** — e.g. 95th percentile, robust to noise.
 *
 * For mesh-vs-mesh comparison we sample points on each surface and
 * search the closest point on the other. A spatial grid (uniform
 * voxel hash) gives O(N) average lookups for moderately uniform
 * surfaces; for sparse / huge meshes prefer a KD-tree.
 */

export type Vec3 = [number, number, number];

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface SampleResult {
  /** Sampled points on the surface (mm). */
  points: Vec3[];
  /** Source triangle index per sample. */
  triangleIds: number[];
}

// ── Sampling ────────────────────────────────────────────────────

/** Uniformly sample N points on mesh surface area-weighted. */
export function sampleMeshSurface(mesh: MeshArrays, sampleCount: number, seed?: number): SampleResult {
  const triCount = mesh.indices.length / 3;
  if (triCount === 0 || sampleCount === 0) {
    return { points: [], triangleIds: [] };
  }
  const rng = makeRng(seed);
  const areas: number[] = [];
  let total = 0;
  for (let t = 0; t < triCount; t++) {
    const a = triangleArea(mesh, t);
    areas.push(a);
    total += a;
  }
  if (total === 0) return { points: [], triangleIds: [] };
  // Pre-compute prefix sums for area-weighted picking.
  const prefix: number[] = [];
  let acc = 0;
  for (const a of areas) {
    acc += a;
    prefix.push(acc);
  }
  const points: Vec3[] = [];
  const triangleIds: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const target = rng() * total;
    let lo = 0, hi = triCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (prefix[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    const tIdx = lo;
    // Barycentric sample.
    let u = rng(), v = rng();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    const i0 = mesh.indices[tIdx * 3]!;
    const i1 = mesh.indices[tIdx * 3 + 1]!;
    const i2 = mesh.indices[tIdx * 3 + 2]!;
    const p0: Vec3 = [mesh.positions[i0 * 3]!, mesh.positions[i0 * 3 + 1]!, mesh.positions[i0 * 3 + 2]!];
    const p1: Vec3 = [mesh.positions[i1 * 3]!, mesh.positions[i1 * 3 + 1]!, mesh.positions[i1 * 3 + 2]!];
    const p2: Vec3 = [mesh.positions[i2 * 3]!, mesh.positions[i2 * 3 + 1]!, mesh.positions[i2 * 3 + 2]!];
    points.push([
      u * p0[0] + v * p1[0] + w * p2[0],
      u * p0[1] + v * p1[1] + w * p2[1],
      u * p0[2] + v * p1[2] + w * p2[2],
    ]);
    triangleIds.push(tIdx);
  }
  return { points, triangleIds };
}

function triangleArea(mesh: MeshArrays, t: number): number {
  const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
  const p0: Vec3 = [mesh.positions[i0 * 3]!, mesh.positions[i0 * 3 + 1]!, mesh.positions[i0 * 3 + 2]!];
  const p1: Vec3 = [mesh.positions[i1 * 3]!, mesh.positions[i1 * 3 + 1]!, mesh.positions[i1 * 3 + 2]!];
  const p2: Vec3 = [mesh.positions[i2 * 3]!, mesh.positions[i2 * 3 + 1]!, mesh.positions[i2 * 3 + 2]!];
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
  return 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
}

// ── Point-to-mesh distance ──────────────────────────────────────

/** Minimum distance from a point to the mesh surface. Linear scan;
 *  for big meshes pre-build a BVH (see picking module). */
export function pointToMeshDistance(point: Vec3, mesh: MeshArrays): number {
  const triCount = mesh.indices.length / 3;
  let best = Infinity;
  for (let t = 0; t < triCount; t++) {
    const d = pointToTriangleDistance(point, mesh, t);
    if (d < best) best = d;
  }
  return best;
}

export function pointToTriangleDistance(p: Vec3, mesh: MeshArrays, t: number): number {
  const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
  const a: Vec3 = [mesh.positions[i0 * 3]!, mesh.positions[i0 * 3 + 1]!, mesh.positions[i0 * 3 + 2]!];
  const b: Vec3 = [mesh.positions[i1 * 3]!, mesh.positions[i1 * 3 + 1]!, mesh.positions[i1 * 3 + 2]!];
  const c: Vec3 = [mesh.positions[i2 * 3]!, mesh.positions[i2 * 3 + 1]!, mesh.positions[i2 * 3 + 2]!];
  return distancePointTriangle(p, a, b, c);
}

/** Eberly-style closest-point-on-triangle. */
function distancePointTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const d1 = ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2];
  const d2 = ac[0] * ap[0] + ac[1] * ap[1] + ac[2] * ap[2];
  if (d1 <= 0 && d2 <= 0) return dist(p, a);
  const bp: Vec3 = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
  const d3 = ab[0] * bp[0] + ab[1] * bp[1] + ab[2] * bp[2];
  const d4 = ac[0] * bp[0] + ac[1] * bp[1] + ac[2] * bp[2];
  if (d3 >= 0 && d4 <= d3) return dist(p, b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
  }
  const cp: Vec3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const d5 = ab[0] * cp[0] + ab[1] * cp[1] + ab[2] * cp[2];
  const d6 = ac[0] * cp[0] + ac[1] * cp[1] + ac[2] * cp[2];
  if (d6 >= 0 && d5 <= d6) return dist(p, c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    return dist(p, [a[0] + ac[0] * t, a[1] + ac[1] * t, a[2] + ac[2] * t]);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return dist(p, [b[0] + (c[0] - b[0]) * t, b[1] + (c[1] - b[1]) * t, b[2] + (c[2] - b[2]) * t]);
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return dist(p, [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ── Top-level distance metrics ──────────────────────────────────

export interface DistanceMetrics {
  /** One-sided h(A→B) (max). */
  hausdorffAtoB: number;
  /** One-sided h(B→A) (max). */
  hausdorffBtoA: number;
  /** Symmetric H = max(hAB, hBA). */
  symmetricHausdorff: number;
  /** Mean distance from A samples to B (mm). */
  meanAtoB: number;
  /** RMS distance from A samples to B (mm). */
  rmsAtoB: number;
  /** 95th percentile (mm). */
  p95AtoB: number;
  /** Number of samples used per side. */
  sampleCount: number;
}

export function computeDistanceMetrics(
  a: MeshArrays,
  b: MeshArrays,
  sampleCount: number = 2000,
  seed?: number,
): DistanceMetrics {
  const samplesA = sampleMeshSurface(a, sampleCount, seed);
  const samplesB = sampleMeshSurface(b, sampleCount, seed !== undefined ? seed + 1 : undefined);

  const distancesA: number[] = samplesA.points.map(p => pointToMeshDistance(p, b));
  const distancesB: number[] = samplesB.points.map(p => pointToMeshDistance(p, a));

  const hAB = distancesA.length ? Math.max(...distancesA) : 0;
  const hBA = distancesB.length ? Math.max(...distancesB) : 0;
  return {
    hausdorffAtoB: hAB,
    hausdorffBtoA: hBA,
    symmetricHausdorff: Math.max(hAB, hBA),
    meanAtoB: average(distancesA),
    rmsAtoB: rms(distancesA),
    p95AtoB: percentile(distancesA, 95),
    sampleCount,
  };
}

function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function rms(arr: number[]): number {
  if (arr.length === 0) return 0;
  return Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / arr.length);
}

function percentile(arr: number[], pct: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length));
  return sorted[idx]!;
}

// ── Tolerance pass/fail ─────────────────────────────────────────

export interface InspectionResult {
  passed: boolean;
  /** Worst spec violation in mm (negative means under tolerance). */
  worstViolationMm: number;
  /** Triangles with violations (sorted descending). */
  violationTriangles: Array<{ triangleIndex: number; deviationMm: number }>;
}

export function inspectAgainstSpec(
  scanned: MeshArrays,
  nominal: MeshArrays,
  toleranceMm: number,
  sampleCount: number = 2000,
  seed?: number,
): InspectionResult {
  const samples = sampleMeshSurface(scanned, sampleCount, seed);
  const violations: Array<{ triangleIndex: number; deviationMm: number }> = [];
  let worst = 0;
  for (let i = 0; i < samples.points.length; i++) {
    const d = pointToMeshDistance(samples.points[i]!, nominal);
    if (d > toleranceMm) {
      violations.push({ triangleIndex: samples.triangleIds[i]!, deviationMm: d });
    }
    if (d > worst) worst = d;
  }
  violations.sort((a, b) => b.deviationMm - a.deviationMm);
  return {
    passed: worst <= toleranceMm,
    worstViolationMm: worst - toleranceMm,
    violationTriangles: violations,
  };
}

// ── Deterministic RNG ───────────────────────────────────────────

function makeRng(seed?: number): () => number {
  let s = seed ?? Math.floor(Math.random() * 2 ** 31);
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
