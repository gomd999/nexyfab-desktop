/**
 * cmmPointCloudAlignICP.ts — Iterative Closest Point alignment of a
 * measured CMM point cloud onto a nominal CAD mesh.
 *
 * After a part is machined, the inspector probes hundreds-to-thousands
 * of points with a CMM. The first analysis step is to *register*
 * (align) those measured points to the design's coordinate frame.
 * Only then can you compute Hausdorff / GD&T deviations meaningfully.
 *
 * Standard solution: ICP — iterate (find nearest mesh point for each
 * source point) → (least-squares rigid transform) → (apply) until
 * convergence. Variants here:
 *
 *   - Point-to-point ICP (Besl & McKay, 1992): minimize sum of
 *     squared distances between matched pairs.
 *   - Trimmed ICP: discard the worst k% of pairs each iteration to
 *     resist outliers.
 *   - Convergence on rotation+translation delta.
 *
 * The rotation extraction uses the closed-form quaternion method
 * (Horn 1987) — robust against degenerate point distributions.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface Transform {
  /** 3x3 rotation matrix in row-major order. */
  rotation: number[];
  /** Translation vector. */
  translation: Vec3;
}

export interface ICPResult {
  /** Final rigid transform applied to the source cloud. */
  transform: Transform;
  /** Source points after transformation. */
  alignedPoints: Vec3[];
  /** Final mean squared distance. */
  finalRmsMm: number;
  /** Per-iteration RMS history. */
  rmsHistory: number[];
  /** Did the algorithm converge? */
  converged: boolean;
  /** Outlier indices that were trimmed away on the final iteration. */
  trimmedIndices: number[];
}

export interface ICPOptions {
  maxIterations: number;
  /** Stop when consecutive RMS deltas drop below this. */
  toleranceMm: number;
  /** Fraction of worst-distance pairs to discard each iteration. 0 = no trimming. */
  trimFraction: number;
}

export const DEFAULT_OPTIONS: ICPOptions = {
  maxIterations: 50,
  toleranceMm: 1e-4,
  trimFraction: 0.1,
};

// ── Top-level entry ────────────────────────────────────────────

export function alignICP(
  source: Vec3[],
  target: Vec3[],
  options: Partial<ICPOptions> = {},
): ICPResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (source.length === 0 || target.length === 0) {
    return {
      transform: identityTransform(),
      alignedPoints: source.map(p => ({ ...p })),
      finalRmsMm: 0,
      rmsHistory: [],
      converged: false,
      trimmedIndices: [],
    };
  }

  let current = source.map(p => ({ ...p }));
  const cumulative = identityTransform();
  const history: number[] = [];
  let prevRms = Infinity;
  let lastTrimmed: number[] = [];
  let converged = false;

  for (let iter = 0; iter < opts.maxIterations; iter++) {
    const pairs = current.map((src, i) => {
      const idx = nearestPointIndex(src, target);
      const tgt = target[idx]!;
      const dist = distance(src, tgt);
      return { i, src, tgt, dist };
    });

    pairs.sort((a, b) => a.dist - b.dist);
    const keepCount = Math.max(3, Math.floor(pairs.length * (1 - opts.trimFraction)));
    const kept = pairs.slice(0, keepCount);
    lastTrimmed = pairs.slice(keepCount).map(p => p.i);

    const rms = Math.sqrt(kept.reduce((s, p) => s + p.dist * p.dist, 0) / Math.max(1, kept.length));
    history.push(rms);

    if (Math.abs(prevRms - rms) < opts.toleranceMm) {
      converged = true;
      break;
    }
    prevRms = rms;

    const sourceSet = kept.map(p => p.src);
    const targetSet = kept.map(p => p.tgt);
    const step = solveRigidTransform(sourceSet, targetSet);
    cumulative.rotation = matMul3(step.rotation, cumulative.rotation);
    cumulative.translation = addVec3(rotateVec3(step.rotation, cumulative.translation), step.translation);
    current = current.map(p => applyTransform(step, p));
  }

  return {
    transform: cumulative,
    alignedPoints: current,
    finalRmsMm: history[history.length - 1] ?? 0,
    rmsHistory: history,
    converged,
    trimmedIndices: lastTrimmed,
  };
}

// ── Horn closed-form rigid transform ───────────────────────────

