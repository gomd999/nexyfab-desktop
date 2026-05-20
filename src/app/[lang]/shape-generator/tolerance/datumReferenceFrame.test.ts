import { describe, it, expect } from 'vitest';
import {
  buildDrf,
  drfTransform,
  applyTransform,
  evaluateFeatureInDrf,
  stackup3D,
  type DatumFeature,
} from './datumReferenceFrame';

const planeA: DatumFeature = {
  label: 'A', kind: 'plane',
  position: [0, 0, 0], direction: [0, 0, 1],
  formToleranceMm: 0.02,
};
const planeB: DatumFeature = {
  label: 'B', kind: 'plane',
  position: [0, 0, 0], direction: [1, 0, 0],
  formToleranceMm: 0.03,
};
const planeC: DatumFeature = {
  label: 'C', kind: 'plane',
  position: [0, 0, 0], direction: [0, 1, 0],
  formToleranceMm: 0.04,
};

describe('buildDrf', () => {
  it('plane primary constrains 3 DOF', () => {
    const r = buildDrf(planeA);
    expect(r.constrainedDof).toBe(3);
    expect(r.fullyDefined).toBe(false);
  });

  it('plane A + plane B + plane C fully define DRF', () => {
    const r = buildDrf(planeA, planeB, planeC);
    expect(r.constrainedDof).toBe(6);
    expect(r.fullyDefined).toBe(true);
  });

  it('axis primary constrains 4 DOF', () => {
    const axis: DatumFeature = {
      label: 'A', kind: 'axis', position: [0, 0, 0], direction: [0, 0, 1],
    };
    const r = buildDrf(axis);
    expect(r.constrainedDof).toBe(4);
  });

  it('non-orthogonal planes warned', () => {
    const tilted: DatumFeature = {
      label: 'B', kind: 'plane', position: [0, 0, 0], direction: [0.5, 0.5, 0.5],
    };
    const r = buildDrf(planeA, tilted);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('orthogonal planes — no warning', () => {
    const r = buildDrf(planeA, planeB, planeC);
    expect(r.warnings).toHaveLength(0);
  });
});

describe('drfTransform', () => {
  it('plane normal becomes local +Z', () => {
    const drf = buildDrf(planeA);
    const t = drfTransform(drf);
    // (0,0,1) in part coords should map to (0,0,1) in DRF coords —
    // rotation row 2 (Z axis) reads primaryDir.
    expect(t.rotation[2]).toEqual([0, 0, 1]);
  });

  it('applyTransform on origin = -primaryPosition', () => {
    const offsetPlane: DatumFeature = {
      ...planeA, position: [10, 20, 30],
    };
    const drf = buildDrf(offsetPlane);
    const t = drfTransform(drf);
    expect(t.translation).toEqual([-10, -20, -30]);
  });

  it('orthonormal rotation matrix', () => {
    const drf = buildDrf(planeA, planeB, planeC);
    const t = drfTransform(drf);
    // Rows orthogonal + unit length.
    for (let i = 0; i < 3; i++) {
      const r = t.rotation[i]!;
      const len = Math.hypot(r[0]!, r[1]!, r[2]!);
      expect(len).toBeCloseTo(1, 5);
    }
  });
});

describe('evaluateFeatureInDrf', () => {
  it('feature with zero distance to all datums → tolerance = position only', () => {
    const drf = buildDrf(planeA, planeB, planeC);
    const r = evaluateFeatureInDrf(drf, {
      centerPart: [0, 0, 0],
      positionToleranceMm: 0.1,
    });
    // Datum contributions = formTol × (1 + 0/1000) = formTol.
    // RSS: sqrt(0.1² + 0.02² + 0.03² + 0.04²) ≈ 0.115.
    expect(r.effectiveToleranceMm).toBeGreaterThan(0.1);
    expect(r.effectiveToleranceMm).toBeLessThan(0.2);
  });

  it('per-datum contributions reported', () => {
    const drf = buildDrf(planeA, planeB, planeC);
    const r = evaluateFeatureInDrf(drf, {
      centerPart: [50, 0, 0],
      positionToleranceMm: 0.05,
    });
    expect(r.datumContributions).toHaveLength(3);
  });

  it('zero form tol → no datum contribution', () => {
    const drf = buildDrf({ ...planeA, formToleranceMm: 0 });
    const r = evaluateFeatureInDrf(drf, {
      centerPart: [0, 0, 0], positionToleranceMm: 0.1,
    });
    expect(r.datumContributions).toHaveLength(0);
  });
});

describe('stackup3D', () => {
  it('single link total = its effective tolerance', () => {
    const drf = buildDrf(planeA);
    const r = stackup3D([{
      drf,
      feature: { centerPart: [0, 0, 0], positionToleranceMm: 0.1 },
    }]);
    expect(r.totalToleranceMm).toBeCloseTo(r.contributions[0]!.contributionMm, 5);
  });

  it('worst-case ≥ RSS', () => {
    const drf = buildDrf(planeA, planeB, planeC);
    const r = stackup3D([
      { drf, feature: { centerPart: [0, 0, 0], positionToleranceMm: 0.1 } },
      { drf, feature: { centerPart: [10, 0, 0], positionToleranceMm: 0.1 } },
      { drf, feature: { centerPart: [20, 0, 0], positionToleranceMm: 0.1 } },
    ]);
    expect(r.worstCaseToleranceMm).toBeGreaterThanOrEqual(r.totalToleranceMm);
  });

  it('empty chain returns 0', () => {
    const r = stackup3D([]);
    expect(r.totalToleranceMm).toBe(0);
    expect(r.worstCaseToleranceMm).toBe(0);
  });
});

describe('applyTransform', () => {
  it('identity rotation + zero translation = pass-through', () => {
    const t = { rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0, 0] as [number, number, number] };
    expect(applyTransform(t, [5, 3, 7])).toEqual([5, 3, 7]);
  });
});
