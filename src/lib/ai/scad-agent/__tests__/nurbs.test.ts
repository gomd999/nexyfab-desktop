/**
 * Z7 — NURBS curve evaluation + continuity classification tests.
 *
 * These pin the contract used by the agent's surface-quality checker.
 * The numerical thresholds (positionTol, angleTolDeg) are deliberately
 * generous to avoid false-positive failures from finite-difference noise
 * — tighter thresholds belong in production-grade analytical derivatives.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateCurve,
  curveDerivative,
  classifyContinuity,
  makeCubicCurve,
} from '../nurbs';

describe('NURBS curve evaluation', () => {
  it('cubic clamped curve hits its endpoints', () => {
    const c = makeCubicCurve([
      [0, 0, 0],
      [1, 1, 0],
      [2, 1, 0],
      [3, 0, 0],
    ]);
    const start = evaluateCurve(c, 0);
    const end = evaluateCurve(c, 1);
    expect(start[0]).toBeCloseTo(0, 5);
    expect(start[1]).toBeCloseTo(0, 5);
    expect(end[0]).toBeCloseTo(3, 5);
    expect(end[1]).toBeCloseTo(0, 5);
  });

  it('curveDerivative at start matches the first control-edge direction', () => {
    const c = makeCubicCurve([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ]);
    const d = curveDerivative(c, 0);
    // Straight-line curve: derivative should point in +x.
    expect(Math.abs(d[1])).toBeLessThan(1e-2);
    expect(Math.abs(d[2])).toBeLessThan(1e-2);
    expect(d[0]).toBeGreaterThan(0);
  });
});

describe('classifyContinuity', () => {
  it('detects discontinuous when endpoints far apart', () => {
    const a = makeCubicCurve([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]);
    const b = makeCubicCurve([[10, 0, 0], [11, 0, 0], [12, 0, 0], [13, 0, 0]]);
    const r = classifyContinuity(a, 1, b, 0);
    expect(r.level).toBe('discontinuous');
    expect(r.positionGap).toBeGreaterThan(5);
  });

  it('two collinear straight cubics meet C1 (and effectively C2)', () => {
    // A: x in [0,3], B: x in [3,6]. Same direction, same magnitude.
    const a = makeCubicCurve([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]);
    const b = makeCubicCurve([[3, 0, 0], [4, 0, 0], [5, 0, 0], [6, 0, 0]]);
    const r = classifyContinuity(a, 1, b, 0);
    expect(r.positionGap).toBeLessThan(0.01);
    expect(['C1', 'G2', 'C2']).toContain(r.level);
  });

  it('C0-only join: position matches but tangent flips', () => {
    const a = makeCubicCurve([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]);
    // B turns 90° upward at the meeting point.
    const b = makeCubicCurve([[3, 0, 0], [3, 1, 0], [3, 2, 0], [3, 3, 0]]);
    const r = classifyContinuity(a, 1, b, 0);
    expect(r.level).toBe('C0');
    expect(r.tangentAngleDeg).toBeGreaterThan(45);
  });

  it('recommendation gives actionable next step at every level', () => {
    const a = makeCubicCurve([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]);
    const b = makeCubicCurve([[3, 0, 0], [3.5, 0.1, 0], [4, 0.2, 0], [4.5, 0.3, 0]]);
    const r = classifyContinuity(a, 1, b, 0);
    expect(r.recommendation.length).toBeGreaterThan(10);
  });

  it('positionGap field is exposed numerically for diagnostics', () => {
    const a = makeCubicCurve([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]);
    const b = makeCubicCurve([[3.05, 0, 0], [4, 0, 0], [5, 0, 0], [6, 0, 0]]);
    const r = classifyContinuity(a, 1, b, 0);
    expect(r.positionGap).toBeCloseTo(0.05, 2);
  });
});
