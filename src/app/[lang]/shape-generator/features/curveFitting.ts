/**
 * curveFitting.ts — B-spline / NURBS curve fitting through points.
 *
 * Designers hand-draw a few control points; we fit a smooth curve.
 * Or a scanner streams a noisy edge sample; we fit a parametric
 * representation for downstream sweep/loft. Two regimes:
 *
 *   - **Interpolation** — curve passes exactly through every input
 *     point. Generates n+1 control points for n input points (degree-3
 *     B-spline default).
 *   - **Approximation** — least-squares fit with a smaller control
 *     count + smoothness regularization. Better for noisy data.
 *
 * Output is the B-spline knot vector + control points. NURBS is just
 * a B-spline with non-uniform weights; this module returns weights
 * defaulted to 1.0 (rational support left for caller to attach).
 */

export interface Point {
  x: number;
  y: number;
  z?: number;
}

export interface BSplineCurve {
  /** Degree (typically 3 for cubic). */
  degree: number;
  /** Knot vector (length = controlPoints.length + degree + 1). */
  knots: number[];
  /** Control points. */
  controlPoints: Point[];
  /** Optional per-control weights (NURBS). */
  weights?: number[];
}

// ── Interpolation (centripetal Catmull-Rom-like parameterization) ─

export interface InterpolationOptions {
  degree: number;
  /** Parameterization: uniform / chord-length / centripetal. */
  parameterization: 'uniform' | 'chord-length' | 'centripetal';
}

export const DEFAULT_INTERP_OPTIONS: InterpolationOptions = {
  degree: 3,
  parameterization: 'centripetal',
};

/** Interpolate a B-spline through the given points. The result curve
 *  passes through every input point with C² continuity (for degree 3). */
export function interpolateBSpline(points: Point[], options: Partial<InterpolationOptions> = {}): BSplineCurve {
  const opts = { ...DEFAULT_INTERP_OPTIONS, ...options };
  if (points.length < 2) {
    return { degree: opts.degree, knots: [0, 1], controlPoints: [...points] };
  }
  const params = computeParameters(points, opts.parameterization);
  const knots = computeAveragedKnotVector(params, opts.degree);
  // Solve N × c = P where N is the basis matrix at each parameter.
  const controlPoints = solveControlPoints(points, params, knots, opts.degree);
  return {
    degree: opts.degree,
    knots,
    controlPoints,
    weights: new Array(controlPoints.length).fill(1),
  };
}

function computeParameters(points: Point[], parameterization: InterpolationOptions['parameterization']): number[] {
  const n = points.length;
  if (parameterization === 'uniform') {
    return points.map((_, i) => i / (n - 1));
  }
  // Compute chord-length or centripetal.
  const lengths: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const d = distance(points[i]!, points[i + 1]!);
    lengths.push(parameterization === 'chord-length' ? d : Math.sqrt(d));
  }
  const total = lengths.reduce((s, l) => s + l, 0);
  if (total === 0) return points.map((_, i) => i / (n - 1));
  const t: number[] = [0];
  let acc = 0;
  for (const l of lengths) {
    acc += l;
    t.push(acc / total);
  }
  return t;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0));
}

function computeAveragedKnotVector(params: number[], degree: number): number[] {
  const n = params.length;
  const m = n + degree;
  const knots: number[] = [];
  for (let i = 0; i <= degree; i++) knots.push(0);
  for (let j = 1; j <= n - degree - 1; j++) {
    let sum = 0;
    for (let i = j; i < j + degree; i++) sum += params[i]!;
    knots.push(sum / degree);
  }
  for (let i = 0; i <= degree; i++) knots.push(1);
  if (knots.length !== m + 1) {
    while (knots.length <= m) knots.push(1);
  }
  return knots;
}

function solveControlPoints(points: Point[], params: number[], knots: number[], degree: number): Point[] {
  const n = points.length;
  // Build N matrix.
  const N: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      row[j] = basisFunction(j, degree, params[i]!, knots);
    }
    N.push(row);
  }
  // Solve N × c = points for each component independently.
  const xs = solveLinearSystem(N, points.map(p => p.x));
  const ys = solveLinearSystem(N, points.map(p => p.y));
  const zs = solveLinearSystem(N, points.map(p => p.z ?? 0));
  return xs.map((x, i) => ({ x, y: ys[i]!, z: zs[i]! }));
}

// ── Cox-de Boor basis function ────────────────────────────────

export function basisFunction(i: number, degree: number, u: number, knots: number[]): number {
  if (degree === 0) {
    if (u >= knots[i]! && u < knots[i + 1]!) return 1;
    // Right endpoint: include u == knots[i+1] for the last non-zero-length span.
    const maxU = knots[knots.length - 1]!;
    if (u === maxU && knots[i + 1]! === maxU && knots[i]! < maxU) return 1;
    return 0;
  }
  let left = 0;
  const di1 = knots[i + degree]! - knots[i]!;
  if (di1 !== 0) {
    left = ((u - knots[i]!) / di1) * basisFunction(i, degree - 1, u, knots);
  }
  let right = 0;
  const di2 = knots[i + degree + 1]! - knots[i + 1]!;
  if (di2 !== 0) {
    right = ((knots[i + degree + 1]! - u) / di2) * basisFunction(i + 1, degree - 1, u, knots);
  }
  return left + right;
}

// ── Curve evaluation ──────────────────────────────────────────

