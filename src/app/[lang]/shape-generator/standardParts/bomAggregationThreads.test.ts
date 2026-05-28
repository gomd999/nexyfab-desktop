/**
 * bomAggregationThreads.test.ts — Wave 2 Phase 2 Track D Week 8 (D8).
 *
 * Thread-specific BOM roll-up coverage. Mirrors `bomAggregation.test.ts`
 * pattern (the fastener/bearing aggregator) — covers grouping rules, mix
 * tracking, formatting, and helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateThreads,
  formatThreadBomBlock,
  uniqueTapDrills,
  totalTappingLengthMm,
  type ThreadBomLine,
} from './bomAggregationThreads';
import {
  makeThreadFeature,
  type ThreadFeature,
} from '../features/threads/threadFeature';

function thread(
  id: string,
  designation: string,
  overrides: Partial<ThreadFeature> = {},
): ThreadFeature {
  return makeThreadFeature({
    id,
    threadRef: {
      series: overrides.threadRef?.series ?? 'ISO_M_COARSE',
      designation,
    },
    length: overrides.length ?? 20,
    class: overrides.class,
    threadDirection: overrides.threadDirection,
    threadKind: overrides.threadKind,
    mode: overrides.mode,
  });
}

describe('aggregateThreads — basic grouping', () => {
  it('collapses identical (series, designation, class, direction) into a single line', () => {
    const out = aggregateThreads([
      thread('a', 'M8'),
      thread('b', 'M8'),
      thread('c', 'M8'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.count).toBe(3);
    expect(out[0]!.totalLength).toBe(60);
    expect(out[0]!.tapDrillMm).toBe(6.8);
  });

  it('keeps different designations as separate lines', () => {
    const out = aggregateThreads([
      thread('a', 'M8'),
      thread('b', 'M10'),
    ]);
    expect(out).toHaveLength(2);
    const m8 = out.find((l) => l.designation === 'M8');
    const m10 = out.find((l) => l.designation === 'M10');
    expect(m8?.count).toBe(1);
    expect(m10?.count).toBe(1);
  });

  it('keeps different classes as separate lines by default', () => {
    const out = aggregateThreads([
      thread('a', 'M8', { class: '6H' }),
      thread('b', 'M8', { class: '7H' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('collapseClasses option folds different classes within same designation', () => {
    const out = aggregateThreads(
      [thread('a', 'M8', { class: '6H' }), thread('b', 'M8', { class: '7H' })],
      { collapseClasses: true },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.count).toBe(2);
    // classDistribution preserves the pre-collapse counts.
    expect(out[0]!.classDistribution).toEqual({ '6H': 1, '7H': 1 });
  });

  it('keeps LH and RH separate by default; collapseDirection folds them', () => {
    const lh = thread('a', 'M8', { threadDirection: 'left_hand' });
    const rh = thread('b', 'M8', { threadDirection: 'right_hand' });
    const separate = aggregateThreads([lh, rh]);
    expect(separate).toHaveLength(2);

    const collapsed = aggregateThreads([lh, rh], { collapseDirection: true });
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]!.count).toBe(2);
    expect(collapsed[0]!.directionMix).toEqual({ right: 1, left: 1 });
  });
});

describe('aggregateThreads — series sort + mix tracking', () => {
  it('sorts output by series order (ISO → UTS → NPT → BSP) then by designation', () => {
    const out = aggregateThreads([
      thread('bsp', 'G 1/4', { threadRef: { series: 'BSP_PARALLEL', designation: 'G 1/4' } }),
      thread('npt', 'NPT 1/2', { threadRef: { series: 'NPT', designation: 'NPT 1/2' } }),
      thread('unc', '1/4-20 UNC', { threadRef: { series: 'UNC', designation: '1/4-20 UNC' } }),
      thread('iso', 'M8'),
    ]);
    expect(out.map((l) => l.series)).toEqual([
      'ISO_M_COARSE',
      'UNC',
      'NPT',
      'BSP_PARALLEL',
    ]);
  });

  it('tracks modeMix only when both cosmetic and geometric appear in the group', () => {
    const cos = thread('a', 'M8', { mode: 'cosmetic' });
    const geo = thread('b', 'M8', { mode: 'geometric' });
    const out = aggregateThreads([cos, geo]);
    expect(out).toHaveLength(1);
    expect(out[0]!.modeMix).toEqual({ cosmetic: 1, geometric: 1 });
  });

  it('omits modeMix when all features are cosmetic (the common case)', () => {
    const out = aggregateThreads([thread('a', 'M8'), thread('b', 'M8')]);
    expect(out[0]!.modeMix).toBeUndefined();
  });

  it('tracks kindMix only when external threads appear in the group', () => {
    const out = aggregateThreads([
      thread('a', 'M8', { threadKind: 'internal' }),
      thread('b', 'M8', { threadKind: 'external', class: '6g' }),
    ], { collapseClasses: true });
    expect(out[0]!.kindMix).toEqual({ internal: 1, external: 1 });
  });

  it('omits kindMix when all features are internal', () => {
    const out = aggregateThreads([thread('a', 'M8'), thread('b', 'M8')]);
    expect(out[0]!.kindMix).toBeUndefined();
  });

  it('aggregates totalLength correctly across mixed lengths', () => {
    const out = aggregateThreads([
      thread('a', 'M8', { length: 20 }),
      thread('b', 'M8', { length: 15.5 }),
      thread('c', 'M8', { length: 0 }),
    ]);
    expect(out[0]!.totalLength).toBe(35.5);
  });
});

describe('aggregateThreads — edge cases', () => {
  it('empty input returns an empty list', () => {
    expect(aggregateThreads([])).toEqual([]);
  });

  it('handles a single feature', () => {
    const out = aggregateThreads([thread('a', 'M8')]);
    expect(out).toHaveLength(1);
    expect(out[0]!.count).toBe(1);
  });

  it('does not mutate the input array', () => {
    const input = [thread('a', 'M8'), thread('b', 'M8')];
    const before = input.map((f) => f.id);
    aggregateThreads(input);
    expect(input.map((f) => f.id)).toEqual(before);
  });
});

describe('formatThreadBomBlock', () => {
  it('emits the spec §12.3 header + body shape', () => {
    const lines: ThreadBomLine[] = aggregateThreads([
      thread('a', 'M8'),
      thread('b', 'M8'),
      thread('c', 'M10'),
    ]);
    const block = formatThreadBomBlock(lines);
    expect(block).toContain('THREAD OPERATIONS');
    expect(block).toContain('M8 - 6H × 2');
    expect(block).toContain('M10 - 6H × 1');
    expect(block).toContain('(tap drill Ø6.80)');
    expect(block).toContain('(tap drill Ø8.50)');
  });

  it('omits the class suffix for NPT (taper-class only)', () => {
    const lines = aggregateThreads([
      thread('a', 'NPT 1/2', { threadRef: { series: 'NPT', designation: 'NPT 1/2' } }),
    ]);
    const block = formatThreadBomBlock(lines);
    expect(block).toMatch(/NPT 1\/2 × 1/);
    expect(block).not.toMatch(/NPT 1\/2 - A/);
  });

  it('returns empty string when no lines', () => {
    expect(formatThreadBomBlock([])).toBe('');
  });
});

describe('helpers — uniqueTapDrills + totalTappingLengthMm', () => {
  it('uniqueTapDrills returns sorted distinct values', () => {
    const lines = aggregateThreads([
      thread('a', 'M8'),
      thread('b', 'M10'),
      thread('c', 'M8'),
    ]);
    expect(uniqueTapDrills(lines)).toEqual([6.8, 8.5]);
  });

  it('totalTappingLengthMm sums every line', () => {
    const lines = aggregateThreads([
      thread('a', 'M8', { length: 20 }),
      thread('b', 'M10', { length: 15 }),
    ]);
    expect(totalTappingLengthMm(lines)).toBe(35);
  });
});
