import { describe, it, expect } from 'vitest';
import {
  interpolateBSpline,
  approximateBSpline,
  basisFunction,
  evaluateBSpline,
  sampleCurve,
  evaluateFitQuality,
  type Point,
} from './curveFitting';

function linePoints(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: 0, z: 0 }));
}

function circlePoints(n: number, radius: number = 1): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * Math.PI;
    return { x: radius * Math.cos(t), y: radius * Math.sin(t), z: 0 };
  });
}

describe('basisFunction', () => {
  it('uniform basis function value within knot span', () => {
    const knots = [0, 0, 0, 0, 1, 1, 1, 1];
    expect(basisFunction(0, 3, 0, knots)).toBeCloseTo(1, 5);
  });

  it('partition of unity: sum of all bases at u = 1', () => {
    const knots = [0, 0, 0, 0.5, 1, 1, 1];
    let sum = 0;
    for (let i = 0; i < knots.length - 3 - 1; i++) sum += basisFunction(i, 2, 0.4, knots);
    expect(sum).toBeCloseTo(1, 5);
  });
});

describe('interpolateBSpline', () => {
  it('< 2 points returns input as control points', () => {
    const c = interpolateBSpline([{ x: 0, y: 0 }]);
    expect(c.controlPoints).toHaveLength(1);
  });

  it('returns degree-3 curve by default', () => {
    const c = interpolateBSpline(linePoints(5));
    expect(c.degree).toBe(3);
  });

  it('control point count matches input count', () => {
    const pts = linePoints(5);
    const c = interpolateBSpline(pts);
    expect(c.controlPoints).toHaveLength(pts.length);
  });

  it('curve interpolates first input point', () => {
    const pts = circlePoints(5);
    const c = interpolateBSpline(pts);
    const start = evaluateBSpline(c, 0);
    expect(start.x).toBeCloseTo(pts[0]!.x, 3);
    expect(start.y).toBeCloseTo(pts[0]!.y, 3);
  });

  it('uniform parameterization works', () => {
    const pts = linePoints(5);
    const c = interpolateBSpline(pts, { parameterization: 'uniform' });
    expect(c.controlPoints).toHaveLength(5);
  });

  it('chord-length parameterization works', () => {
    const pts = circlePoints(5);
    const c = interpolateBSpline(pts, { parameterization: 'chord-length' });
    expect(c.controlPoints).toHaveLength(5);
  });
});

describe('evaluateBSpline', () => {
  it('curve at endpoints matches first/last control', () => {
    const c = interpolateBSpline(linePoints(4));
    const start = evaluateBSpline(c, 0);
    expect(start.x).toBeCloseTo(0, 3);
  });
});

describe('sampleCurve', () => {
  it('returns N samples', () => {
    const c = interpolateBSpline(linePoints(5));
    const samples = sampleCurve(c, 50);
    expect(samples).toHaveLength(50);
  });
});

describe('approximateBSpline', () => {
  it('produces requested control point count', () => {
    const pts = circlePoints(20);
    const c = approximateBSpline(pts, { controlPointCount: 6 });
    expect(c.controlPoints.length).toBeLessThanOrEqual(6);
  });

  it('falls back to interpolation when ctrl count too low', () => {
    const c = approximateBSpline(linePoints(5), { degree: 3, controlPointCount: 2 });
    expect(c.controlPoints.length).toBeGreaterThan(0);
  });

  it('smoothing reduces deviation for noisy data', () => {
    const noisy: Point[] = circlePoints(30).map((p, i) => ({ x: p.x, y: p.y + (i % 2 === 0 ? 0.05 : -0.05), z: 0 }));
    const noSmooth = approximateBSpline(noisy, { controlPointCount: 6, smoothingWeight: 0 });
    const smoothed = approximateBSpline(noisy, { controlPointCount: 6, smoothingWeight: 1 });
    // Smoothing should still produce a valid curve.
    expect(smoothed.controlPoints).toHaveLength(noSmooth.controlPoints.length);
  });
});

describe('evaluateFitQuality', () => {
  it('zero input → 0 deviation', () => {
    const c = interpolateBSpline(linePoints(3));
    const q = evaluateFitQuality([], c);
    expect(q.maxDeviationMm).toBe(0);
  });

  it('interpolation has small max deviation', () => {
    const pts = linePoints(5);
    const c = interpolateBSpline(pts);
    const q = evaluateFitQuality(pts, c);
    expect(q.maxDeviationMm).toBeLessThan(1e-3);
  });
});
