/**
 * sketch3dConstraints.ts — Constraint solver for 3D sketches.
 *
 * 3D constraint solving is harder than 2D — 6 DOFs per point
 * instead of 2 (or 3 with rotation). NexyFab uses a simple
 * gradient-descent solver: define a scalar error for each
 * constraint, sum into a global error, and walk downhill by
 * adjusting point positions.
 *
 * Constraints implemented:
 *   - distance (point-point or line length)
 *   - parallel (two lines)
 *   - perpendicular (two lines)
 *   - coincident (two points)
 *   - on-axis (point on world X/Y/Z axis)
 *   - fixed-coord (lock x / y / z)
 *
 * Convergence: monitor total error norm; stop when below threshold
 * or after maxIters. Real 2D solvers use Newton + symbolic Jacobian
 * but pure gradient descent is good enough for typical 3D sketch
 * sizes (< 50 entities).
 */

import { getPoint, isLine, type Sketch3D, type Point3D } from './sketch3dEntity';

export type Sketch3DConstraint =
  | { kind: 'distance';      pointA: string; pointB: string; targetMm: number }
  | { kind: 'parallel';      lineA: string;  lineB: string }
  | { kind: 'perpendicular'; lineA: string;  lineB: string }
  | { kind: 'coincident';    pointA: string; pointB: string }
  | { kind: 'on-axis';       point: string;  axis: 'x' | 'y' | 'z' }
  | { kind: 'fixed-coord';   point: string;  axis: 'x' | 'y' | 'z'; value: number };

export interface SolveResult {
  iterations: number;
  finalError: number;
  converged: boolean;
}

const DEFAULT_TOL = 1e-4;
const DEFAULT_MAX_ITERS = 200;
const STEP = 0.05;

function constraintError(s: Sketch3D, c: Sketch3DConstraint): number {
  switch (c.kind) {
    case 'distance': {
      const a = getPoint(s, c.pointA);
      const b = getPoint(s, c.pointB);
      if (!a || !b) return 0;
      const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      return d - c.targetMm;
    }
    case 'coincident': {
      const a = getPoint(s, c.pointA);
      const b = getPoint(s, c.pointB);
      if (!a || !b) return 0;
      return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    case 'parallel': {
      const dA = lineDirection(s, c.lineA);
      const dB = lineDirection(s, c.lineB);
      if (!dA || !dB) return 0;
      // Error = sin angle between them = |cross| / (|A| |B|)
      const cross = [
        dA[1] * dB[2] - dA[2] * dB[1],
        dA[2] * dB[0] - dA[0] * dB[2],
        dA[0] * dB[1] - dA[1] * dB[0],
      ];
      return Math.hypot(...cross);
    }
    case 'perpendicular': {
      const dA = lineDirection(s, c.lineA);
      const dB = lineDirection(s, c.lineB);
      if (!dA || !dB) return 0;
      return dA[0] * dB[0] + dA[1] * dB[1] + dA[2] * dB[2];
    }
    case 'on-axis': {
      const p = getPoint(s, c.point);
      if (!p) return 0;
      switch (c.axis) {
        case 'x': return Math.hypot(p.y, p.z);
        case 'y': return Math.hypot(p.x, p.z);
        case 'z': return Math.hypot(p.x, p.y);
      }
      break;
    }
    case 'fixed-coord': {
      const p = getPoint(s, c.point);
      if (!p) return 0;
      return p[c.axis] - c.value;
    }
  }
  return 0;
}

function lineDirection(s: Sketch3D, lineId: string): [number, number, number] | null {
  const e = s.entities.get(lineId);
  if (!e || !isLine(e)) return null;
  const a = getPoint(s, e.startId);
  const b = getPoint(s, e.endId);
  if (!a || !b) return null;
  return [b.x - a.x, b.y - a.y, b.z - a.z];
}

function totalError(s: Sketch3D, cs: Sketch3DConstraint[]): number {
  let sum = 0;
  for (const c of cs) {
    const e = constraintError(s, c);
    sum += e * e;
  }
  return Math.sqrt(sum);
}

/** Solve via numerical gradient descent. */
export function solveSketch3D(
  sketch: Sketch3D,
  constraints: Sketch3DConstraint[],
  opts: { tol?: number; maxIters?: number; step?: number } = {},
): SolveResult {
  const tol = opts.tol ?? DEFAULT_TOL;
  const maxIters = opts.maxIters ?? DEFAULT_MAX_ITERS;
  const step = opts.step ?? STEP;
  const epsilon = 1e-5;

  const movablePoints: Point3D[] = [];
  for (const e of sketch.entities.values()) {
    if ('x' in e && 'y' in e && 'z' in e && !e.fixed) movablePoints.push(e as Point3D);
  }

  let lastError = totalError(sketch, constraints);
  let iter = 0;
  for (; iter < maxIters; iter++) {
    if (lastError < tol) break;
    // Numerical gradient: nudge each coord, observe error change.
    for (const p of movablePoints) {
      for (const axis of ['x', 'y', 'z'] as const) {
        const before = p[axis];
        p[axis] = before + epsilon;
        const fwd = totalError(sketch, constraints);
        p[axis] = before - epsilon;
        const bwd = totalError(sketch, constraints);
        p[axis] = before;
        const grad = (fwd - bwd) / (2 * epsilon);
        p[axis] -= step * grad;
      }
    }
    lastError = totalError(sketch, constraints);
  }

  return {
    iterations: iter,
    finalError: lastError,
    converged: lastError < tol,
  };
}
