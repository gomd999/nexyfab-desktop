import { describe, it, expect } from 'vitest';
import {
  evaluateAxis,
  evaluateSurface,
  summarizeAxis,
  summarizeSurface,
  type Point3D,
} from './perpendicularityEvaluator';

describe('evaluateAxis', () => {
  it('axis along datum normal → zero zone', () => {
    // datum plane = XY (normal +Z); a hole axis ⟂ to it runs along Z.
    const pts: Point3D[] = [
      { x: 5, y: 5, z: 0 }, { x: 5, y: 5, z: 10 }, { x: 5, y: 5, z: 20 },
    ];
    const r = evaluateAxis({ axisPoints: pts, datumNormal: { x: 0, y: 0, z: 1 }, toleranceMm: 0.05 });
    expect(r.diametralZoneMm).toBeCloseTo(0, 5);
    expect(r.tiltAngleDeg).toBeCloseTo(0, 4);
    expect(r.passed).toBe(true);
  });

  it('tilted axis → nonzero zone + tilt', () => {
    const pts: Point3D[] = [
      { x: 0, y: 0, z: 0 }, { x: 0.3, y: 0, z: 10 }, { x: 0.6, y: 0, z: 20 },
    ];
    const r = evaluateAxis({ axisPoints: pts, datumNormal: { x: 0, y: 0, z: 1 }, toleranceMm: 0.05 });
    expect(r.diametralZoneMm).toBeGreaterThan(0);
    expect(r.tiltAngleDeg).toBeGreaterThan(0);
  });

  it('zone = 2 × max radial', () => {
    const pts: Point3D[] = [
      { x: 0, y: 0, z: 0 }, { x: 0.4, y: 0, z: 10 },
    ];
    const r = evaluateAxis({ axisPoints: pts, datumNormal: { x: 0, y: 0, z: 1 }, toleranceMm: 5 });
    expect(r.diametralZoneMm).toBeCloseTo(2 * r.maxRadialDeviationMm, 6);
  });

  it('exceeds tolerance → fail', () => {
    const pts: Point3D[] = [
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 10 },
    ];
    const r = evaluateAxis({ axisPoints: pts, datumNormal: { x: 0, y: 0, z: 1 }, toleranceMm: 0.1 });
    expect(r.passed).toBe(false);
  });

  it('too few points → warning', () => {
    const r = evaluateAxis({ axisPoints: [{ x: 0, y: 0, z: 0 }], datumNormal: { x: 0, y: 0, z: 1 }, toleranceMm: 0.05 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('evaluateSurface', () => {
  it('square wall → near-zero perpendicularity', () => {
    // Wall in the XZ plane (controlled normal +Y), datum = XY (normal +Z).
    const pts: Point3D[] = [
      { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }, { x: 10, y: 0, z: 10 },
    ];
    const r = evaluateSurface({
      points: pts,
      datumNormal: { x: 0, y: 0, z: 1 },
      controlledNormal: { x: 0, y: 1, z: 0 },
      toleranceMm: 0.05,
    });
    expect(r.perpendicularityMm).toBeCloseTo(0, 6);
    expect(r.passed).toBe(true);
  });

  it('out-of-square wall → nonzero perpendicularity', () => {
    const pts: Point3D[] = [
      { x: 0, y: 0, z: 0 }, { x: 10, y: 0.2, z: 0 }, { x: 0, y: 0, z: 10 }, { x: 10, y: 0.2, z: 10 },
    ];
    const r = evaluateSurface({
      points: pts,
      datumNormal: { x: 0, y: 0, z: 1 },
      controlledNormal: { x: 0, y: 1, z: 0 },
      toleranceMm: 0.05,
    });
    expect(r.perpendicularityMm).toBeGreaterThan(0);
  });

  it('perpendicularity = max − min projection', () => {
    const pts: Point3D[] = [
      { x: 0, y: 0.1, z: 0 }, { x: 10, y: -0.1, z: 0 },
    ];
    const r = evaluateSurface({
      points: pts,
      datumNormal: { x: 0, y: 0, z: 1 },
      controlledNormal: { x: 0, y: 1, z: 0 },
      toleranceMm: 1,
    });
    expect(r.perpendicularityMm).toBeCloseTo(r.maxDeviationMm - r.minDeviationMm, 6);
  });

  it('controlled ⟂ datum → squareness deviation ≈ 0', () => {
    const r = evaluateSurface({
      points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      datumNormal: { x: 0, y: 0, z: 1 },
      controlledNormal: { x: 0, y: 1, z: 0 },
      toleranceMm: 1,
    });
    expect(r.squarenessAngleDeg).toBeCloseTo(0, 4);
  });
});

describe('summaries', () => {
  it('axis summary', () => {
    const r = evaluateAxis({ axisPoints: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }], datumNormal: { x: 0, y: 0, z: 1 }, toleranceMm: 0.1 });
    expect(summarizeAxis(r).passed).toBe(r.passed);
  });

  it('surface summary', () => {
    const r = evaluateSurface({ points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], datumNormal: { x: 0, y: 0, z: 1 }, controlledNormal: { x: 0, y: 1, z: 0 }, toleranceMm: 0.1 });
    expect(summarizeSurface(r).perpendicularityMm).toBe(r.perpendicularityMm);
  });
});
