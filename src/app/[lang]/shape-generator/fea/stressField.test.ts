import { describe, it, expect } from 'vitest';
import {
  statisticsOf,
  hotspotsOf,
  interpolateAt,
  validateStressField,
  type StressField,
} from './stressField';

function makeField(vonMises: number[]): StressField {
  return {
    vertexCount: vonMises.length,
    vonMises: new Float32Array(vonMises),
    displacement: new Float32Array(vonMises.length * 3),
  };
}

describe('statisticsOf', () => {
  it('computes min / max / mean / p95 over valid values', () => {
    const stats = statisticsOf(makeField([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]));
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(100);
    expect(stats.mean).toBe(55);
    // p95 of 10 sorted values picks index 8 (zero-indexed floor(0.95*10)-1=8) → 90.
    expect(stats.p95).toBe(90);
  });

  it('excludes NaN / Infinity from mean + p95, counts in invalidCount', () => {
    const stats = statisticsOf(makeField([1, NaN, 3, Infinity, 5]));
    expect(stats.invalidCount).toBe(2);
    expect(stats.mean).toBeCloseTo((1 + 3 + 5) / 3, 4);
    expect(stats.max).toBe(5);
    expect(stats.min).toBe(1);
  });

  it('returns zeros for an all-invalid field', () => {
    const stats = statisticsOf(makeField([NaN, NaN]));
    expect(stats.max).toBe(0);
    expect(stats.mean).toBe(0);
    expect(stats.invalidCount).toBe(2);
  });
});

describe('hotspotsOf', () => {
  it('returns top-N by stress, descending', () => {
    const hots = hotspotsOf(makeField([10, 50, 20, 80, 30, 90]), 3);
    expect(hots.map(h => h.stress)).toEqual([90, 80, 50]);
    expect(hots.map(h => h.vertexIndex)).toEqual([5, 3, 1]);
  });

  it('ignores NaN entries', () => {
    const hots = hotspotsOf(makeField([NaN, 50, NaN, 80]), 5);
    expect(hots).toHaveLength(2);
    expect(hots[0].stress).toBe(80);
  });

  it('returns at most `count` items even when N < count', () => {
    const hots = hotspotsOf(makeField([1, 2, 3]), 10);
    expect(hots).toHaveLength(3);
  });

  it('handles count = 0 gracefully', () => {
    expect(hotspotsOf(makeField([1, 2, 3]), 0)).toEqual([]);
  });
});

describe('interpolateAt', () => {
  it('returns exact vertex value at corners', () => {
    const f = makeField([10, 20, 30]);
    expect(interpolateAt(f, [0, 1, 2], [1, 0, 0])).toBe(10);
    expect(interpolateAt(f, [0, 1, 2], [0, 1, 0])).toBe(20);
    expect(interpolateAt(f, [0, 1, 2], [0, 0, 1])).toBe(30);
  });

  it('linearly blends at centre', () => {
    const f = makeField([0, 30, 60]);
    expect(interpolateAt(f, [0, 1, 2], [1 / 3, 1 / 3, 1 / 3])).toBeCloseTo(30, 5);
  });

  it('NaN at any vertex → NaN result', () => {
    const f = makeField([10, NaN, 30]);
    expect(Number.isNaN(interpolateAt(f, [0, 1, 2], [0.5, 0.25, 0.25]))).toBe(true);
  });
});

describe('validateStressField', () => {
  it('passes a well-formed field', () => {
    const r = validateStressField(makeField([1, 2, 3]), 3);
    expect(r.ok).toBe(true);
    expect(r.invalidFraction).toBe(0);
  });

  it('fails on vertexCount mismatch', () => {
    const r = validateStressField(makeField([1, 2, 3]), 5);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('vertexCount mismatch');
  });

  it('fails on vonMises array length mismatch', () => {
    const field: StressField = {
      vertexCount: 3,
      vonMises: new Float32Array([1, 2]), // length 2, not 3
      displacement: new Float32Array(9),
    };
    const r = validateStressField(field, 3);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('vonMises length');
  });

  it('fails on displacement array length mismatch', () => {
    const field: StressField = {
      vertexCount: 3,
      vonMises: new Float32Array(3),
      displacement: new Float32Array(5), // should be 9
    };
    const r = validateStressField(field, 3);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('displacement length');
  });

  it('fails when invalid fraction exceeds threshold', () => {
    const r = validateStressField(makeField([1, NaN, NaN, NaN]), 4, 0.5); // 75% invalid > 50%
    expect(r.ok).toBe(false);
    expect(r.invalidFraction).toBeCloseTo(0.75, 3);
  });

  it('reports invalidFraction even on pass', () => {
    const r = validateStressField(makeField([1, 2, NaN, 4]), 4, 0.5); // 25% invalid ≤ 50%
    expect(r.ok).toBe(true);
    expect(r.invalidFraction).toBe(0.25);
  });
});
