import { describe, it, expect } from 'vitest';
import {
  analyzeFLD,
  computeFLC0,
  flcAt,
  sampleFLDCurve,
  estimateThinning,
  summarize,
  type StrainPoint,
} from './formingLimitDiagram';

describe('analyzeFLD', () => {
  it('empty input → zero counts', () => {
    const r = analyzeFLD([]);
    expect(r.points).toEqual([]);
    expect(r.zoneCounts).toEqual({ safe: 0, marginal: 0, fail: 0 });
  });

  it('low strains → safe zone', () => {
    const pts: StrainPoint[] = [{ major: 0.05, minor: 0.02 }];
    const r = analyzeFLD(pts);
    expect(r.points[0]!.zone).toBe('safe');
  });

  it('very high strains → fail zone', () => {
    const pts: StrainPoint[] = [{ major: 0.9, minor: 0.4 }];
    const r = analyzeFLD(pts);
    expect(r.points[0]!.zone).toBe('fail');
  });

  it('zone counts sum to input length', () => {
    const pts: StrainPoint[] = [
      { major: 0.05, minor: 0.02 },
      { major: 0.3, minor: 0.1 },
      { major: 0.9, minor: 0.4 },
    ];
    const r = analyzeFLD(pts);
    expect(r.zoneCounts.safe + r.zoneCounts.marginal + r.zoneCounts.fail).toBe(3);
  });

  it('positive minor strain increases limit', () => {
    const a = analyzeFLD([{ major: 0.3, minor: 0 }]);
    const b = analyzeFLD([{ major: 0.3, minor: 0.3 }]);
    expect(b.points[0]!.limitMajorPercent).toBeGreaterThan(a.points[0]!.limitMajorPercent);
  });

  it('thicker sheet → higher FLC0', () => {
    const thin = analyzeFLD([{ major: 0, minor: 0 }], { thicknessMm: 0.5 });
    const thick = analyzeFLD([{ major: 0, minor: 0 }], { thicknessMm: 2.0 });
    expect(thick.flc0Percent).toBeGreaterThan(thin.flc0Percent);
  });

  it('records limit and margin', () => {
    const r = analyzeFLD([{ major: 0.1, minor: 0 }]);
    expect(r.points[0]!.limitMajorPercent).toBeGreaterThan(0);
    expect(typeof r.points[0]!.marginPoints).toBe('number');
  });
});

describe('computeFLC0', () => {
  it('higher n → higher FLC0', () => {
    expect(computeFLC0(1.0, 0.3)).toBeGreaterThan(computeFLC0(1.0, 0.15));
  });

  it('clamps thickness above 3.0', () => {
    expect(computeFLC0(5.0, 0.22)).toBeCloseTo(computeFLC0(3.0, 0.22), 3);
  });

  it('clamps thickness below 0.3', () => {
    expect(computeFLC0(0.1, 0.22)).toBeCloseTo(computeFLC0(0.3, 0.22), 3);
  });
});

describe('flcAt', () => {
  it('at minor=0 returns FLC0', () => {
    expect(flcAt(0, 40)).toBeCloseTo(40, 5);
  });

  it('positive minor strain → higher limit', () => {
    expect(flcAt(0.3, 40)).toBeGreaterThan(40);
  });

  it('negative minor strain → lower limit (with floor)', () => {
    expect(flcAt(-0.2, 40)).toBeLessThan(40);
  });

  it('large negative minor floors at 60% of FLC0', () => {
    expect(flcAt(-10, 40)).toBeCloseTo(40 * 0.6, 5);
  });
});

describe('sampleFLDCurve', () => {
  it('returns requested samples', () => {
    const curve = sampleFLDCurve(40, { min: -0.3, max: 0.3 }, 13);
    expect(curve).toHaveLength(13);
  });

  it('samples include endpoints', () => {
    const curve = sampleFLDCurve(40, { min: -0.3, max: 0.3 }, 10);
    expect(curve[0]!.minorStrain).toBeCloseTo(-0.3, 5);
    expect(curve[curve.length - 1]!.minorStrain).toBeCloseTo(0.3, 5);
  });
});

describe('estimateThinning', () => {
  it('zero strain → original thickness', () => {
    expect(estimateThinning({ major: 0, minor: 0 }, 1.0)).toBeCloseTo(1.0, 5);
  });

  it('positive strains thin the material', () => {
    expect(estimateThinning({ major: 0.3, minor: 0.1 }, 1.0)).toBeLessThan(1.0);
  });

  it('negative strains thicken the material', () => {
    expect(estimateThinning({ major: -0.2, minor: -0.1 }, 1.0)).toBeGreaterThan(1.0);
  });
});

describe('summarize', () => {
  it('empty result', () => {
    const r = analyzeFLD([]);
    const s = summarize(r);
    expect(s.totalPoints).toBe(0);
    expect(s.hasFailure).toBe(false);
  });

  it('reports fail fraction', () => {
    const r = analyzeFLD([
      { major: 0.05, minor: 0 },
      { major: 0.9, minor: 0.4 },
    ]);
    const s = summarize(r);
    expect(s.failFraction).toBe(0.5);
    expect(s.hasFailure).toBe(true);
  });

  it('worst margin is the minimum across all points', () => {
    const r = analyzeFLD([
      { major: 0.05, minor: 0 },
      { major: 0.5, minor: 0.2 },
    ]);
    const s = summarize(r);
    const minMargin = Math.min(...r.points.map(p => p.marginPoints));
    expect(s.worstMarginPoints).toBe(minMargin);
  });
});
