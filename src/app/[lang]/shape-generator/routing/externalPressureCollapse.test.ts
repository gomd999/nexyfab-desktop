import { describe, it, expect } from 'vitest';
import { compute, longCylinderCollapseMpa, summarize, type ExternalPressureInput } from './externalPressureCollapse';

// Vacuum vessel: 1 m dia, 6 mm wall, steel.
const base: ExternalPressureInput = {
  outerDiameterMm: 1000, wallThicknessMm: 6, lengthMm: 6000,
  youngMpa: 200000, externalPressureMpa: 0.1,
};

describe('compute', () => {
  it('classifies long cylinder (L/D > 4)', () => {
    expect(compute(base).classification).toBe('long');
  });

  it('classifies short cylinder (L/D ≤ 4)', () => {
    expect(compute({ ...base, lengthMm: 2000 }).classification).toBe('short');
  });

  it('critical pressure ∝ (t/D)³', () => {
    const thin = compute({ ...base, wallThicknessMm: 4 });
    const thick = compute({ ...base, wallThicknessMm: 8 });
    expect(thick.criticalPressureMpa).toBeGreaterThan(thin.criticalPressureMpa);
  });

  it('allowable = critical / SF', () => {
    const r = compute({ ...base, safetyFactor: 3 });
    expect(r.allowablePressureMpa).toBeCloseTo(r.criticalPressureMpa / 3, 6);
  });

  it('thin wall under vacuum → inadequate + warning', () => {
    const r = compute({ ...base, wallThicknessMm: 2 });
    expect(r.adequate).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('short cylinder more resistant than long (same wall)', () => {
    const longC = compute({ ...base, lengthMm: 10000 });
    const shortC = compute({ ...base, lengthMm: 1000 });
    expect(shortC.criticalPressureMpa).toBeGreaterThan(longC.criticalPressureMpa);
  });

  it('min wall for design positive', () => {
    expect(compute(base).minWallForDesignMm).toBeGreaterThan(0);
  });

  it('collapse margin = allowable / design', () => {
    const r = compute(base);
    expect(r.collapseMargin).toBeCloseTo(r.allowablePressureMpa / 0.1, 5);
  });
});

describe('longCylinderCollapseMpa', () => {
  it('matches 2E/(1−ν²)·(t/D)³', () => {
    const expected = (2 * 200000 / (1 - 0.09)) * Math.pow(6 / 1000, 3);
    expect(longCylinderCollapseMpa(200000, 0.3, 6, 1000)).toBeCloseTo(expected, 6);
  });
});

describe('summarize', () => {
  it('reports allowable + adequacy', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.allowablePressureMpa).toBe(r.allowablePressureMpa);
    expect(s.adequate).toBe(r.adequate);
  });
});
