import { describe, it, expect } from 'vitest';
import {
  evaluateFlatness,
  fitLeastSquaresPlane,
  summarize,
  type Vec3,
} from './flatnessTolerance';

function flatGrid(side: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < side; i++) {
    for (let j = 0; j < side; j++) {
      out.push({ x: i, y: j, z: 0 });
    }
  }
  return out;
}

function bumpyGrid(side: number, bumpHeight: number): Vec3[] {
  const out: Vec3[] = [];
  const cx = Math.floor(side / 2);
  for (let i = 0; i < side; i++) {
    for (let j = 0; j < side; j++) {
      const z = i === cx && j === cx ? bumpHeight : 0;
      out.push({ x: i, y: j, z });
    }
  }
  return out;
}

describe('evaluateFlatness', () => {
  it('< 3 points → trivially passes', () => {
    const r = evaluateFlatness([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]);
    expect(r.passed).toBe(true);
    expect(r.flatnessMm).toBe(0);
  });

  it('perfectly flat grid has flatness ≈ 0', () => {
    const r = evaluateFlatness(flatGrid(5), { toleranceMm: 0.01 });
    expect(r.flatnessMm).toBeLessThan(0.001);
    expect(r.passed).toBe(true);
  });

  it('bump exceeds tolerance', () => {
    const r = evaluateFlatness(bumpyGrid(5, 1), { toleranceMm: 0.5 });
    expect(r.passed).toBe(false);
    expect(r.flatnessMm).toBeGreaterThan(0.5);
  });

  it('reports worst point indices', () => {
    const r = evaluateFlatness(bumpyGrid(5, 1), { toleranceMm: 5 });
    expect(r.worstPointIndices.hiIdx).toBeGreaterThanOrEqual(0);
    expect(r.worstPointIndices.loIdx).toBeGreaterThanOrEqual(0);
  });

  it('with refinement, max and min are roughly balanced', () => {
    const r = evaluateFlatness(bumpyGrid(5, 1), { toleranceMm: 5, refineMinZone: true });
    expect(Math.abs(r.maxPositiveMm + r.maxNegativeMm)).toBeLessThan(0.01);
  });

  it('deviations array matches input length', () => {
    const pts = flatGrid(4);
    const r = evaluateFlatness(pts);
    expect(r.deviations).toHaveLength(pts.length);
  });

  it('tilted plane still has flatness ≈ 0', () => {
    // Make a tilted plane: z = x * 0.5.
    const pts: Vec3[] = [];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        pts.push({ x: i, y: j, z: i * 0.5 });
      }
    }
    const r = evaluateFlatness(pts, { toleranceMm: 0.01 });
    expect(r.flatnessMm).toBeLessThan(0.001);
  });
});

describe('fitLeastSquaresPlane', () => {
  it('XY plane fits horizontal grid', () => {
    const plane = fitLeastSquaresPlane(flatGrid(5));
    expect(Math.abs(plane.c)).toBeCloseTo(1, 2);
  });

  it('returns unit normal', () => {
    const plane = fitLeastSquaresPlane(flatGrid(5));
    expect(Math.hypot(plane.a, plane.b, plane.c)).toBeCloseTo(1, 5);
  });
});

describe('summarize', () => {
  it('zero points → trivially passing', () => {
    const r = evaluateFlatness([{ x: 0, y: 0, z: 0 }]);
    const s = summarize(r, 0.05);
    expect(s.pointCount).toBe(0);
    expect(s.passed).toBe(true);
  });

  it('reports margin', () => {
    const r = evaluateFlatness(flatGrid(5), { toleranceMm: 1 });
    const s = summarize(r, 1);
    expect(s.marginMm).toBeGreaterThan(0);
  });

  it('hotspot fraction is between 0 and 1', () => {
    const r = evaluateFlatness(bumpyGrid(5, 1), { toleranceMm: 5 });
    const s = summarize(r, 5);
    expect(s.hotspotFraction).toBeGreaterThanOrEqual(0);
    expect(s.hotspotFraction).toBeLessThanOrEqual(1);
  });

  it('marginMm negative when flatness exceeds tolerance', () => {
    const r = evaluateFlatness(bumpyGrid(5, 2), { toleranceMm: 0.1 });
    const s = summarize(r, 0.1);
    expect(s.marginMm).toBeLessThan(0);
  });
});
