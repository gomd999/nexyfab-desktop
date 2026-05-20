import { describe, it, expect } from 'vitest';
import {
  buildOverlay,
  aggregate,
  topConsumers,
  summarize,
  type DimensionTol,
  type StackBudget,
} from './toleranceBudgetOverlay';

function dim(id: string, plus: number, minus: number, sens: number = 1): DimensionTol {
  return { dimensionId: id, textPosition: { x: 0, y: 0 }, plusMm: plus, minusMm: minus, sensitivity: sens };
}

const stack: StackBudget = { totalBudgetMm: 1, consumedMm: 0.6 };

describe('buildOverlay', () => {
  it('empty input → empty', () => {
    expect(buildOverlay([], stack)).toEqual([]);
  });

  it('low contribution → green', () => {
    const ov = buildOverlay([dim('a', 0.05, 0.05)], stack);
    expect(ov[0]!.colour).toBe('green');
  });

  it('mid contribution → yellow', () => {
    const ov = buildOverlay([dim('a', 0.3, 0.3)], stack);
    expect(ov[0]!.colour).toBe('yellow');
  });

  it('high contribution → red', () => {
    const ov = buildOverlay([dim('a', 0.5, 0.5)], stack);
    expect(ov[0]!.colour).toBe('red');
  });

  it('barWidth proportional to fraction', () => {
    const small = buildOverlay([dim('a', 0.05, 0.05)], stack);
    const big = buildOverlay([dim('b', 0.5, 0.5)], stack);
    expect(big[0]!.barWidthMm).toBeGreaterThan(small[0]!.barWidthMm);
  });

  it('bar width capped at maxBarWidthMm', () => {
    const ov = buildOverlay([dim('a', 10, 10)], stack, { maxBarWidthMm: 30, annotationOffsetMm: 5, yellowThreshold: 0.5, redThreshold: 0.8 });
    expect(ov[0]!.barWidthMm).toBeLessThanOrEqual(30);
  });

  it('zero budget → green default', () => {
    const ov = buildOverlay([dim('a', 0.5, 0.5)], { totalBudgetMm: 0, consumedMm: 0 });
    expect(ov[0]!.colour).toBe('green');
    expect(ov[0]!.budgetFraction).toBe(0);
  });

  it('sensitivity scales contribution', () => {
    const lowS = buildOverlay([dim('a', 0.1, 0.1, 1)], stack);
    const highS = buildOverlay([dim('b', 0.1, 0.1, 5)], stack);
    expect(highS[0]!.budgetFraction).toBeGreaterThan(lowS[0]!.budgetFraction);
  });

  it('text shows ± format when plus = minus', () => {
    const ov = buildOverlay([dim('a', 0.1, 0.1)], stack);
    expect(ov[0]!.text).toContain('±');
  });
});

describe('aggregate', () => {
  it('counts colours', () => {
    const ov = buildOverlay([
      dim('green', 0.05, 0.05),
      dim('yellow', 0.3, 0.3),
      dim('red', 0.5, 0.5),
    ], stack);
    const agg = aggregate(ov);
    expect(agg.greenCount).toBe(1);
    expect(agg.yellowCount).toBe(1);
    expect(agg.redCount).toBe(1);
  });
});

describe('topConsumers', () => {
  it('returns top N by fraction', () => {
    const ov = buildOverlay([
      dim('big', 0.5, 0.5),
      dim('small', 0.05, 0.05),
      dim('mid', 0.3, 0.3),
    ], stack);
    const top = topConsumers(ov, 2);
    expect(top[0]!.dimensionId).toBe('big');
    expect(top).toHaveLength(2);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const ov = buildOverlay([dim('a', 0.05, 0.05), dim('b', 0.5, 0.5)], stack);
    const s = summarize(ov);
    expect(s.dimensionCount).toBe(2);
    expect(s.redCount).toBeGreaterThanOrEqual(0);
  });

  it('worstFraction reflects most-consumed', () => {
    const ov = buildOverlay([dim('a', 0.05, 0.05), dim('b', 0.5, 0.5)], stack);
    expect(summarize(ov).worstFraction).toBeGreaterThan(0.5);
  });
});
