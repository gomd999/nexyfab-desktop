import { describe, it, expect } from 'vitest';
import {
  diffResults,
  rollupByRegion,
  summarize,
  type ResultField,
} from './feaResultDiff';

function field(name: string, values: number[]): ResultField {
  return { fieldName: name, values };
}

describe('diffResults', () => {
  it('empty inputs → zero result', () => {
    const r = diffResults(field('stress', []), field('stress', []));
    expect(r.deltas).toEqual([]);
    expect(r.verdict).toBe('no-change');
  });

  it('identical fields → no-change verdict', () => {
    const r = diffResults(field('stress', [1, 2, 3]), field('stress', [1, 2, 3]));
    expect(r.verdict).toBe('no-change');
  });

  it('reduced stress → improved (lower-is-better)', () => {
    const r = diffResults(field('stress', [100, 80]), field('stress', [50, 40]));
    expect(r.verdict).toBe('improved');
  });

  it('increased stress → worse', () => {
    const r = diffResults(field('stress', [50, 40]), field('stress', [100, 80]));
    expect(r.verdict).toBe('worse');
  });

  it('higher-is-better inverts the verdict', () => {
    const r = diffResults(
      field('safety-factor', [2, 2]),
      field('safety-factor', [4, 4]),
      { goalDirection: 'higher-is-better' },
    );
    expect(r.verdict).toBe('improved');
  });

  it('topImproved sorted by largest improvement', () => {
    const r = diffResults(field('s', [100, 50, 200]), field('s', [10, 40, 5]));
    expect(r.topImproved.length).toBeGreaterThan(0);
    // Largest improvement = index 2 (drop from 200 to 5).
    expect(r.topImproved[0]!.index).toBe(2);
  });

  it('topWorsened sorted by largest worsening', () => {
    const r = diffResults(field('s', [10, 50]), field('s', [100, 200]));
    expect(r.topWorsened.length).toBeGreaterThan(0);
  });

  it('topK limits results', () => {
    const r = diffResults(
      field('s', [10, 20, 30, 40, 50]),
      field('s', [1, 2, 3, 4, 5]),
      { topK: 2 },
    );
    expect(r.topImproved.length).toBeLessThanOrEqual(2);
  });

  it('rmsDelta non-negative', () => {
    const r = diffResults(field('s', [1, 2]), field('s', [3, 4]));
    expect(r.rmsDelta).toBeGreaterThanOrEqual(0);
  });

  it('peaks computed', () => {
    const r = diffResults(field('s', [10, -50]), field('s', [60, -10]));
    expect(r.beforePeak).toBe(50);
    expect(r.afterPeak).toBe(60);
  });

  it('zero-threshold filters tiny deltas', () => {
    const r = diffResults(
      field('s', [10, 10]), field('s', [10.001, 10.001]),
      { noChangeThreshold: 1 },
    );
    expect(r.topImproved.length + r.topWorsened.length).toBe(0);
  });
});

describe('rollupByRegion', () => {
  it('groups by region', () => {
    const before = field('s', [10, 20, 30]);
    const after = field('s', [5, 25, 28]);
    const regions = new Map<number, string>([[0, 'R1'], [1, 'R1'], [2, 'R2']]);
    const stats = rollupByRegion(before, after, regions);
    expect(stats).toHaveLength(2);
  });

  it('per-region delta computed', () => {
    const before = field('s', [10, 20]);
    const after = field('s', [5, 10]);
    const regions = new Map<number, string>([[0, 'R'], [1, 'R']]);
    const stats = rollupByRegion(before, after, regions);
    expect(stats[0]!.delta).toBeCloseTo(-7.5, 5);
  });
});

describe('summarize', () => {
  it('peak reduction percent computed', () => {
    const r = diffResults(field('s', [100, 50]), field('s', [50, 25]));
    const s = summarize(r);
    expect(s.peakReductionPercent).toBeCloseTo(50, 1);
  });

  it('verdict forwarded', () => {
    const r = diffResults(field('s', [100]), field('s', [10]));
    const s = summarize(r);
    expect(s.verdict).toBe(r.verdict);
  });
});
