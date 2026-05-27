import { describe, it, expect } from 'vitest';
import {
  alignICP,
  solveRigidTransform,
  applyTransform,
  identityTransform,
  summarize,
  type Vec3,
} from './cmmPointCloudAlignICP';

function cubeCorners(): Vec3[] {
  return [
    { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 1, y: 1, z: 1 }, { x: 0, y: 1, z: 1 },
  ];
}

function translatePoints(pts: Vec3[], dx: number, dy: number, dz: number): Vec3[] {
  return pts.map(p => ({ x: p.x + dx, y: p.y + dy, z: p.z + dz }));
}

describe('alignICP', () => {
  it('empty input → identity transform', () => {
    const r = alignICP([], []);
    expect(r.transform.translation).toEqual({ x: 0, y: 0, z: 0 });
    expect(r.alignedPoints).toEqual([]);
  });

  it('identical clouds → already aligned (RMS ≈ 0)', () => {
    const src = cubeCorners();
    const tgt = cubeCorners();
    const r = alignICP(src, tgt);
    expect(r.finalRmsMm).toBeLessThan(0.01);
  });

  it('pure translation (small) recovers translation', () => {
    const src = cubeCorners();
    const tgt = translatePoints(cubeCorners(), 0.5, 0.3, 0.2);
    const r = alignICP(src, tgt, { trimFraction: 0 });
    expect(r.transform.translation.x).toBeCloseTo(0.5, 1);
    expect(r.transform.translation.y).toBeCloseTo(0.3, 1);
    expect(r.transform.translation.z).toBeCloseTo(0.2, 1);
  });

  it('aligned points are close to target after alignment', () => {
    const src = cubeCorners();
    const tgt = translatePoints(cubeCorners(), 0.3, 0, 0);
    const r = alignICP(src, tgt, { trimFraction: 0 });
    let totalDist = 0;
    for (let i = 0; i < r.alignedPoints.length; i++) {
      totalDist += Math.hypot(
        r.alignedPoints[i]!.x - tgt[i]!.x,
        r.alignedPoints[i]!.y - tgt[i]!.y,
        r.alignedPoints[i]!.z - tgt[i]!.z,
      );
    }
    expect(totalDist / r.alignedPoints.length).toBeLessThan(0.5);
  });

  it('produces rms history', () => {
    const src = cubeCorners();
    const tgt = translatePoints(src, 2, 0, 0);
    const r = alignICP(src, tgt);
    expect(r.rmsHistory.length).toBeGreaterThan(0);
  });

  it('RMS decreases over iterations', () => {
    const src = cubeCorners();
    const tgt = translatePoints(src, 5, 0, 0);
    const r = alignICP(src, tgt, { trimFraction: 0 });
    if (r.rmsHistory.length >= 2) {
      expect(r.rmsHistory[r.rmsHistory.length - 1]!).toBeLessThanOrEqual(r.rmsHistory[0]!);
    }
  });

  it('trimming reports outlier indices', () => {
    const src = [...cubeCorners(), { x: 100, y: 100, z: 100 }];
    const tgt = cubeCorners();
    const r = alignICP(src, tgt, { trimFraction: 0.2 });
    expect(r.trimmedIndices.length).toBeGreaterThan(0);
  });

  it('respects maxIterations', () => {
    const src = cubeCorners();
    const tgt = translatePoints(src, 1, 1, 1);
    const r = alignICP(src, tgt, { maxIterations: 1, toleranceMm: 0 });
    expect(r.rmsHistory.length).toBeLessThanOrEqual(1);
  });
});

describe('solveRigidTransform', () => {
  it('returns identity for < 3 points', () => {
    const t = solveRigidTransform([{ x: 0, y: 0, z: 0 }], [{ x: 1, y: 1, z: 1 }]);
    expect(t.translation).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('translation only', () => {
    const src = cubeCorners();
    const tgt = translatePoints(src, 3, 4, 5);
    const t = solveRigidTransform(src, tgt);
    expect(t.translation.x).toBeCloseTo(3, 3);
    expect(t.translation.y).toBeCloseTo(4, 3);
    expect(t.translation.z).toBeCloseTo(5, 3);
  });

  it('rotation matrix is orthogonal (R Rᵀ = I)', () => {
    const src = cubeCorners();
    const tgt = translatePoints(src, 0, 5, 0);
    const t = solveRigidTransform(src, tgt);
    const R = t.rotation;
    // R Rᵀ → diagonal ≈ 1.
    for (let r = 0; r < 3; r++) {
      let dot = 0;
      for (let c = 0; c < 3; c++) {
        dot += R[r * 3 + c]! * R[r * 3 + c]!;
      }
      expect(dot).toBeCloseTo(1, 3);
    }
  });
});

describe('applyTransform', () => {
  it('identity transform leaves point unchanged', () => {
    const p = { x: 1, y: 2, z: 3 };
    const r = applyTransform(identityTransform(), p);
    expect(r).toEqual(p);
  });

  it('translates by translation vector', () => {
    const t = { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: { x: 5, y: 0, z: 0 } };
    const r = applyTransform(t, { x: 1, y: 1, z: 1 });
    expect(r).toEqual({ x: 6, y: 1, z: 1 });
  });
});

describe('summarize', () => {
  it('reports iteration count', () => {
    const src = cubeCorners();
    const tgt = translatePoints(src, 2, 0, 0);
    const r = alignICP(src, tgt);
    const s = summarize(r);
    expect(s.iterationsRun).toBe(r.rmsHistory.length);
  });

  it('reduction fraction is between 0 and 1 (or 0 if no initial)', () => {
    const src = cubeCorners();
    const tgt = translatePoints(src, 2, 0, 0);
    const s = summarize(alignICP(src, tgt));
    expect(s.reductionFraction).toBeLessThanOrEqual(1);
    expect(s.reductionFraction).toBeGreaterThanOrEqual(-0.01);
  });

  it('empty result → zeros', () => {
    const s = summarize(alignICP([], []));
    expect(s.iterationsRun).toBe(0);
    expect(s.finalRms).toBe(0);
  });
});
