import { describe, it, expect } from 'vitest';
import {
  evaluateLine,
  evaluateAxis,
  summarizeLine,
  summarizeAxis,
  type Point2D,
  type Point3D,
} from './straightnessEvaluator';

describe('evaluateLine', () => {
  it('perfectly straight line → zero straightness', () => {
    const pts: Point2D[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 },
    ];
    const r = evaluateLine({ points: pts, toleranceMm: 0.05 });
    expect(r.straightnessMm).toBeCloseTo(0, 6);
    expect(r.passed).toBe(true);
  });

  it('sloped but straight line → zero straightness', () => {
    const pts: Point2D[] = [
      { x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 10 }, { x: 30, y: 15 },
    ];
    const r = evaluateLine({ points: pts, toleranceMm: 0.05 });
    expect(r.straightnessMm).toBeCloseTo(0, 6);
    expect(r.slope).toBeCloseTo(0.5, 6);
  });

  it('bowed line → nonzero straightness', () => {
    const pts: Point2D[] = [
      { x: 0, y: 0 }, { x: 10, y: 0.1 }, { x: 20, y: 0.1 }, { x: 30, y: 0 },
    ];
    const r = evaluateLine({ points: pts, toleranceMm: 0.05 });
    expect(r.straightnessMm).toBeGreaterThan(0);
  });

  it('exceeds tolerance → fail', () => {
    const pts: Point2D[] = [
      { x: 0, y: 0 }, { x: 10, y: 0.5 }, { x: 20, y: -0.5 }, { x: 30, y: 0 },
    ];
    const r = evaluateLine({ points: pts, toleranceMm: 0.1 });
    expect(r.passed).toBe(false);
  });

  it('too few points → warning', () => {
    const r = evaluateLine({ points: [{ x: 0, y: 0 }], toleranceMm: 0.1 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('straightness = max − min deviation', () => {
    const pts: Point2D[] = [
      { x: 0, y: 0 }, { x: 10, y: 0.1 }, { x: 20, y: -0.1 }, { x: 30, y: 0 },
    ];
    const r = evaluateLine({ points: pts, toleranceMm: 1 });
    expect(r.straightnessMm).toBeCloseTo(r.maxDeviationMm - r.minDeviationMm, 6);
  });
});

describe('evaluateAxis', () => {
  it('straight axis → zero zone', () => {
    const pts: Point3D[] = [
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 20 },
    ];
    const r = evaluateAxis({ axisPoints: pts, toleranceMm: 0.05 });
    expect(r.diametralZoneMm).toBeCloseTo(0, 6);
    expect(r.passed).toBe(true);
  });

  it('tilted-but-straight axis → zero zone', () => {
    const pts: Point3D[] = [
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 10 }, { x: 2, y: 0, z: 20 },
    ];
    const r = evaluateAxis({ axisPoints: pts, toleranceMm: 0.05 });
    expect(r.diametralZoneMm).toBeCloseTo(0, 5);
  });

  it('bent axis → nonzero zone', () => {
    const pts: Point3D[] = [
      { x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 10 }, { x: 0, y: 0, z: 20 },
    ];
    const r = evaluateAxis({ axisPoints: pts, toleranceMm: 0.05 });
    expect(r.diametralZoneMm).toBeGreaterThan(0);
  });

  it('diametral zone = 2 × max radial', () => {
    const pts: Point3D[] = [
      { x: 0, y: 0, z: 0 }, { x: 0.3, y: 0, z: 10 }, { x: 0, y: 0, z: 20 },
    ];
    const r = evaluateAxis({ axisPoints: pts, toleranceMm: 5 });
    expect(r.diametralZoneMm).toBeCloseTo(2 * r.maxRadialDeviationMm, 6);
  });

  it('exceeds tolerance → fail', () => {
    const pts: Point3D[] = [
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 10 }, { x: 0, y: 0, z: 20 },
    ];
    const r = evaluateAxis({ axisPoints: pts, toleranceMm: 0.1 });
    expect(r.passed).toBe(false);
  });

  it('too few points → warning', () => {
    const r = evaluateAxis({ axisPoints: [{ x: 0, y: 0, z: 0 }], toleranceMm: 0.1 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('summaries', () => {
  it('line summary reports pass + straightness', () => {
    const r = evaluateLine({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], toleranceMm: 0.1 });
    expect(summarizeLine(r).passed).toBe(r.passed);
  });

  it('axis summary reports pass + zone', () => {
    const r = evaluateAxis({ axisPoints: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }], toleranceMm: 0.1 });
    expect(summarizeAxis(r).diametralZoneMm).toBe(r.diametralZoneMm);
  });
});
