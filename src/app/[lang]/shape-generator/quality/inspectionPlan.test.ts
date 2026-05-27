import { describe, it, expect } from 'vitest';
import {
  generateInspectionPlan,
  estimateInspectionCostUsd,
  type DrawingFeature,
  type GdtSpec,
} from './inspectionPlan';

const datumA: DrawingFeature = {
  id: 'F1', name: 'Bottom face', type: 'plane', principalSizeMm: 100,
  isDatum: true, datumLabel: 'A',
};
const datumB: DrawingFeature = {
  id: 'F2', name: 'Side face', type: 'plane', principalSizeMm: 80,
  isDatum: true, datumLabel: 'B',
};
const hole1: DrawingFeature = {
  id: 'F3', name: 'Mounting hole', type: 'hole', principalSizeMm: 8,
};
const cylinder1: DrawingFeature = {
  id: 'F4', name: 'Shaft', type: 'cylinder', principalSizeMm: 25,
};

describe('generateInspectionPlan', () => {
  it('returns empty plan for empty inputs', () => {
    const p = generateInspectionPlan([], []);
    expect(p.operations).toHaveLength(0);
    expect(p.totalTimeSec).toBe(0);
  });

  it('emits datum-set ops first', () => {
    const p = generateInspectionPlan([datumA, datumB, hole1], [
      { id: 'S1', featureId: 'F3', callout: 'position', toleranceMm: 0.1, datumRefs: ['A', 'B'] },
    ]);
    expect(p.operations[0]!.callout).toBe('datum-set');
    expect(p.operations[1]!.callout).toBe('datum-set');
  });

  it('datums emitted in alphabetical label order', () => {
    const p = generateInspectionPlan([datumB, datumA], []);
    expect(p.operations[0]!.featureId).toBe('F1'); // A
    expect(p.operations[1]!.featureId).toBe('F2'); // B
  });

  it('tighter tolerance gets more touches', () => {
    const p1 = generateInspectionPlan([cylinder1], [
      { id: 'S1', featureId: 'F4', callout: 'cylindricity', toleranceMm: 0.5 },
    ]);
    const p2 = generateInspectionPlan([cylinder1], [
      { id: 'S2', featureId: 'F4', callout: 'cylindricity', toleranceMm: 0.005 },
    ]);
    const tight = p2.operations[0]!.touchCount;
    const loose = p1.operations[0]!.touchCount;
    expect(tight).toBeGreaterThan(loose);
  });

  it('warns on unknown feature reference', () => {
    const p = generateInspectionPlan([datumA], [
      { id: 'S1', featureId: 'NOPE', callout: 'flatness', toleranceMm: 0.05 },
    ]);
    expect(p.warnings.some(w => w.includes('NOPE'))).toBe(true);
  });

  it('warns on missing datum reference', () => {
    const p = generateInspectionPlan([hole1], [
      { id: 'S1', featureId: 'F3', callout: 'position', toleranceMm: 0.1, datumRefs: ['Z'] },
    ]);
    expect(p.warnings.some(w => w.includes('Z'))).toBe(true);
  });

  it('totalTouches = sum of per-op touches', () => {
    const p = generateInspectionPlan([datumA, hole1], [
      { id: 'S1', featureId: 'F3', callout: 'position', toleranceMm: 0.1, datumRefs: ['A'] },
    ]);
    const sum = p.operations.reduce((s, o) => s + o.touchCount, 0);
    expect(p.totalTouches).toBe(sum);
  });

  it('totalTimeSec > 0 when operations exist', () => {
    const p = generateInspectionPlan([datumA, cylinder1], [
      { id: 'S1', featureId: 'F4', callout: 'cylindricity', toleranceMm: 0.02 },
    ]);
    expect(p.totalTimeSec).toBeGreaterThan(0);
  });

  it('reports datumSetupCount', () => {
    const p = generateInspectionPlan([datumA, datumB, hole1], []);
    expect(p.datumSetupCount).toBe(2);
  });

  it('operations sequence is monotonic', () => {
    const p = generateInspectionPlan([datumA, datumB, hole1, cylinder1], [
      { id: 'S1', featureId: 'F3', callout: 'position', toleranceMm: 0.1, datumRefs: ['A', 'B'] },
      { id: 'S2', featureId: 'F4', callout: 'cylindricity', toleranceMm: 0.02 },
      { id: 'S3', featureId: 'F1', callout: 'flatness', toleranceMm: 0.05 },
    ]);
    for (let i = 1; i < p.operations.length; i++) {
      expect(p.operations[i]!.sequence).toBe(p.operations[i - 1]!.sequence + 1);
    }
  });
});

describe('estimateInspectionCostUsd', () => {
  it('cost = (totalSec / 3600) × rate', () => {
    const plan = { totalTimeSec: 3600 } as { totalTimeSec: number; totalTouches: number; datumSetupCount: number; operations: []; warnings: string[] };
    expect(estimateInspectionCostUsd(plan as never, 100)).toBeCloseTo(100, 6);
  });

  it('default rate $80/hr', () => {
    const plan = { totalTimeSec: 1800 } as never;
    expect(estimateInspectionCostUsd(plan, 80)).toBeCloseTo(40, 6);
  });
});
