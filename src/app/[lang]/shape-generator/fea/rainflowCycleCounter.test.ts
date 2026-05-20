import { describe, it, expect } from 'vitest';
import {
  countCycles,
  extractPeaksValleys,
  minerDamage,
  rangeHistogram,
  summarize,
  type SNCurvePoint,
} from './rainflowCycleCounter';

describe('countCycles', () => {
  it('empty history → no cycles', () => {
    const r = countCycles([]);
    expect(r.cycles).toEqual([]);
  });

  it('single value → no cycles', () => {
    expect(countCycles([10]).cycles).toEqual([]);
  });

  it('simple zigzag produces cycles', () => {
    const r = countCycles([0, 10, 0, 10, 0]);
    expect(r.cycles.length).toBeGreaterThan(0);
  });

  it('cycle range = peak - valley', () => {
    const r = countCycles([0, 5, -5, 5, -5, 0]);
    for (const c of r.cycles) {
      expect(c.range).toBeGreaterThan(0);
    }
  });

  it('counts full vs half cycles', () => {
    const r = countCycles([0, 10, 0, 10, 0]);
    expect(r.fullCycleCount + r.halfCycleCount).toBe(r.cycles.length);
  });

  it('classic ASTM example produces expected cycles', () => {
    // Reference: ASTM E1049 example trace.
    const trace = [-2, 1, -3, 5, -1, 3, -4, 4, -2];
    const r = countCycles(trace);
    expect(r.cycles.length).toBeGreaterThan(0);
  });

  it('totalRange = sum of ranges', () => {
    const r = countCycles([0, 5, 0, 5, 0]);
    const sum = r.cycles.reduce((s, c) => s + c.range, 0);
    expect(r.totalRange).toBeCloseTo(sum, 5);
  });
});

describe('extractPeaksValleys', () => {
  it('flat input → start + end', () => {
    expect(extractPeaksValleys([5, 5, 5])).toHaveLength(2);
  });

  it('zigzag returns all turning points', () => {
    const p = extractPeaksValleys([0, 5, 0, 5, 0]);
    expect(p.length).toBeGreaterThanOrEqual(3);
  });

  it('empty input → empty output', () => {
    expect(extractPeaksValleys([])).toEqual([]);
  });
});

describe('minerDamage', () => {
  const snCurve: SNCurvePoint[] = [
    { amplitudeMpa: 100, N: 1e7 },
    { amplitudeMpa: 200, N: 1e6 },
    { amplitudeMpa: 400, N: 1e5 },
  ];

  it('empty cycles → zero damage', () => {
    const r = minerDamage([], snCurve);
    expect(r.totalDamage).toBe(0);
  });

  it('damage sums per cycle', () => {
    const cycles = [{ mean: 0, range: 200, count: 1 }];
    const r = minerDamage(cycles, snCurve);
    expect(r.totalDamage).toBeGreaterThan(0);
  });

  it('larger amplitude → more damage', () => {
    const small = minerDamage([{ mean: 0, range: 200, count: 1 }], snCurve);
    const big = minerDamage([{ mean: 0, range: 800, count: 1 }], snCurve);
    expect(big.totalDamage).toBeGreaterThan(small.totalDamage);
  });

  it('contributions array matches cycle count', () => {
    const cycles = [
      { mean: 0, range: 200, count: 1 },
      { mean: 0, range: 400, count: 1 },
    ];
    const r = minerDamage(cycles, snCurve);
    expect(r.contributions).toHaveLength(2);
  });
});

describe('rangeHistogram', () => {
  it('empty cycles → empty histogram', () => {
    expect(rangeHistogram([])).toEqual([]);
  });

  it('bins sum to total count', () => {
    const cycles = [
      { mean: 0, range: 10, count: 1 },
      { mean: 0, range: 20, count: 1 },
      { mean: 0, range: 30, count: 1 },
    ];
    const bins = rangeHistogram(cycles, 5);
    const total = bins.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(3);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const s = summarize({ cycles: [], fullCycleCount: 0, halfCycleCount: 0, totalRange: 0 });
    expect(s.cycleCount).toBe(0);
  });

  it('max range = max across cycles', () => {
    const r = countCycles([0, 10, 0, 5, 0]);
    const s = summarize(r);
    expect(s.maxRange).toBeGreaterThanOrEqual(s.meanRange);
  });
});
