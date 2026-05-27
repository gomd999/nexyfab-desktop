import { describe, it, expect } from 'vitest';
import {
  resolveOverlaps,
  findRemainingOverlaps,
  summarize,
  type DimensionLabel,
} from './dimensionOverlapResolver';

function label(id: string, x: number, y: number, w: number = 20, h: number = 5, sx: number = 1, sy: number = 0): DimensionLabel {
  return {
    id,
    centre: { x, y },
    widthMm: w,
    heightMm: h,
    slideDirection: { x: sx, y: sy },
    canStagger: true,
    staggerOffsetMm: 8,
  };
}

describe('resolveOverlaps', () => {
  it('empty input → empty output', () => {
    expect(resolveOverlaps([])).toEqual([]);
  });

  it('non-overlapping labels stay put', () => {
    const labels = [label('a', 0, 0), label('b', 100, 0)];
    const r = resolveOverlaps(labels);
    expect(r[0]!.displacementMm).toBe(0);
    expect(r[1]!.displacementMm).toBe(0);
  });

  it('overlapping labels move apart', () => {
    const labels = [label('a', 0, 0), label('b', 5, 0)];
    const r = resolveOverlaps(labels);
    const newGap = Math.abs(r[1]!.newCentre.x - r[0]!.newCentre.x);
    expect(newGap).toBeGreaterThanOrEqual(20); // width
  });

  it('displacement is recorded', () => {
    const labels = [label('a', 0, 0), label('b', 5, 0)];
    const r = resolveOverlaps(labels);
    expect(r[0]!.displacementMm + r[1]!.displacementMm).toBeGreaterThan(0);
  });

  it('stack of 3 close labels resolves all overlaps', () => {
    const labels = [label('a', 0, 0), label('b', 5, 0), label('c', 10, 0)];
    const r = resolveOverlaps(labels);
    const remaining = findRemainingOverlaps(labels, r, 0.5);
    expect(remaining).toEqual([]);
  });

  it('respects clearance', () => {
    const labels = [label('a', 0, 0), label('b', 5, 0)];
    const r = resolveOverlaps(labels, { clearanceMm: 5, maxIterations: 100 });
    const newGap = Math.abs(r[1]!.newCentre.x - r[0]!.newCentre.x);
    expect(newGap).toBeGreaterThanOrEqual(20);
  });

  it('staggers when sliding fails', () => {
    // Many tightly clustered labels with limited slide direction
    const labels = Array.from({ length: 6 }, (_, i) => label(`l${i}`, i * 2, 0, 30, 5));
    const r = resolveOverlaps(labels, { clearanceMm: 1, maxIterations: 20 });
    expect(r.some(x => x.staggered)).toBe(true);
  });
});

describe('findRemainingOverlaps', () => {
  it('empty for non-overlapping', () => {
    const labels = [label('a', 0, 0), label('b', 100, 0)];
    const r = resolveOverlaps(labels);
    expect(findRemainingOverlaps(labels, r)).toEqual([]);
  });
});

describe('summarize', () => {
  it('counts staggered + displaced', () => {
    const labels = [label('a', 0, 0), label('b', 5, 0)];
    const r = resolveOverlaps(labels);
    const s = summarize(r);
    expect(s.labelCount).toBe(2);
    expect(s.resolvedCount).toBeGreaterThan(0);
  });

  it('maxDisplacement reported', () => {
    const labels = [label('a', 0, 0), label('b', 5, 0)];
    const r = resolveOverlaps(labels);
    const s = summarize(r);
    expect(s.maxDisplacementMm).toBeGreaterThan(0);
  });
});
