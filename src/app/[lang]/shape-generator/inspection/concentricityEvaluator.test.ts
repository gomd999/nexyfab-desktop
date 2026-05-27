import { describe, it, expect } from 'vitest';
import {
  evaluate,
  medianVsSurfaceSpread,
  summarize,
  type OpposedPair,
} from './concentricityEvaluator';

// Perfectly concentric: opposed points symmetric about axis → median on axis.
function concentricPairs(radius: number, sections = 4): OpposedPair[] {
  const pairs: OpposedPair[] = [];
  for (let s = 0; s < sections; s++) {
    const z = s * 10;
    pairs.push({
      axialPositionMm: z,
      pointA: { x: radius, y: 0, z },
      pointB: { x: -radius, y: 0, z },
    });
  }
  return pairs;
}

// Eccentric: both opposed points shifted by e → median offset by e.
function eccentricPairs(radius: number, ecc: number, sections = 4): OpposedPair[] {
  const pairs: OpposedPair[] = [];
  for (let s = 0; s < sections; s++) {
    const z = s * 10;
    pairs.push({
      axialPositionMm: z,
      pointA: { x: radius + ecc, y: 0, z },
      pointB: { x: -radius + ecc, y: 0, z },
    });
  }
  return pairs;
}

describe('evaluate', () => {
  it('concentric feature → near-zero concentricity', () => {
    const r = evaluate({ pairs: concentricPairs(10), toleranceMm: 0.05 });
    expect(r.concentricityMm).toBeCloseTo(0, 6);
    expect(r.passed).toBe(true);
  });

  it('eccentric median → zone = 2 × eccentricity', () => {
    const r = evaluate({ pairs: eccentricPairs(10, 0.05), toleranceMm: 0.2 });
    expect(r.concentricityMm).toBeCloseTo(0.1, 5);
  });

  it('exceeds tolerance → fail', () => {
    const r = evaluate({ pairs: eccentricPairs(10, 0.3), toleranceMm: 0.2 });
    expect(r.passed).toBe(false);
  });

  it('median point computed as midpoint', () => {
    const r = evaluate({ pairs: concentricPairs(10), toleranceMm: 0.05 });
    expect(r.medianPoints[0]!.medianPoint.x).toBeCloseTo(0, 6);
  });

  it('worst axial identified', () => {
    const pairs = [
      ...eccentricPairs(10, 0.01, 1),
      { axialPositionMm: 50, pointA: { x: 10.5, y: 0, z: 50 }, pointB: { x: -9.5, y: 0, z: 50 } },
    ];
    const r = evaluate({ pairs, toleranceMm: 5 });
    expect(r.worstAxialMm).toBe(50);
  });

  it('empty pairs → warning', () => {
    const r = evaluate({ pairs: [], toleranceMm: 0.1 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('custom datum axis offset accounted', () => {
    // Concentric about x=5 axis: points at 5±10.
    const pairs: OpposedPair[] = [{
      axialPositionMm: 0,
      pointA: { x: 15, y: 0, z: 0 },
      pointB: { x: -5, y: 0, z: 0 },
    }];
    const r = evaluate({ pairs, datumAxisPoint: { x: 5, y: 0, z: 0 }, toleranceMm: 0.05 });
    expect(r.concentricityMm).toBeCloseTo(0, 6);
  });

  it('zero tolerance → warning', () => {
    const r = evaluate({ pairs: concentricPairs(10), toleranceMm: 0 });
    expect(r.warnings.some(w => w.toLowerCase().includes('tolerance'))).toBe(true);
  });
});

describe('medianVsSurfaceSpread', () => {
  it('concentric: median zone ≈ 0 but surface spread small', () => {
    const r = medianVsSurfaceSpread({ pairs: concentricPairs(10), toleranceMm: 0.05 });
    expect(r.medianZoneMm).toBeCloseTo(0, 6);
  });

  it('lobed surface: median zone small, surface spread larger', () => {
    // Opposed points symmetric (median on axis) but different radii → surface spread.
    const pairs: OpposedPair[] = [{
      axialPositionMm: 0,
      pointA: { x: 11, y: 0, z: 0 },
      pointB: { x: -11, y: 0, z: 0 },
    }, {
      axialPositionMm: 10,
      pointA: { x: 0, y: 9, z: 10 },
      pointB: { x: 0, y: -9, z: 10 },
    }];
    const r = medianVsSurfaceSpread({ pairs, toleranceMm: 5 });
    expect(r.medianZoneMm).toBeCloseTo(0, 5);
    expect(r.surfaceSpreadMm).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports pass + concentricity + count', () => {
    const r = evaluate({ pairs: concentricPairs(10), toleranceMm: 0.05 });
    const s = summarize(r);
    expect(s.pairCount).toBe(4);
    expect(s.concentricityMm).toBe(r.concentricityMm);
  });
});