export function solveRigidTransform(source: Vec3[], target: Vec3[]): Transform {
  const n = Math.min(source.length, target.length);
  if (n < 3) return identityTransform();
  const srcCentroid = centroid(source);
  const tgtCentroid = centroid(target);

  // Cross-covariance H.
  const H = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const sx = source[i]!.x - srcCentroid.x;
    const sy = source[i]!.y - srcCentroid.y;
    const sz = source[i]!.z - srcCentroid.z;
    const tx = target[i]!.x - tgtCentroid.x;
    const ty = target[i]!.y - tgtCentroid.y;
    const tz = target[i]!.z - tgtCentroid.z;
    H[0]! += sx * tx; H[1]! += sx * ty; H[2]! += sx * tz;
    H[3]! += sy * tx; H[4]! += sy * ty; H[5]! += sy * tz;
    H[6]! += sz * tx; H[7]! += sz * ty; H[8]! += sz * tz;
  }
  // Solve via 4x4 quaternion symmetric matrix (Horn).
  const N = [
    H[0]! + H[4]! + H[8]!,            H[5]! - H[7]!,                    H[6]! - H[2]!,                    H[1]! - H[3]!,
    H[5]! - H[7]!,                    H[0]! - H[4]! - H[8]!,            H[1]! + H[3]!,                    H[2]! + H[6]!,
    H[6]! - H[2]!,                    H[1]! + H[3]!,                    -H[0]! + H[4]! - H[8]!,           H[5]! + H[7]!,
    H[1]! - H[3]!,                    H[2]! + H[6]!,                    H[5]! + H[7]!,                    -H[0]! - H[4]! + H[8]!,
  ];
  const q = largestEigenvector4x4(N);
  const rot = quaternionToMatrix(q);
  const t: Vec3 = {
    x: tgtCentroid.x - (rot[0]! * srcCentroid.x + rot[1]! * srcCentroid.y + rot[2]! * srcCentroid.z),
    y: tgtCentroid.y - (rot[3]! * srcCentroid.x + rot[4]! * srcCentroid.y + rot[5]! * srcCentroid.z),
    z: tgtCentroid.z - (rot[6]! * srcCentroid.x + rot[7]! * srcCentroid.y + rot[8]! * srcCentroid.z),
  };
  return { rotation: rot, translation: t };
}

// Power iteration for largest eigenvector of a 4x4 symmetric matrix.
function largestEigenvector4x4(M: number[]): [number, number, number, number] {
  let v: [number, number, number, number] = [1, 0, 0, 0];
  for (let iter = 0; iter < 100; iter++) {
    const next: [number, number, number, number] = [
      M[0]! * v[0] + M[1]! * v[1] + M[2]! * v[2] + M[3]! * v[3],
      M[4]! * v[0] + M[5]! * v[1] + M[6]! * v[2] + M[7]! * v[3],
      M[8]! * v[0] + M[9]! * v[1] + M[10]! * v[2] + M[11]! * v[3],
      M[12]! * v[0] + M[13]! * v[1] + M[14]! * v[2] + M[15]! * v[3],
    ];
    const norm = Math.hypot(next[0], next[1], next[2], next[3]);
    if (norm < 1e-12) return [1, 0, 0, 0];
    v = [next[0] / norm, next[1] / norm, next[2] / norm, next[3] / norm];
  }
  return v;
}

function quaternionToMatrix(q: [number, number, number, number]): number[] {
  const [w, x, y, z] = q;
  return [
    1 - 2 * (y * y + z * z),     2 * (x * y - w * z),         2 * (x * z + w * y),
    2 * (x * y + w * z),         1 - 2 * (x * x + z * z),     2 * (y * z - w * x),
    2 * (x * z - w * y),         2 * (y * z + w * x),         1 - 2 * (x * x + y * y),
  ];
}

// ── Helpers ────────────────────────────────────────────────────

export function identityTransform(): Transform {
  return { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: { x: 0, y: 0, z: 0 } };
}

export function applyTransform(t: Transform, p: Vec3): Vec3 {
  return {
    x: t.rotation[0]! * p.x + t.rotation[1]! * p.y + t.rotation[2]! * p.z + t.translation.x,
    y: t.rotation[3]! * p.x + t.rotation[4]! * p.y + t.rotation[5]! * p.z + t.translation.y,
    z: t.rotation[6]! * p.x + t.rotation[7]! * p.y + t.rotation[8]! * p.z + t.translation.z,
  };
}

function centroid(pts: Vec3[]): Vec3 {
  let cx = 0, cy = 0, cz = 0;
  for (const p of pts) {
    cx += p.x; cy += p.y; cz += p.z;
  }
  return { x: cx / pts.length, y: cy / pts.length, z: cz / pts.length };
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function nearestPointIndex(p: Vec3, target: Vec3[]): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < target.length; i++) {
    const d = distance(p, target[i]!);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function matMul3(a: number[], b: number[]): number[] {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[c + 3]! + a[r * 3 + 2]! * b[c + 6]!;
    }
  }
  return out;
}

function rotateVec3(rot: number[], v: Vec3): Vec3 {
  return {
    x: rot[0]! * v.x + rot[1]! * v.y + rot[2]! * v.z,
    y: rot[3]! * v.x + rot[4]! * v.y + rot[5]! * v.z,
    z: rot[6]! * v.x + rot[7]! * v.y + rot[8]! * v.z,
  };
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

// ── Summary ────────────────────────────────────────────────────

export interface AlignSummary {
  iterationsRun: number;
  initialRms: number;
  finalRms: number;
  reductionFraction: number;
  converged: boolean;
  outlierCount: number;
}

export function summarize(result: ICPResult): AlignSummary {
  const initial = result.rmsHistory[0] ?? 0;
  const final = result.finalRmsMm;
  return {
    iterationsRun: result.rmsHistory.length,
    initialRms: initial,
    finalRms: final,
    reductionFraction: initial > 0 ? 1 - final / initial : 0,
    converged: result.converged,
    outlierCount: result.trimmedIndices.length,
  };
}