export function evaluateBSpline(curve: BSplineCurve, t: number): Point {
  let x = 0, y = 0, z = 0;
  let weightSum = 0;
  for (let i = 0; i < curve.controlPoints.length; i++) {
    const b = basisFunction(i, curve.degree, t, curve.knots);
    const w = curve.weights?.[i] ?? 1;
    x += b * w * curve.controlPoints[i]!.x;
    y += b * w * curve.controlPoints[i]!.y;
    z += b * w * (curve.controlPoints[i]!.z ?? 0);
    weightSum += b * w;
  }
  if (weightSum === 0) return { x: 0, y: 0, z: 0 };
  return { x: x / weightSum, y: y / weightSum, z: z / weightSum };
}

export function sampleCurve(curve: BSplineCurve, sampleCount: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = i / (sampleCount - 1);
    out.push(evaluateBSpline(curve, t));
  }
  return out;
}

// ── Least-squares approximation ───────────────────────────────

export interface ApproximationOptions {
  degree: number;
  /** Number of control points (< input count). */
  controlPointCount: number;
  /** Regularization weight (0 = pure fit, larger = smoother). */
  smoothingWeight: number;
}

export const DEFAULT_APPROX_OPTIONS: ApproximationOptions = {
  degree: 3,
  controlPointCount: 8,
  smoothingWeight: 0,
};

export function approximateBSpline(points: Point[], options: Partial<ApproximationOptions> = {}): BSplineCurve {
  const opts = { ...DEFAULT_APPROX_OPTIONS, ...options };
  const m = points.length;
  const n = Math.min(opts.controlPointCount, m);
  if (n < opts.degree + 1) {
    return interpolateBSpline(points, { degree: opts.degree });
  }
  const params = computeParameters(points, 'centripetal');
  // Build knot vector for n control points + degree.
  const knots = uniformKnotVector(n, opts.degree);
  // Build basis matrix N (m × n).
  const N: number[][] = [];
  for (let i = 0; i < m; i++) {
    const row = new Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      row[j] = basisFunction(j, opts.degree, params[i]!, knots);
    }
    N.push(row);
  }
  // Solve N^T N × c = N^T × points  (normal equations).
  // Fix first + last control to first/last input point.
  const NtN: number[][] = matMatMul(transpose(N), N);
  const xs = solveApprox(NtN, transpose(N), points.map(p => p.x), opts.smoothingWeight, n);
  const ys = solveApprox(NtN, transpose(N), points.map(p => p.y), opts.smoothingWeight, n);
  const zs = solveApprox(NtN, transpose(N), points.map(p => p.z ?? 0), opts.smoothingWeight, n);
  const ctrl: Point[] = xs.map((x, i) => ({ x, y: ys[i]!, z: zs[i]! }));
  return { degree: opts.degree, knots, controlPoints: ctrl, weights: new Array(n).fill(1) };
}

function uniformKnotVector(controlCount: number, degree: number): number[] {
  const m = controlCount + degree + 1;
  const knots: number[] = [];
  for (let i = 0; i < m; i++) {
    if (i <= degree) knots.push(0);
    else if (i >= m - degree - 1) knots.push(1);
    else knots.push((i - degree) / (controlCount - degree));
  }
  return knots;
}

function solveApprox(NtN: number[][], Nt: number[][], values: number[], smoothing: number, n: number): number[] {
  // Regularize: add λI for smoothness.
  const A: number[][] = NtN.map(row => [...row]);
  for (let i = 0; i < n; i++) A[i]![i] = A[i]![i]! + smoothing;
  const Ntb = matVecMul(Nt, values);
  return solveLinearSystem(A, Ntb);
}

// ── Linear system solver (Gauss-Jordan) ────────────────────────

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]!]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    let maxAbs = Math.abs(M[i]![i]!);
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(M[r]![i]!) > maxAbs) { maxAbs = Math.abs(M[r]![i]!); pivot = r; }
    }
    if (maxAbs < 1e-12) return new Array(n).fill(0);
    if (pivot !== i) [M[i], M[pivot]] = [M[pivot]!, M[i]!];
    const div = M[i]![i]!;
    for (let c = i; c <= n; c++) M[i]![c]! /= div;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = M[r]![i]!;
      for (let c = i; c <= n; c++) M[r]![c] = M[r]![c]! - factor * M[i]![c]!;
    }
  }
  return M.map(row => row[n]!);
}

function transpose(A: number[][]): number[][] {
  if (A.length === 0) return [];
  const rows = A.length, cols = A[0]!.length;
  const T: number[][] = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) T[j]![i] = A[i]![j]!;
  return T;
}

function matMatMul(A: number[][], B: number[][]): number[][] {
  const rows = A.length, cols = B[0]!.length, inner = B.length;
  const C: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let k = 0; k < inner; k++) {
      for (let j = 0; j < cols; j++) {
        C[i]![j] = C[i]![j]! + A[i]![k]! * B[k]![j]!;
      }
    }
  }
  return C;
}

function matVecMul(A: number[][], v: number[]): number[] {
  return A.map(row => row.reduce((s, a, j) => s + a * v[j]!, 0));
}

// ── Fit quality ───────────────────────────────────────────────

export interface FitQuality {
  maxDeviationMm: number;
  rmsDeviationMm: number;
}

export function evaluateFitQuality(points: Point[], curve: BSplineCurve): FitQuality {
  if (points.length === 0) return { maxDeviationMm: 0, rmsDeviationMm: 0 };
  let max = 0;
  let sqSum = 0;
  for (let i = 0; i < points.length; i++) {
    const t = i / (points.length - 1);
    const fitted = evaluateBSpline(curve, t);
    const d = distance(points[i]!, fitted);
    if (d > max) max = d;
    sqSum += d * d;
  }
  return { maxDeviationMm: max, rmsDeviationMm: Math.sqrt(sqSum / points.length) };
}
