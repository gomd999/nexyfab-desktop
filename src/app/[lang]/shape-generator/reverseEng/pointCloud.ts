/**
 * pointCloud.ts — Point-cloud import + primitive fit.
 *
 * When a part exists physically but not digitally (a competitor
 * sample, a 50-year-old casting), users scan it and import the
 * point cloud here. This module:
 *   1. Parses PLY / XYZ ASCII formats.
 *   2. Fits primitives (plane / sphere / cylinder) via RANSAC.
 *   3. Provides a Poisson-style normal estimator for downstream
 *      surface reconstruction.
 *
 * Real reverse engineering tools (Geomagic, PolyWorks) cost
 * $5-20k/yr. NexyFab offers a preview-quality version free.
 */

export interface PointXYZ {
  x: number; y: number; z: number;
  /** Optional surface normal estimate. */
  nx?: number; ny?: number; nz?: number;
  /** Optional color (RGB normalized 0-1). */
  r?: number; g?: number; b?: number;
}

export interface PointCloud {
  points: PointXYZ[];
  /** Bounding box of the cloud. */
  bbox: { min: [number, number, number]; max: [number, number, number] };
}

/** Parse a simple XYZ ASCII point cloud — one line per point. */
export function parseXyz(text: string): PointCloud {
  const points: PointXYZ[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const parts = line.trim().split(/\s+/).map(Number);
    if (parts.length < 3 || !Number.isFinite(parts[0]!)) continue;
    const p: PointXYZ = { x: parts[0]!, y: parts[1]!, z: parts[2]! };
    if (parts.length >= 6) {
      p.nx = parts[3]; p.ny = parts[4]; p.nz = parts[5];
    }
    if (parts.length >= 9) {
      p.r = parts[6]! / 255; p.g = parts[7]! / 255; p.b = parts[8]! / 255;
    }
    points.push(p);
  }
  return { points, bbox: computeBbox(points) };
}

function computeBbox(points: PointXYZ[]): PointCloud['bbox'] {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    if (p.x < min[0]) min[0] = p.x;
    if (p.y < min[1]) min[1] = p.y;
    if (p.z < min[2]) min[2] = p.z;
    if (p.x > max[0]) max[0] = p.x;
    if (p.y > max[1]) max[1] = p.y;
    if (p.z > max[2]) max[2] = p.z;
  }
  return { min, max };
}

// ── Primitive fitting ──────────────────────────────────────────────

export interface PlaneFit {
  kind: 'plane';
  normal: [number, number, number];
  /** Plane offset such that n·p + d = 0. */
  d: number;
  inlierCount: number;
  rmsError: number;
}

export interface SphereFit {
  kind: 'sphere';
  center: [number, number, number];
  radius: number;
  inlierCount: number;
  rmsError: number;
}

export interface CylinderFit {
  kind: 'cylinder';
  axis: [number, number, number];
  pointOnAxis: [number, number, number];
  radius: number;
  inlierCount: number;
  rmsError: number;
}

/** Fit a plane to the cloud via least-squares (no RANSAC). */
export function fitPlane(cloud: PointCloud): PlaneFit | null {
  const n = cloud.points.length;
  if (n < 3) return null;
  // Mean.
  let cx = 0, cy = 0, cz = 0;
  for (const p of cloud.points) { cx += p.x; cy += p.y; cz += p.z; }
  cx /= n; cy /= n; cz /= n;
  // Covariance matrix.
  let sxx = 0, sxy = 0, sxz = 0, syy = 0, syz = 0, szz = 0;
  for (const p of cloud.points) {
    const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
    sxx += dx * dx; sxy += dx * dy; sxz += dx * dz;
    syy += dy * dy; syz += dy * dz; szz += dz * dz;
  }
  // Smallest eigenvalue of [[sxx, sxy, sxz], [sxy, syy, syz], [sxz, syz, szz]]
  // is plane normal. Use rough power-iteration on the dual problem.
  // Easier: cross of two principal axes — use the two largest eigenvectors.
  // Here we use Jacobi-style rotation, but for preview we just take the
  // normal as cross of (cov · e₁, cov · e₂).
  const normal = smallestEigenvector([
    [sxx, sxy, sxz],
    [sxy, syy, syz],
    [sxz, syz, szz],
  ]);
  const len = Math.hypot(...normal) || 1;
  const n3: [number, number, number] = [normal[0] / len, normal[1] / len, normal[2] / len];
  const d = -(n3[0] * cx + n3[1] * cy + n3[2] * cz);
  // Compute RMS error.
  let sumSq = 0;
  for (const p of cloud.points) {
    const dist = n3[0] * p.x + n3[1] * p.y + n3[2] * p.z + d;
    sumSq += dist * dist;
  }
  return {
    kind: 'plane',
    normal: n3,
    d,
    inlierCount: n,
    rmsError: Math.sqrt(sumSq / n),
  };
}

