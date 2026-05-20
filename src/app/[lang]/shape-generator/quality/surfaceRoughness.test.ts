import { describe, it, expect } from 'vitest';
import {
  computeRoughness,
  isoGradeForRa,
  suggestProcessForRa,
  movingAverageFilter,
  roughnessAfterFilter,
  ISO_GRADE_TABLE,
} from './surfaceRoughness';

describe('computeRoughness', () => {
  it('flat profile has Ra = 0', () => {
    const r = computeRoughness({ heights: [5, 5, 5, 5], spacing: 0.1 });
    expect(r.ra).toBe(0);
    expect(r.rq).toBe(0);
    expect(r.rt).toBe(0);
  });

  it('symmetric sinusoid: Rq/Ra ≈ π/(2√2) ≈ 1.111', () => {
    const N = 1000;
    const heights = Array.from({ length: N }, (_, i) => Math.sin(2 * Math.PI * i / 50));
    const r = computeRoughness({ heights, spacing: 0.01 });
    expect(r.rq / r.ra).toBeCloseTo(Math.PI / (2 * Math.sqrt(2)), 1);
  });

  it('Rp + Rv = Rt for centered profile', () => {
    const heights = [-2, 1, -1, 3, -3, 0];
    const r = computeRoughness({ heights, spacing: 1 });
    expect(r.rp + r.rv).toBeCloseTo(r.rt, 6);
  });

  it('symmetric profile → skewness ≈ 0', () => {
    const heights = [-2, -1, 0, 1, 2, -2, -1, 0, 1, 2];
    const r = computeRoughness({ heights, spacing: 1 });
    expect(Math.abs(r.rsk)).toBeLessThan(0.1);
  });

  it('Rz averaged over 5 segments', () => {
    const heights = Array.from({ length: 100 }, (_, i) => i % 10);
    const r = computeRoughness({ heights, spacing: 1 });
    expect(r.rz).toBeGreaterThan(0);
  });

  it('traverse length = (n-1) × spacing', () => {
    const r = computeRoughness({ heights: [0, 1, 2, 3], spacing: 0.5 });
    expect(r.traverseLength).toBeCloseTo(1.5, 6);
  });

  it('zero crossings counted', () => {
    const heights = [-1, 1, -1, 1, -1];
    const r = computeRoughness({ heights, spacing: 1 });
    expect(r.zeroCrossings).toBe(4);
  });

  it('empty profile safe', () => {
    const r = computeRoughness({ heights: [], spacing: 1 });
    expect(r.ra).toBe(0);
    expect(r.traverseLength).toBe(0);
  });
});

describe('isoGradeForRa', () => {
  it('Ra 0.02 μm → N1 (smoothest grade)', () => {
    expect(isoGradeForRa(0.02)).toBe('N1');
  });

  it('Ra 1.5 μm → N7', () => {
    expect(isoGradeForRa(1.5)).toBe('N7');
  });

  it('Ra 100 μm → beyond range', () => {
    expect(isoGradeForRa(100)).toBe('beyond-N12');
  });

  it('grade table is monotonic in Ra', () => {
    for (let i = 1; i < ISO_GRADE_TABLE.length; i++) {
      expect(ISO_GRADE_TABLE[i]!.raMaxUm).toBeGreaterThan(ISO_GRADE_TABLE[i - 1]!.raMaxUm);
    }
  });
});

describe('suggestProcessForRa', () => {
  it('tight Ra 0.1 → only lapping / polishing pass', () => {
    const r = suggestProcessForRa(0.1);
    expect(r).toContain('lapping');
    expect(r).not.toContain('turning-rough');
  });

  it('loose Ra 50 → many processes pass', () => {
    const r = suggestProcessForRa(50);
    expect(r.length).toBeGreaterThan(5);
  });

  it('Ra 1.6 includes fine processes only', () => {
    const r = suggestProcessForRa(1.6);
    expect(r).toContain('grinding-fine');
    expect(r).not.toContain('sand-cast');
  });
});

describe('movingAverageFilter', () => {
  it('preserves length', () => {
    const f = movingAverageFilter({ heights: [1, 2, 3, 4, 5], spacing: 1 }, 3);
    expect(f.heights).toHaveLength(5);
  });

  it('removes high-frequency content', () => {
    const heights = [0, 10, 0, 10, 0, 10, 0, 10];
    const filtered = movingAverageFilter({ heights, spacing: 1 }, 5);
    // After 5-pt smoothing, oscillation amplitude drops sharply.
    const range = Math.max(...filtered.heights) - Math.min(...filtered.heights);
    expect(range).toBeLessThan(5);
  });

  it('window 1 = pass-through', () => {
    const original = [1, 2, 3];
    const f = movingAverageFilter({ heights: original, spacing: 1 }, 1);
    expect(f.heights).toEqual(original);
  });
});

describe('roughnessAfterFilter', () => {
  it('removes waviness from a tilted-line profile', () => {
    // Linear ramp = pure waviness; after filter, the residual should be near zero.
    const heights = Array.from({ length: 100 }, (_, i) => i * 0.1);
    const filtered = roughnessAfterFilter({ heights, spacing: 0.1 }, 25);
    // Middle of the filtered profile should be small (linear trend removed).
    expect(Math.abs(filtered.heights[50]!)).toBeLessThan(1);
  });
});
