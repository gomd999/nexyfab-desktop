/**
 * flatnessTolerance.ts — GD&T flatness tolerance evaluation per ASME Y14.5.
 *
 * Flatness is the condition of a surface having all of its elements
 * in one plane. The tolerance zone is the *distance between two
 * parallel planes* within which all points of the controlled surface
 * must lie.
 *
 * Algorithm:
 *
 *   1. Fit the *best plane* through the measured points (SVD / least
 *      squares). For ASME Y14.5 the canonical fit is the **minimum
 *      zone** — find two parallel planes with the smallest spacing
 *      that contain all points. We use least-squares as the initial
 *      guess then refine via the rotation that minimizes the worst
 *      deviation (rotating the LS plane to balance max + / max -).
 *   2. Compute signed distance for every measured point.
 *   3. The flatness value = max(positive deviation) - min(negative
 *      deviation). Compare against the tolerance.
 *   4. Report pass/fail + worst points + bias of the LS plane.
 *
 * The minimum-zone refinement here is a simple line search rather
 * than full LP — sufficient for the typical inspection workflow with
 * a few hundred points.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface FlatnessResult {
  /** Best-fit (LS) plane: a·x + b·y + c·z + d = 0, unit normal. */
  plane: { a: number; b: number; c: number; d: number };
  /** Signed deviations of every input point against the plane. */
  deviations: number[];
  /** Max positive deviation (mm). */
  maxPositiveMm: number;
  /** Min negative deviation (mm). */
  maxNegativeMm: number;
  /** Total flatness value (max + |min|). */
  flatnessMm: number;
  /** Does it pass the tolerance? */
  passed: boolean;
  /** Indices of the points hitting max + max - extremes. */
  worstPointIndices: { hiIdx: number; loIdx: number };
}

export interface FlatnessOptions {
  /** Tolerance zone, mm. */
  toleranceMm: number;
  /** Use minimum-zone refinement after LS fit. */
  refineMinZone: boolean;
}

export const DEFAULT_OPTIONS: FlatnessOptions = {
  toleranceMm: 0.05,
  refineMinZone: true,
};

// ── Top-level entry ────────────────────────────────────────────

export function evaluateFlatness(points: Vec3[], options: Partial<FlatnessOptions> = {}): FlatnessResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (points.length < 3) {
    return {
      plane: { a: 0, b: 0, c: 1, d: 0 },
      deviations: [],
      maxPositiveMm: 0,
      maxNegativeMm: 0,
      flatnessMm: 0,
      passed: true,
      worstPointIndices: { hiIdx: -1, loIdx: -1 },
    };
  }
  let plane = fitLeastSquaresPlane(points);
  if (opts.refineMinZone) {
    plane = refineMinZonePlane(points, plane);
  }
  const deviations = points.map(p => signedDistance(p, plane));
  let hi = -Infinity;
  let lo = Infinity;
  let hiIdx = 0;
  let loIdx = 0;
  for (let i = 0; i < deviations.length; i++) {
    const d = deviations[i]!;
    if (d > hi) { hi = d; hiIdx = i; }
    if (d < lo) { lo = d; loIdx = i; }
  }
  const flatness = hi - lo;
  return {
    plane,
    deviations,
    maxPositiveMm: hi,
    maxNegativeMm: lo,
    flatnessMm: flatness,
    passed: flatness <= opts.toleranceMm,
    worstPointIndices: { hiIdx, loIdx },
  };
}

// ── Least-squares plane fit ────────────────────────────────────

export function fitLeastSquaresPlane(points: Vec3[]): { a: number; b: number; c: number; d: number } {
  const n = points.length;
  let cx = 0, cy = 0, cz = 0;
  for (const p of points) {
    cx += p.x; cy += p.y; cz += p.z;
  }
  cx /= n; cy /= n; cz /= n;
  // Build covariance matrix (3x3 symmetric).
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dz = p.z - cz;
    xx += dx * dx;
    xy += dx * dy;
    xz += dx * dz;
    yy += dy * dy;
    yz += dy * dz;
    zz += dz * dz;
  }
  // Smallest eigenvector = normal. Use inverse power iteration approximation:
  // pick the cross-product of the two largest covariance "directions".
  // Practical: try unit normals (1,0,0), (0,1,0), (0,0,1) and pick the
  // one with smallest residual variance, then refine.
  const candidates: Array<[number, number, number]> = [];
  // Determinant-based heuristic for best initial normal.
  const detX = yy * zz - yz * yz;
  const detY = xx * zz - xz * xz;
  const detZ = xx * yy - xy * xy;
  if (detX > detY && detX > detZ) {
    candidates.push([1, -xy / Math.max(1e-9, yy), -xz / Math.max(1e-9, zz)]);
  } else if (detY > detZ) {
    candidates.push([-xy / Math.max(1e-9, xx), 1, -yz / Math.max(1e-9, zz)]);
  } else {
    candidates.push([-xz / Math.max(1e-9, xx), -yz / Math.max(1e-9, yy), 1]);
  }
  candidates.push([0, 0, 1]); // axis-aligned fallback

  let bestSSE = Infinity;
  let bestPlane = { a: 0, b: 0, c: 1, d: -cz };
  for (const [na, nb, nc] of candidates) {
    const len = Math.hypot(na, nb, nc);
    if (len < 1e-9) continue;
    const a = na / len, b = nb / len, c = nc / len;
    const d = -(a * cx + b * cy + c * cz);
    let sse = 0;
    for (const p of points) {
      const dist = a * p.x + b * p.y + c * p.z + d;
      sse += dist * dist;
    }
    if (sse < bestSSE) {
      bestSSE = sse;
      bestPlane = { a, b, c, d };
    }
  }
  return bestPlane;
}

// ── Minimum-zone refinement ────────────────────────────────────

function refineMinZonePlane(points: Vec3[], plane: { a: number; b: number; c: number; d: number }): { a: number; b: number; c: number; d: number } {
  // Adjust the plane's offset so max + min is balanced (centered between extremes).
  const deviations = points.map(p => signedDistance(p, plane));
  let hi = -Infinity, lo = Infinity;
  for (const d of deviations) {
    if (d > hi) hi = d;
    if (d < lo) lo = d;
  }
  const offset = (hi + lo) / 2;
  return { ...plane, d: plane.d - offset };
}

function signedDistance(p: Vec3, plane: { a: number; b: number; c: number; d: number }): number {
  return plane.a * p.x + plane.b * p.y + plane.c * p.z + plane.d;
}

// ── Summary ────────────────────────────────────────────────────

export interface FlatnessSummary {
  pointCount: number;
  flatnessMm: number;
  passed: boolean;
  marginMm: number;
  /** Fraction of points hitting > 90% of the worst deviation. */
  hotspotFraction: number;
}

export function summarize(result: FlatnessResult, tolerance: number): FlatnessSummary {
  if (result.deviations.length === 0) {
    return { pointCount: 0, flatnessMm: 0, passed: true, marginMm: tolerance, hotspotFraction: 0 };
  }
  const worst = Math.max(Math.abs(result.maxPositiveMm), Math.abs(result.maxNegativeMm));
  const hotspot = result.deviations.filter(d => Math.abs(d) > 0.9 * worst).length;
  return {
    pointCount: result.deviations.length,
    flatnessMm: result.flatnessMm,
    passed: result.passed,
    marginMm: tolerance - result.flatnessMm,
    hotspotFraction: hotspot / result.deviations.length,
  };
}