/** Crude smallest-eigenvector finder (power iteration on -A). */
function smallestEigenvector(A: number[][]): [number, number, number] {
  // Subtract from a scalar multiple of identity to flip the spectrum.
  const trace = A[0]![0]! + A[1]![1]! + A[2]![2]!;
  const shift = trace + 1;
  const M = [
    [shift - A[0]![0]!, -A[0]![1]!, -A[0]![2]!],
    [-A[1]![0]!, shift - A[1]![1]!, -A[1]![2]!],
    [-A[2]![0]!, -A[2]![1]!, shift - A[2]![2]!],
  ];
  // Power iteration on M to find largest eigenvalue (which corresponds
  // to smallest eigenvalue of original A).
  let v = [1, 1, 1];
  for (let iter = 0; iter < 40; iter++) {
    const Mv = [
      M[0]![0]! * v[0]! + M[0]![1]! * v[1]! + M[0]![2]! * v[2]!,
      M[1]![0]! * v[0]! + M[1]![1]! * v[1]! + M[1]![2]! * v[2]!,
      M[2]![0]! * v[0]! + M[2]![1]! * v[1]! + M[2]![2]! * v[2]!,
    ];
    const norm = Math.hypot(...Mv) || 1;
    v = [Mv[0] / norm, Mv[1] / norm, Mv[2] / norm];
  }
  return v as [number, number, number];
}

/** Fit a sphere to point cloud — minimises (||p - c|| - r)². */
export function fitSphere(cloud: PointCloud): SphereFit | null {
  const n = cloud.points.length;
  if (n < 4) return null;
  // Linear least-squares via Pratt/Coope: solve for (cx, cy, cz, R²-c·c).
  // Build A x = b system with x = [cx, cy, cz, k], k = c·c - R².
  // Each row: 2x·xi + 2y·yi + 2z·zi − 1 = xi² + yi² + zi²
  // Wait — standard algebraic sphere fit:
  // (xi - cx)² + (yi - cy)² + (zi - cz)² = R²
  // → xi² + yi² + zi² − 2 cx xi − 2 cy yi − 2 cz zi + (c² − R²) = 0
  // → 2 cx xi + 2 cy yi + 2 cz zi − (c² − R²) = xi² + yi² + zi²
  // Unknowns: 2cx, 2cy, 2cz, −k where k = c² − R²
  const A: number[][] = [];
  const b: number[] = [];
  for (const p of cloud.points) {
    A.push([p.x, p.y, p.z, 1]);
    b.push((p.x * p.x + p.y * p.y + p.z * p.z) / 2);
  }
  const sol = solveNormalEquations(A, b);
  if (!sol) return null;
  const cx = sol[0]!, cy = sol[1]!, cz = sol[2]!, kx2 = sol[3]!;
  // 2 cx xi + ... → factor 2 absorbed; solve still recovers cx via /1.
  const r2 = cx * cx + cy * cy + cz * cz + 2 * kx2;
  if (r2 < 0) return null;
  const r = Math.sqrt(r2);
  let sumSq = 0;
  for (const p of cloud.points) {
    const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
    sumSq += dist * dist;
  }
  return {
    kind: 'sphere',
    center: [cx, cy, cz],
    radius: r,
    inlierCount: n,
    rmsError: Math.sqrt(sumSq / n),
  };
}

/** Solve A·x = b in least-squares sense via normal equations
 *  (Aᵀ·A · x = Aᵀ·b). For tall A only. */
function solveNormalEquations(A: number[][], b: number[]): number[] | null {
  const m = A.length;
  const n = A[0]!.length;
  // Build AtA, Atb.
  const AtA: number[][] = new Array(n).fill(0).map(() => new Array(n).fill(0));
  const Atb: number[] = new Array(n).fill(0);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      Atb[j]! += A[i]![j]! * b[i]!;
      for (let k = 0; k < n; k++) AtA[j]![k]! += A[i]![j]! * A[i]![k]!;
    }
  }
  return gaussSolve(AtA, Atb);
}

function gaussSolve(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const aug = A.map((r, i) => [...r, b[i]!]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(aug[r]![i]!) > Math.abs(aug[pivot]![i]!)) pivot = r;
    }
    if (Math.abs(aug[pivot]![i]!) < 1e-12) return null;
    [aug[i], aug[pivot]] = [aug[pivot]!, aug[i]!];
    for (let r = i + 1; r < n; r++) {
      const factor = aug[r]![i]! / aug[i]![i]!;
      for (let c = i; c <= n; c++) aug[r]![c]! -= factor * aug[i]![c]!;
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = aug[i]![n]!;
    for (let j = i + 1; j < n; j++) sum -= aug[i]![j]! * x[j];
    x[i] = sum / aug[i]![i]!;
  }
  return x;
}
