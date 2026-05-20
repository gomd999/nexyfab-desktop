import { describe, it, expect } from 'vitest';
import {
  tessellationToleranceFor,
  angularToleranceFor,
  planTessellation,
  type FeatureSizeInput,
} from './adaptiveTessellation';

describe('tessellationToleranceFor', () => {
  it('returns finer tolerance for small features than large planes', () => {
    const smallHole: FeatureSizeInput = { kind: 'cylinder', bboxDiagMm: 2, principalMm: 0.5 };
    const largePlane: FeatureSizeInput = { kind: 'plane', bboxDiagMm: 1000 };
    const tHole = tessellationToleranceFor(smallHole);
    const tPlane = tessellationToleranceFor(largePlane);
    expect(tHole).toBeLessThan(tPlane);
  });

  it('clamps below minToleranceMm', () => {
    const tiny: FeatureSizeInput = { kind: 'plane', bboxDiagMm: 0.0001 };
    const tol = tessellationToleranceFor(tiny);
    expect(tol).toBeGreaterThanOrEqual(0.01);
  });

  it('clamps above maxToleranceMm', () => {
    const huge: FeatureSizeInput = { kind: 'plane', bboxDiagMm: 100_000 };
    const tol = tessellationToleranceFor(huge);
    expect(tol).toBeLessThanOrEqual(1.0);
  });

  it('respects custom min/max', () => {
    const f: FeatureSizeInput = { kind: 'plane', bboxDiagMm: 100 };
    const tol = tessellationToleranceFor(f, { minToleranceMm: 0.5, maxToleranceMm: 2 });
    expect(tol).toBeGreaterThanOrEqual(0.5);
    expect(tol).toBeLessThanOrEqual(2);
  });

  it('quality factor scales tolerance', () => {
    const f: FeatureSizeInput = { kind: 'plane', bboxDiagMm: 100 };
    const tHigh = tessellationToleranceFor(f, { qualityFactor: 0.5 }); // high quality = finer
    const tLow = tessellationToleranceFor(f, { qualityFactor: 1.5 });  // preview = coarser
    expect(tHigh).toBeLessThan(tLow);
  });

  it('cylinder/cone use radius (principalMm) when present', () => {
    const c1: FeatureSizeInput = { kind: 'cylinder', bboxDiagMm: 50, principalMm: 1 };
    const c2: FeatureSizeInput = { kind: 'cylinder', bboxDiagMm: 50, principalMm: 20 };
    expect(tessellationToleranceFor(c1)).toBeLessThan(tessellationToleranceFor(c2));
  });

  it('sphere tolerance < cylinder of same radius (tighter)', () => {
    const sphere: FeatureSizeInput = { kind: 'sphere', bboxDiagMm: 20, principalMm: 10 };
    const cylinder: FeatureSizeInput = { kind: 'cylinder', bboxDiagMm: 20, principalMm: 10 };
    expect(tessellationToleranceFor(sphere)).toBeLessThan(tessellationToleranceFor(cylinder));
  });

  it('unknown kind falls back to 1% of bbox', () => {
    const f: FeatureSizeInput = { kind: 'unknown', bboxDiagMm: 50 };
    const tol = tessellationToleranceFor(f);
    expect(tol).toBeCloseTo(0.5, 3); // 50 * 0.01 = 0.5, within clamp
  });
});

describe('angularToleranceFor', () => {
  it('cylinder has tighter angular than plane', () => {
    const cyl: FeatureSizeInput = { kind: 'cylinder', bboxDiagMm: 10 };
    const plane: FeatureSizeInput = { kind: 'plane', bboxDiagMm: 10 };
    expect(angularToleranceFor(cyl)).toBeLessThan(angularToleranceFor(plane));
  });

  it('sphere has tighter angular than cylinder', () => {
    const sphere: FeatureSizeInput = { kind: 'sphere', bboxDiagMm: 10 };
    const cyl: FeatureSizeInput = { kind: 'cylinder', bboxDiagMm: 10 };
    expect(angularToleranceFor(sphere)).toBeLessThan(angularToleranceFor(cyl));
  });

  it('quality factor scales angular tolerance', () => {
    const f: FeatureSizeInput = { kind: 'cylinder', bboxDiagMm: 10 };
    const hi = angularToleranceFor(f, { qualityFactor: 0.5 });
    const lo = angularToleranceFor(f, { qualityFactor: 1.5 });
    expect(hi).toBeLessThan(lo);
  });
});

describe('planTessellation', () => {
  it('aggregates per-feature plan with min/max/mean', () => {
    const features = [
      { id: 'f1', kind: 'plane' as const, bboxDiagMm: 100 },
      { id: 'f2', kind: 'cylinder' as const, bboxDiagMm: 10, principalMm: 2 },
      { id: 'f3', kind: 'sphere' as const, bboxDiagMm: 20, principalMm: 5 },
    ];
    const plan = planTessellation(features);
    expect(plan.features).toHaveLength(3);
    expect(plan.minToleranceMm).toBeLessThanOrEqual(plan.meanToleranceMm);
    expect(plan.meanToleranceMm).toBeLessThanOrEqual(plan.maxToleranceMm);
    // Each feature has both spatial and angular components.
    for (const f of plan.features) {
      expect(f.toleranceMm).toBeGreaterThan(0);
      expect(f.angularRad).toBeGreaterThan(0);
    }
  });

  it('handles empty feature list without NaN', () => {
    const plan = planTessellation([]);
    expect(plan.features).toEqual([]);
    expect(plan.minToleranceMm).toBe(0);
    expect(plan.maxToleranceMm).toBe(0);
    expect(plan.meanToleranceMm).toBe(0);
  });

  it('quality preset propagates to every feature', () => {
    const features = [
      { id: 'f1', kind: 'plane' as const, bboxDiagMm: 100 },
      { id: 'f2', kind: 'cylinder' as const, bboxDiagMm: 10, principalMm: 2 },
    ];
    const preview = planTessellation(features, { qualityFactor: 1.5 });
    const hi = planTessellation(features, { qualityFactor: 0.5 });
    expect(preview.meanToleranceMm).toBeGreaterThan(hi.meanToleranceMm);
  });
});
