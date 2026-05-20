import { describe, it, expect } from 'vitest';
import {
  evaluateSurface,
  evaluateAxis,
  tiltAngleDeg,
  summarizeSurface,
  summarizeAxis,
  type Point3D,
} from './parallelismEvaluator';

const datumNormal = { x: 0, y: 0, z: 1 };

describe('evaluateSurface', () => {
  it('flat surface parallel to datum → near-zero parallelism', () => {
    const pts: Point3D[] = [
      { x: 0, y: 0, z: 5 }, { x: 10, y: 0, z: 5 }, { x: 0, y: 10, z: 5 }, { x: 10, y: 10, z: 5 },
    ];
    const r = evaluateSurface({ points: pts, datumNormal, toleranceMm: 0.05 });
    expect(r.parallelismMm).toBeCloseTo(0, 6);
    expect(r.passed).toBe(true);
  });

  it('offset from datum does not affect parallelism', () => {
    const near: Point3D[] = [{ x: 0, y: 0, z: 1 }, { x: 10, y: 0, z: 1 }];
    const far: Point3D[] = [{ x: 0, y: 0, z: 100 }, { x: 10, y: 0, z: 100 }];
    expect(evaluateSurface({ points: near, datumNormal, toleranceMm: 0.05 }).parallelismMm)
      .toBeCloseTo(evaluateSurface({ points: far, datumNormal, toleranceMm: 0.05 }).parallelismMm, 6);
  });

  it('tilted surface → nonzero parallelism', () => {
    const pts: Point3D[] = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0.2 }];
    const r = evaluateSurface({ points: pts, datumNormal, toleranceMm: 0.05 });
    expect(r.parallelismMm).toBeCloseTo(0.2, 5);
  });

  it('exceeds tolerance → fail', () => {
    const pts: Point3D[] = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0.5 }];
    const r = evaluateSurface({ points: pts, datumNormal, toleranceMm: 0.2 });
    expect(r.passed).toBe(false);
  });

  it('parallelism = max − min projection', () => {
    const pts: Point3D[] = [{ x: 0, y: 0, z: 0.1 }, { x: 10, y: 0, z: -0.1 }];
    const r = evaluateSurface({ points: pts, datumNormal, toleranceMm: 1 });
    expect(r.parallelismMm).toBeCloseTo(r.maxProjection - r.minProjection, 6);
  });

  it('too few points → warning', () => {
    const r = evaluateSurface({ points: [{ x: 0, y: 0, z: 0 }], datumNormal, toleranceMm: 0.05 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('evaluateAxis', () => {
  it('axis parallel to datum direction → zero zone', () => {
    const pts: Point3D[] = [
      { x: 5, y: 0, z: 0 }, { x: 5, y: 0, z: 10 }, { x: 5, y: 0, z: 20 },
    ];
    const r = evaluateAxis({ axisPoints: pts, datumDirection: { x: 0, y: 0, z: 1 }, toleranceMm: 0.05 });
    expect(r.diametralZoneMm).toBeCloseTo(0, 5);
    expect(r.passed).toBe(true);
  });

  it('skewed axis → nonzero zone', () => {
    const pts: Point3D[] = [
      { x: 0, y: 0, z: 0 }, { x: 0.3, y: 0, z: 10 }, { x: 0.6, y: 0, z: 20 },
    ];
    const r = evaluateAxis({ axisPoints: pts, datumDirection: { x: 0, y: 0, z: 1 }, toleranceMm: 0.05 });
    expect(r.diametralZoneMm).toBeGreaterThan(0);
  });

  it('zone = 2 × max radial', () => {
    const pts: Point3D[] = [
      { x: 0, y: 0, z: 0 }, { x: 0.4, y: 0, z: 10 },
    ];
    const r = evaluateAxis({ axisPoints: pts, datumDirection: { x: 0, y: 0, z: 1 }, toleranceMm: 5 });
    expect(r.diametralZoneMm).toBeCloseTo(2 * r.maxRadialDeviationMm, 6);
  });

  it('too few points → warning', () => {
    const r = evaluateAxis({ axisPoints: [{ x: 0, y: 0, z: 0 }], datumDirection: { x: 0, y: 0, z: 1 }, toleranceMm: 0.05 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('tiltAngleDeg', () => {
  it('parallel normals → 0°', () => {
    expect(tiltAngleDeg({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 })).toBeCloseTo(0, 4);
  });

  it('perpendicular normals → 90°', () => {
    expect(tiltAngleDeg({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toBeCloseTo(90, 4);
  });
});

describe('summaries', () => {
  it('surface summary', () => {
    const r = evaluateSurface({ points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], datumNormal, toleranceMm: 0.1 });
    expect(summarizeSurface(r).passed).toBe(r.passed);
  });

  it('axis summary', () => {
    const r = evaluateAxis({ axisPoints: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }], datumDirection: { x: 0, y: 0, z: 1 }, toleranceMm: 0.1 });
    expect(summarizeAxis(r).diametralZoneMm).toBe(r.diametralZoneMm);
  });
});
