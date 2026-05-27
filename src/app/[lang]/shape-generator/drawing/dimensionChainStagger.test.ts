import { describe, it, expect } from 'vitest';
import {
  staggerChain,
  autoReflow,
  rowStatistics,
  summarize,
  type ChainDimension,
} from './dimensionChainStagger';

function dim(id: string, pos: number, w: number = 10): ChainDimension {
  return { id, axisPosition: pos, textWidthMm: w };
}

describe('staggerChain', () => {
  it('empty input → no placements', () => {
    const r = staggerChain([]);
    expect(r.placements).toEqual([]);
  });

  it('well-spaced dims fit on row 0', () => {
    const r = staggerChain([dim('a', 0), dim('b', 100), dim('c', 200)]);
    expect(r.placements.every(p => p.rowIndex === 0)).toBe(true);
  });

  it('close dims spread across rows', () => {
    const r = staggerChain([dim('a', 0), dim('b', 5), dim('c', 10)]);
    const rows = new Set(r.placements.map(p => p.rowIndex));
    expect(rows.size).toBeGreaterThan(1);
  });

  it('yOffset proportional to row index', () => {
    const r = staggerChain([dim('a', 0), dim('b', 5)], { rowCount: 2, rowSpacingMm: 4, minClearanceMm: 1 });
    expect(r.placements[1]!.yOffsetMm).toBe(4);
  });

  it('remainingConflicts 0 with sufficient rows', () => {
    const r = staggerChain([dim('a', 0), dim('b', 5), dim('c', 10)], { rowCount: 3, rowSpacingMm: 4, minClearanceMm: 1 });
    expect(r.remainingConflicts).toBe(0);
  });

  it('remainingConflicts > 0 when crowded', () => {
    const r = staggerChain([dim('a', 0), dim('b', 1), dim('c', 2)], { rowCount: 1, rowSpacingMm: 4, minClearanceMm: 1 });
    expect(r.remainingConflicts).toBeGreaterThan(0);
  });

  it('preserves order along axis', () => {
    const r = staggerChain([dim('c', 30), dim('a', 0), dim('b', 15)]);
    expect(r.placements[0]!.id).toBe('a');
  });
});

describe('autoReflow', () => {
  it('finds minimum rows that satisfy clearance', () => {
    const r = autoReflow([dim('a', 0), dim('b', 5), dim('c', 10)], { rowCount: 1, rowSpacingMm: 4, minClearanceMm: 1 });
    expect(r.remainingConflicts).toBe(0);
  });

  it('caps at 6 rows', () => {
    const dims = Array.from({ length: 20 }, (_, i) => dim(`d${i}`, i * 0.5));
    const r = autoReflow(dims);
    const rows = new Set(r.placements.map(p => p.rowIndex));
    expect(rows.size).toBeLessThanOrEqual(6);
  });
});

describe('rowStatistics', () => {
  it('aggregates per row', () => {
    const r = staggerChain([dim('a', 0), dim('b', 5)], { rowCount: 2, rowSpacingMm: 4, minClearanceMm: 1 });
    const stats = rowStatistics(r);
    expect(stats.length).toBeGreaterThan(0);
  });

  it('span 0 for single-dim rows', () => {
    const r = staggerChain([dim('a', 0)]);
    const stats = rowStatistics(r);
    expect(stats[0]!.span).toBe(0);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const r = staggerChain([dim('a', 0), dim('b', 50)]);
    const s = summarize(r);
    expect(s.dimensionCount).toBe(2);
    expect(s.rowsUsed).toBeGreaterThanOrEqual(1);
  });
});
