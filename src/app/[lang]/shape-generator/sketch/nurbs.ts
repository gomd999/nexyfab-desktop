/**
 * Non-Uniform Rational B-Spline (NURBS) utilities for 2D sketch curves.
 *
 * Implements de Boor's algorithm with rational weights. Supports arbitrary
 * degree, auto-generated clamped-uniform knot vectors, and sampling for
 * rendering/extrusion.
 */

import type { SketchPoint, SketchSegment } from './types';

/**
 * Generate a clamped uniform knot vector:
 *   [0, ..., 0,  1/(n-p+1), 2/(n-p+1), ..., (n-p)/(n-p+1),  1, ..., 1]
 *   (p+1 zeros and p+1 ones; interior evenly spaced)
 *
 * n = number of control points - 1
 * p = degree
 * knot count = n + p + 2
 */
export function clampedUniformKnots(n: number, p: number): number[] {
  const knots: number[] = [];
  const interior = n - p;
  for (let i = 0; i <= p; i++) knots.push(0);
  for (let i = 1; i <= interior; i++) knots.push(i / (interior + 1));
  for (let i = 0; i <= p; i++) knots.push(1);
  return knots;
}

/** Find the knot span index k such that knots[k] <= u < knots[k+1]. */
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

/**
 * Evaluate a NURBS curve at parameter u ∈ [0, 1] using de Boor's algorithm.
 * Returns the interpolated (x, y) point.
 */
export function evalNurbs(
  controlPoints: SketchPoint[],
  degree: number,
  knots: number[],
  weights: number[] | undefined,
  u: number,
): SketchPoint {
  const n = controlPoints.length - 1;
  const p = Math.max(1, Math.min(degree, n));
  const w = weights ?? controlPoints.map(() => 1);
  const span = findSpan(n, p, u, knots);

  // Working points in homogeneous coordinates (wx, wy, w)
  const dx: number[] = [];
  const dy: number[] = [];
  const dw: number[] = [];
  for (let j = 0; j <= p; j++) {
    const cpIdx = span - p + j;
    const wi = w[cpIdx];
    dx.push(controlPoints[cpIdx].x * wi);
    dy.push(controlPoints[cpIdx].y * wi);
    dw.push(wi);
  }

  // de Boor recursion in homogeneous space
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = span - p + j;
      const denom = knots[i + p - r + 1] - knots[i];
      const alpha = denom === 0 ? 0 : (u - knots[i]) / denom;
      dx[j] = (1 - alpha) * dx[j - 1] + alpha * dx[j];
      dy[j] = (1 - alpha) * dy[j - 1] + alpha * dy[j];
      dw[j] = (1 - alpha) * dw[j - 1] + alpha * dw[j];
    }
  }

  const wFinal = dw[p] || 1;
  return { x: dx[p] / wFinal, y: dy[p] / wFinal };
}

/** Sample a NURBS segment into a polyline of `samples+1` points. */
export function sampleNurbsSegment(seg: SketchSegment, samples = 32): SketchPoint[] {
  if (seg.type !== 'nurbs' || seg.points.length < 2) return seg.points.slice();
  const degree = Math.max(1, Math.min(seg.degree ?? 3, seg.points.length - 1));
  const n = seg.points.length - 1;
  const knots = seg.knots && seg.knots.length === n + degree + 2
    ? seg.knots
    : clampedUniformKnots(n, degree);
  const weights = seg.weights && seg.weights.length === seg.points.length ? seg.weights : undefined;

  const result: SketchPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    result.push(evalNurbs(seg.points, degree, knots, weights, u));
  }
  return result;
}

/**
 * Least-squares fit a NURBS curve through a set of target points.
 * Returns control points for a degree-p curve that approximates the targets.
 * Simplified implementation — good enough for sketch smoothing.
 */
export function fitNurbsThroughPoints(
  targets: SketchPoint[],
  degree = 3,
  nControls?: number,
): { controlPoints: SketchPoint[]; knots: number[]; degree: number } {
  const m = targets.length - 1;
  const nc = Math.max(degree + 1, Math.min(nControls ?? targets.length, targets.length));
  const n = nc - 1;
  const p = Math.max(1, Math.min(degree, n));

  // Chord-length parameterization
  const distances = [0];
  let total = 0;
  for (let i = 1; i <= m; i++) {
    const dx = targets[i].x - targets[i - 1].x;
    const dy = targets[i].y - targets[i - 1].y;
    const d = Math.hypot(dx, dy);
    total += d;
    distances.push(total);
  }
  const u = distances.map((d) => (total > 0 ? d / total : 0));

  // Knot vector (clamped uniform)
  const knots = clampedUniformKnots(n, p);

  // Simple approximation: place control points at targets sampled at equal parameter intervals
  const controlPoints: SketchPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Find target point nearest parameter t
    let nearestIdx = 0;
    let nearestDiff = Infinity;
    for (let j = 0; j <= m; j++) {
      const d = Math.abs(u[j] - t);
      if (d < nearestDiff) { nearestDiff = d; nearestIdx = j; }
    }
    controlPoints.push({ ...targets[nearestIdx] });
  }
  return { controlPoints, knots, degree: p };
}
