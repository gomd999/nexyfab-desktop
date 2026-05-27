import { describe, it, expect } from 'vitest';
import {
  computeSweptVolume,
  bboxCorners,
  bboxesOverlap,
  summarize,
  type AABB,
  type Pose,
} from './sweptVolume';

function unitBbox(): AABB {
  return { min: { x: -0.5, y: -0.5, z: -0.5 }, max: { x: 0.5, y: 0.5, z: 0.5 } };
}

function identityPose(): Pose {
  return { translation: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, angleDeg: 0 };
}

function translatedPose(x: number, y: number, z: number): Pose {
  return { translation: { x, y, z }, axis: { x: 0, y: 0, z: 1 }, angleDeg: 0 };
}

describe('computeSweptVolume', () => {
  it('empty poses → zero volume', () => {
    const r = computeSweptVolume(unitBbox(), []);
    expect(r.bboxVolumeMm3).toBe(0);
    expect(r.poseCount).toBe(0);
  });

  it('single identity pose → original bbox volume', () => {
    const r = computeSweptVolume(unitBbox(), [identityPose()]);
    expect(r.bboxVolumeMm3).toBeCloseTo(1, 5);
  });

  it('translated pose extends bbox', () => {
    const r = computeSweptVolume(unitBbox(), [identityPose(), translatedPose(10, 0, 0)], { interpolationSamples: 0 });
    expect(r.axisRanges.x).toBeCloseTo(11, 1);
  });

  it('interpolation samples include intermediate poses', () => {
    const a = computeSweptVolume(unitBbox(), [identityPose(), translatedPose(10, 0, 0)], { interpolationSamples: 0 });
    const b = computeSweptVolume(unitBbox(), [identityPose(), translatedPose(10, 0, 0)], { interpolationSamples: 5 });
    expect(b.poseCount).toBeGreaterThan(a.poseCount);
  });

  it('rotation expands bbox', () => {
    const rotPose: Pose = { translation: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, angleDeg: 45 };
    const r = computeSweptVolume(unitBbox(), [identityPose(), rotPose], { interpolationSamples: 0 });
    expect(r.axisRanges.x).toBeGreaterThan(1);
  });

  it('records 8 corners per pose', () => {
    const r = computeSweptVolume(unitBbox(), [identityPose()], { interpolationSamples: 0 });
    expect(r.cornerSamples).toHaveLength(8);
  });

  it('Y axis untouched by X translation', () => {
    const r = computeSweptVolume(unitBbox(), [identityPose(), translatedPose(10, 0, 0)], { interpolationSamples: 0 });
    expect(r.axisRanges.y).toBeCloseTo(1, 5);
  });

  it('bbox volume = product of axis ranges', () => {
    const r = computeSweptVolume(unitBbox(), [identityPose(), translatedPose(3, 2, 0)], { interpolationSamples: 0 });
    const computed = r.axisRanges.x * r.axisRanges.y * r.axisRanges.z;
    expect(r.bboxVolumeMm3).toBeCloseTo(computed, 5);
  });
});

describe('bboxCorners', () => {
  it('produces 8 corners', () => {
    const corners = bboxCorners(unitBbox());
    expect(corners).toHaveLength(8);
  });

  it('corners include min and max points', () => {
    const corners = bboxCorners({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } });
    const hasMin = corners.some(c => c.x === 0 && c.y === 0 && c.z === 0);
    const hasMax = corners.some(c => c.x === 1 && c.y === 1 && c.z === 1);
    expect(hasMin).toBe(true);
    expect(hasMax).toBe(true);
  });
});

describe('bboxesOverlap', () => {
  it('overlapping bboxes return true', () => {
    expect(
      bboxesOverlap(
        { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 2, z: 2 } },
        { min: { x: 1, y: 1, z: 1 }, max: { x: 3, y: 3, z: 3 } },
      ),
    ).toBe(true);
  });

  it('disjoint bboxes return false', () => {
    expect(
      bboxesOverlap(
        { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
        { min: { x: 5, y: 5, z: 5 }, max: { x: 6, y: 6, z: 6 } },
      ),
    ).toBe(false);
  });

  it('touching bboxes count as overlapping', () => {
    expect(
      bboxesOverlap(
        { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
        { min: { x: 1, y: 0, z: 0 }, max: { x: 2, y: 1, z: 1 } },
      ),
    ).toBe(true);
  });
});

describe('summarize', () => {
  it('empty result → 0 pose count', () => {
    const s = summarize(computeSweptVolume(unitBbox(), []));
    expect(s.poseCount).toBe(0);
  });

  it('compact bbox detected', () => {
    const s = summarize(computeSweptVolume(unitBbox(), [identityPose()]));
    expect(s.shape).toBe('compact');
  });

  it('linear shape detected for long translation', () => {
    const s = summarize(computeSweptVolume(unitBbox(), [identityPose(), translatedPose(20, 0, 0)], { interpolationSamples: 0 }));
    expect(s.shape).toBe('linear');
  });

  it('aspect ratio = longest / shortest axis', () => {
    const s = summarize(computeSweptVolume(unitBbox(), [identityPose(), translatedPose(5, 0, 0)], { interpolationSamples: 0 }));
    expect(s.aspectRatio).toBeCloseTo(s.longestAxisMm / s.shortestAxisMm, 5);
  });

  it('longestAxisMm ≥ shortestAxisMm', () => {
    const s = summarize(computeSweptVolume(unitBbox(), [identityPose(), translatedPose(5, 2, 0)], { interpolationSamples: 0 }));
    expect(s.longestAxisMm).toBeGreaterThanOrEqual(s.shortestAxisMm);
  });
});
