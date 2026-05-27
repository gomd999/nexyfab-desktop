import { describe, it, expect } from 'vitest';
import {
  analyzeDistribution,
  computeCapability,
  compareBatches,
  summarize,
  type CycleRecord,
} from './cycleTimeDistribution';

function rec(id: string, duration: number, outcome?: CycleRecord['outcome']): CycleRecord {
  return { cycleId: id, durationSec: duration, ...(outcome !== undefined ? { outcome } : {}) };
}

describe('analyzeDistribution', () => {
  it('empty input → zeros', () => {
    const r = analyzeDistribution([]);
    expect(r.count).toBe(0);
    expect(r.meanSec).toBe(0);
  });

  it('mean = sum / count', () => {
    const r = analyzeDistribution([rec('a', 30), rec('b', 50)]);
    expect(r.meanSec).toBe(40);
  });

  it('std deviation correct for known data', () => {
    const r = analyzeDistribution([rec('a', 30), rec('b', 40), rec('c', 50)]);
    // mean=40, variance = ((30-40)²+0+(50-40)²)/3 = 200/3 ≈ 66.67, sd ≈ 8.16
    expect(r.stdDevSec).toBeCloseTo(Math.sqrt(200 / 3), 3);
  });

  it('p95 ≥ p75 ≥ median', () => {
    const records = Array.from({ length: 20 }, (_, i) => rec(`r${i}`, 30 + i));
    const r = analyzeDistribution(records);
    expect(r.p95Sec).toBeGreaterThanOrEqual(r.p75Sec);
    expect(r.p75Sec).toBeGreaterThanOrEqual(r.medianSec);
  });

  it('histogram bins sum to count', () => {
    const records = Array.from({ length: 20 }, (_, i) => rec(`r${i}`, 30 + i));
    const r = analyzeDistribution(records, { binCount: 5 });
    expect(r.histogram).toHaveLength(5);
    const total = r.histogram.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(20);
  });

  it('outlier detection at 2σ', () => {
    const normal = Array.from({ length: 20 }, () => rec('r', 30));
    const outlier = rec('big', 1000);
    const r = analyzeDistribution([...normal, outlier]);
    expect(r.outliers.some(o => o.cycleId === 'big')).toBe(true);
  });

  it('min and max', () => {
    const r = analyzeDistribution([rec('a', 10), rec('b', 100)]);
    expect(r.minSec).toBe(10);
    expect(r.maxSec).toBe(100);
  });
});

describe('computeCapability', () => {
  it('empty input → zero', () => {
    const c = computeCapability([], 30, 5);
    expect(c.cpk).toBe(0);
  });

  it('within-spec count correct', () => {
    const records = [rec('a', 30), rec('b', 35), rec('c', 40)];
    const c = computeCapability(records, 32, 4);
    expect(c.withinSpecCount).toBe(2);
  });

  it('yield fraction excludes scrap/rework', () => {
    const records = [
      rec('a', 30, 'ok'),
      rec('b', 30, 'scrap'),
    ];
    const c = computeCapability(records, 30, 5);
    expect(c.yieldFraction).toBe(0.5);
  });

  it('cpk positive for in-spec batch', () => {
    const records = Array.from({ length: 20 }, () => rec('r', 30));
    const c = computeCapability(records, 30, 5);
    expect(c.cpk).toBe(Infinity); // zero stddev → infinite
  });
});

describe('compareBatches', () => {
  it('improved yield when mean drops + stddev not worse', () => {
    const before = analyzeDistribution([rec('a', 40), rec('b', 45), rec('c', 50)]);
    const after = analyzeDistribution([rec('a', 35), rec('b', 40), rec('c', 45)]);
    const c = compareBatches(before, after);
    expect(c.improvedYield).toBe(true);
  });

  it('mean delta = after - before', () => {
    const before = analyzeDistribution([rec('a', 30)]);
    const after = analyzeDistribution([rec('a', 50)]);
    const c = compareBatches(before, after);
    expect(c.meanDelta).toBe(20);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const s = summarize(analyzeDistribution([]));
    expect(s.count).toBe(0);
  });

  it('consistent when CV < 10%', () => {
    const records = Array.from({ length: 20 }, () => rec('r', 30));
    const s = summarize(analyzeDistribution(records));
    expect(s.isConsistent).toBe(true);
  });

  it('outlier fraction reported', () => {
    const records = [
      ...Array.from({ length: 20 }, () => rec('r', 30)),
      rec('big', 1000),
    ];
    const s = summarize(analyzeDistribution(records));
    expect(s.outlierFraction).toBeGreaterThan(0);
  });
});
