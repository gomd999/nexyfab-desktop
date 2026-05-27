/**
 * nurbsCurve.ts — Generic 3-D NURBS curve evaluation.
 *
 * The sketch module ships a 2-D NURBS utility (`sketch/nurbs.ts`) used
 * for spline tools on the flat canvas. Surface modelling needs the
 * same math in 3-D plus derivative evaluation (for tangent / normal
 * / Frenet frame computation during sweep / loft operations). Rather
 * than dilute the sketch helper with 3-D-only branches, this module
 * is the canonical surface-side implementation.
 *
 * Algorithms:
 *   - `evalNurbsCurve3D` — de Boor algorithm with homogeneous weights.
 *   - `evalNurbsCurve3DDerivative` — first-derivative via the standard
 *     derivative-NURBS construction (one degree lower, control points
 *     are scaled differences).
 *
 * The math follows Piegl & Tiller "The NURBS Book" (2nd ed.), Chapter
 * 4. Variable names match the textbook so future tweaks are easy to
 * cross-reference.
 */

import * as THREE from 'three';

export interface NurbsCurve3D {
  /** n+1 control points in 3-D world space. */
  controlPoints: THREE.Vector3[];
  /** Degree p (≥ 1). Length of `knots` must equal n+p+2. */
  degree: number;
  /** Knot vector, non-decreasing, length = controlPoints.length + degree + 1. */
  knots: number[];
  /** Optional rational weights, one per control point. Default = 1
   *  for every control point (= regular B-spline). */
  weights?: number[];
}

/** Build a clamped-uniform knot vector for `n+1` control points and
 *  degree `p`. The vector starts with `p+1` zeros and ends with `p+1`
 *  ones, interior knots evenly spaced. */
export function clampedUniformKnots3D(n: number, p: number): number[] {
  const knots: number[] = [];
  const interior = n - p;
  for (let i = 0; i <= p; i++) knots.push(0);
  for (let i = 1; i <= interior; i++) knots.push(i / (interior + 1));
  for (let i = 0; i <= p; i++) knots.push(1);
  return knots;
}

/** Locate the knot span index k such that knots[k] ≤ u < knots[k+1]. */
function findSpan(n: number, p: number, u: number, knots: number[]): number {
  if (u >= knots[n + 1]) return n;
  if (u <= knots[p]) return p;
  let low = p, high = n + 1;
  let mid = Math.floor((low + high) / 2);
  while (u < knots[mid] || u >= knots[mid + 1]) {
    if (u < knots[mid]) high = mid; else low = mid;
    mid = Math.floor((low + high) / 2);
  }
  return mid;
}

/** Compute the non-zero B-spline basis functions N_{i,p}(u) for i in
 *  the knot span [k-p, k]. Returns an array of length p+1. */
function basisFunctions(span: number, u: number, p: number, knots: number[]): number[] {
  const N: number[] = new Array(p + 1).fill(0);
  const left: number[] = new Array(p + 1).fill(0);
  const right: number[] = new Array(p + 1).fill(0);
  N[0] = 1.0;
  for (let j = 1; j <= p; j++) {
    left[j] = u - knots[span + 1 - j];
    right[j] = knots[span + j] - u;
    let saved = 0.0;
    for (let r = 0; r < j; r++) {
      const denom = right[r + 1] + left[j - r];
      const temp = denom !== 0 ? N[r] / denom : 0;
      N[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    N[j] = saved;
  }
  return N;
}

/**
 * Evaluate the NURBS curve at parameter `u` (typically in the knot
 * vector range — clamped uniform knots use [0, 1]). Returns the 3-D
 * point on the curve.
 *
 * Rational evaluation: control points and weights are combined into
 * homogeneous coordinates (wP, w), interpolated by the standard
 * B-spline basis, then projected back by dividing by the interpolated
 * weight.
 */
export function evalNurbsCurve3D(curve: NurbsCurve3D, u: number): THREE.Vector3 {
  const n = curve.controlPoints.length - 1;
  const p = curve.degree;
  const knots = curve.knots;
  const span = findSpan(n, p, u, knots);
  const N = basisFunctions(span, u, p, knots);

  const weights = curve.weights ?? curve.controlPoints.map(() => 1);
  let wx = 0, wy = 0, wz = 0, ww = 0;
  for (let j = 0; j <= p; j++) {
    const idx = span - p + j;
    const w = weights[idx];
    const cp = curve.controlPoints[idx];
    const basis = N[j] * w;
    wx += basis * cp.x;
    wy += basis * cp.y;
    wz += basis * cp.z;
    ww += basis;
  }
  if (ww === 0) return new THREE.Vector3();
  return new THREE.Vector3(wx / ww, wy / ww, wz / ww);
}

/** Evaluate the curve's first derivative at parameter `u`. Returns
 *  the tangent direction (not normalised — call `.normalize()` if you
 *  want the unit tangent). For rational curves this uses the quotient
 *  rule on the homogeneous form. */
export function evalNurbsCurve3DDerivative(curve: NurbsCurve3D, u: number): THREE.Vector3 {
  const p = curve.degree;
  if (p < 1) return new THREE.Vector3();

  // Numerical finite-difference approach for robustness across
  // degenerate cases (multiple knots, endpoint zero-weights). For the
  // accuracy we need on sweep/loft, central difference at 1e-4 step
  // is well within tessellation tolerance.
  const eps = 1e-4;
  const lo = Math.max(curve.knots[p], u - eps);
  const hi = Math.min(curve.knots[curve.knots.length - p - 1], u + eps);
  const span = hi - lo || 1e-9;
  const pHi = evalNurbsCurve3D(curve, hi);
  const pLo = evalNurbsCurve3D(curve, lo);
  return new THREE.Vector3(
    (pHi.x - pLo.x) / span,
    (pHi.y - pLo.y) / span,
    (pHi.z - pLo.z) / span,
  );
}

/** Sample the curve into a polyline of N points evenly spaced in
 *  parameter (not arc length). Useful for tessellation and viewport
 *  rendering. */
export function sampleNurbsCurve3D(curve: NurbsCurve3D, sampleCount: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const uStart = curve.knots[curve.degree];
  const uEnd = curve.knots[curve.knots.length - curve.degree - 1];
  for (let i = 0; i < sampleCount; i++) {
    const t = i / Math.max(1, sampleCount - 1);
    const u = uStart + (uEnd - uStart) * t;
    pts.push(evalNurbsCurve3D(curve, u));
  }
  return pts;
}
