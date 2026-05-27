import { describe, it, expect } from 'vitest';
import {
  dimensionSpline,
  fitCircleRadius,
  summarize,
  type SplineCurve,
} from './splineDimension';

function straightLine(n: number = 10, length: number = 10): SplineCurve {
  const points = [];
  for (let i = 0; i < n; i++) {
    points.push({ x: (i / (n - 1)) * length, y: 0 });
  }
  return { points };
}

function semiCircle(n: number = 20, radius: number = 10): SplineCurve {
  const points = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI;
    points.push({ x: Math.cos(t) * radius, y: Math.sin(t) * radius });
  }
  return { points };
}

describe('dimensionSpline', () => {
  it('empty spline → zero dimensions', () => {
    const d = dimensionSpline({ points: [] });
    expect(d.arcLengthMm).toBe(0);
    expect(d.chordLengthMm).toBe(0);
  });

  it('single point → zero dimensions', () => {
    const d = dimensionSpline({ points: [{ x: 0, y: 0 }] });
    expect(d.arcLengthMm).toBe(0);
  });

  it('straight line: arc ≈ chord', () => {
    const d = dimensionSpline(straightLine(10, 100));
    expect(d.arcLengthMm).toBeCloseTo(100, 1);
    expect(d.chordLengthMm).toBeCloseTo(100, 1);
  });

  it('semi-circle arc length ≈ π·r', () => {
    const d = dimensionSpline(semiCircle(50, 10));
    expect(d.arcLengthMm).toBeCloseTo(Math.PI * 10, 0);
  });

  it('semi-circle chord ≈ 2·r', () => {
    const d = dimensionSpline(semiCircle(50, 10));
    expect(d.chordLengthMm).toBeCloseTo(20, 0);
  });

  it('bbox computed from points', () => {
    const d = dimensionSpline({ points: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: -5, y: 3 }] });
    expect(d.bbox.min).toEqual({ x: -5, y: 0 });
    expect(d.bbox.max).toEqual({ x: 10, y: 5 });
  });

  it('bboxWidth = max-min x', () => {
    const d = dimensionSpline({ points: [{ x: 0, y: 0 }, { x: 10, y: 5 }] });
    expect(d.bboxWidthMm).toBe(10);
  });

  it('start tangent angle 0 for horizontal line', () => {
    const d = dimensionSpline(straightLine(5, 10));
    expect(d.startTangentDeg).toBeCloseTo(0, 5);
  });

  it('semi-circle curvature peaks have radius ≈ 10', () => {
    const d = dimensionSpline(semiCircle(50, 10));
    const peak = d.curvaturePeaks[0];
    if (peak) {
      expect(peak.radiusMm).toBeGreaterThan(8);
      expect(peak.radiusMm).toBeLessThan(15);
    }
  });

  it('curvature peak count respected', () => {
    const d = dimensionSpline(semiCircle(50, 10), { curvaturePeakCount: 5 });
    expect(d.curvaturePeaks.length).toBeLessThanOrEqual(5);
  });

  it('peaks sorted by curvature desc', () => {
    const d = dimensionSpline(semiCircle(50, 10));
    for (let i = 1; i < d.curvaturePeaks.length; i++) {
      expect(d.curvaturePeaks[i]!.curvature).toBeLessThanOrEqual(d.curvaturePeaks[i - 1]!.curvature);
    }
  });
});

describe('fitCircleRadius', () => {
  it('three collinear points → infinity', () => {
    expect(fitCircleRadius({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBe(Infinity);
  });

  it('three points on unit circle → r ≈ 1', () => {
    const r = fitCircleRadius(
      { x: 1, y: 0 },
      { x: Math.cos(Math.PI / 3), y: Math.sin(Math.PI / 3) },
      { x: Math.cos(2 * Math.PI / 3), y: Math.sin(2 * Math.PI / 3) },
    );
    expect(r).toBeCloseTo(1, 3);
  });

  it('three points on circle of radius 5 → r ≈ 5', () => {
    const r = fitCircleRadius(
      { x: 5, y: 0 },
      { x: 0, y: 5 },
      { x: -5, y: 0 },
    );
    expect(r).toBeCloseTo(5, 3);
  });
});

describe('summarize', () => {
  it('empty input', () => {
    const s = summarize(dimensionSpline({ points: [] }));
    expect(s.arcLengthMm).toBe(0);
  });

  it('reports arcToChord ratio = 1 for straight line', () => {
    const s = summarize(dimensionSpline(straightLine(10, 100)));
    expect(s.arcToChordRatio).toBeCloseTo(1, 2);
  });

  it('arcToChord > 1 for curved spline', () => {
    const s = summarize(dimensionSpline(semiCircle(50, 10)));
    expect(s.arcToChordRatio).toBeGreaterThan(1);
  });

  it('bbox area = width × height', () => {
    const d = dimensionSpline({ points: [{ x: 0, y: 0 }, { x: 10, y: 5 }] });
    const s = summarize(d);
    expect(s.bboxArea).toBe(50);
  });
});
