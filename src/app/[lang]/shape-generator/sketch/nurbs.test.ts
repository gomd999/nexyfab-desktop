/**
 * nurbs — pure NURBS/B-spline math (knot vectors, de Boor evaluation, fitting).
 * Coverage-gap closure for the sketch subsystem.
 */
import { describe, it, expect } from 'vitest';
import { clampedUniformKnots, evalNurbs, sampleNurbsSegment, fitNurbsThroughPoints } from './nurbs';
import type { SketchPoint } from './types';

describe('clampedUniformKnots', () => {
  it('is clamped (p+1 zeros / p+1 ones), non-decreasing, normalized to [0,1]', () => {
    const p = 3;
    const k = clampedUniformKnots(6, p);
    expect(k.slice(0, p + 1)).toEqual([0, 0, 0, 0]);
    expect(k.slice(-(p + 1))).toEqual([1, 1, 1, 1]);
    for (let i = 1; i < k.length; i++) expect(k[i]).toBeGreaterThanOrEqual(k[i - 1]);
    expect(Math.min(...k)).toBe(0);
    expect(Math.max(...k)).toBe(1);
  });
});

describe('evalNurbs', () => {
  // A clamped cubic Bézier (degree = cps-1) interpolates its endpoints exactly.
  const cps: SketchPoint[] = [{ x: 0, y: 0 }, { x: 1, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 0 }];
  const knots = [0, 0, 0, 0, 1, 1, 1, 1];
  it('interpolates the clamped endpoints', () => {
    const a = evalNurbs(cps, 3, knots, undefined, 0);
    const b = evalNurbs(cps, 3, knots, undefined, 1);
    expect(a.x).toBeCloseTo(0); expect(a.y).toBeCloseTo(0);
    expect(b.x).toBeCloseTo(5); expect(b.y).toBeCloseTo(0);
  });
  it('returns a finite interior point', () => {
    const m = evalNurbs(cps, 3, knots, undefined, 0.5);
    expect(Number.isFinite(m.x)).toBe(true);
    expect(Number.isFinite(m.y)).toBe(true);
    expect(m.x).toBeGreaterThan(0); expect(m.x).toBeLessThan(5);
  });
});

describe('fitNurbsThroughPoints', () => {
  it('produces control points for a polyline', () => {
    const pts: SketchPoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }, { x: 3, y: 1 }];
    const res = fitNurbsThroughPoints(pts);
    expect(res).toBeTruthy();
    expect(Array.isArray(res.controlPoints)).toBe(true);
    expect(res.controlPoints.length).toBeGreaterThan(0);
  });
});

describe('sampleNurbsSegment', () => {
  it('samples a nurbs segment to a polyline of the requested density', () => {
    const seg = { type: 'nurbs', points: [{ x: 0, y: 0 }, { x: 2, y: 4 }, { x: 6, y: 4 }, { x: 8, y: 0 }], degree: 3 };
     
    const out = sampleNurbsSegment(seg as any, 16);
    expect(out.length).toBeGreaterThanOrEqual(2);
    out.forEach(p => { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.y)).toBe(true); });
  });
});
