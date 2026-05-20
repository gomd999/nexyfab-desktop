import { describe, it, expect } from 'vitest';
import {
  buildChartData,
  classifyImpact,
  summarize,
  type BOMLineDiff,
} from './bomCompareChartData';

function line(pn: string, kind: BOMLineDiff['kind'], oldQty: number, newQty: number, oldUp: number, newUp: number, cat: string = 'fastener'): BOMLineDiff {
  return {
    partNumber: pn,
    category: cat,
    kind,
    oldQty,
    newQty,
    oldUnitPriceUsd: oldUp,
    newUnitPriceUsd: newUp,
  };
}

describe('buildChartData', () => {
  it('empty input → zeros', () => {
    const d = buildChartData([]);
    expect(d.kindCounts.added).toBe(0);
    expect(d.netCostDeltaUsd).toBe(0);
    expect(d.waterfall).toEqual([]);
  });

  it('counts kind frequencies', () => {
    const lines: BOMLineDiff[] = [
      line('a', 'added', 0, 10, 0, 2),
      line('b', 'removed', 5, 0, 1, 0),
      line('c', 'quantity-changed', 5, 10, 1, 1),
    ];
    const d = buildChartData(lines);
    expect(d.kindCounts.added).toBe(1);
    expect(d.kindCounts.removed).toBe(1);
    expect(d.kindCounts['quantity-changed']).toBe(1);
  });

  it('net cost delta sums signed deltas', () => {
    const lines: BOMLineDiff[] = [
      line('a', 'added', 0, 10, 0, 2),       // +20
      line('b', 'removed', 5, 0, 1, 0),      // -5
    ];
    const d = buildChartData(lines);
    expect(d.netCostDeltaUsd).toBeCloseTo(15, 5);
  });

  it('gross movement = sum of |delta|', () => {
    const lines: BOMLineDiff[] = [
      line('a', 'added', 0, 10, 0, 2),
      line('b', 'removed', 5, 0, 1, 0),
    ];
    const d = buildChartData(lines);
    expect(d.grossMovementUsd).toBeCloseTo(25, 5);
  });

  it('category slices aggregate by category', () => {
    const lines: BOMLineDiff[] = [
      line('a', 'added', 0, 10, 0, 2, 'fastener'),
      line('b', 'added', 0, 5, 0, 1, 'fastener'),
      line('c', 'added', 0, 1, 0, 100, 'bearing'),
    ];
    const d = buildChartData(lines);
    expect(d.categorySlices).toHaveLength(2);
    const bearing = d.categorySlices.find(c => c.category === 'bearing');
    expect(bearing!.totalCostDeltaUsd).toBe(100);
  });

  it('waterfall is monotonically positive then negative', () => {
    const lines: BOMLineDiff[] = [
      line('a', 'price-changed', 5, 5, 1, 3),  // +10
      line('b', 'price-changed', 2, 2, 5, 3),  // -4
      line('c', 'added', 0, 1, 0, 5),          // +5
    ];
    const d = buildChartData(lines);
    expect(d.waterfall[0]!.deltaUsd).toBeGreaterThan(0);
    expect(d.waterfall[d.waterfall.length - 1]!.deltaUsd).toBeLessThanOrEqual(0);
  });

  it('cumulative equals final net delta', () => {
    const lines: BOMLineDiff[] = [
      line('a', 'price-changed', 5, 5, 1, 3),
      line('b', 'price-changed', 2, 2, 5, 3),
    ];
    const d = buildChartData(lines);
    const cum = d.waterfall[d.waterfall.length - 1]!.cumulativeUsd;
    expect(cum).toBeCloseTo(d.netCostDeltaUsd, 5);
  });

  it('topDrivers sorted by absolute delta', () => {
    const lines: BOMLineDiff[] = [
      line('a', 'price-changed', 1, 1, 1, 11),
      line('b', 'price-changed', 1, 1, 100, 101),
    ];
    const d = buildChartData(lines);
    expect(d.topDrivers[0]!.partNumber).toBe('a');
  });

  it('topN limit respected', () => {
    const lines: BOMLineDiff[] = Array.from({ length: 20 }, (_, i) =>
      line(`p${i}`, 'price-changed', 1, 1, 1, 2),
    );
    const d = buildChartData(lines, { topN: 5 });
    expect(d.topDrivers).toHaveLength(5);
  });

  it('unchanged lines contribute zero delta', () => {
    const lines: BOMLineDiff[] = [line('a', 'unchanged', 5, 5, 1, 1)];
    const d = buildChartData(lines);
    expect(d.netCostDeltaUsd).toBe(0);
    expect(d.waterfall).toEqual([]);
  });
});

describe('classifyImpact', () => {
  it('empty → neutral', () => {
    const d = buildChartData([]);
    expect(classifyImpact(d)).toBe('neutral');
  });

  it('only price increases → cost-up', () => {
    const d = buildChartData([line('a', 'price-changed', 1, 1, 1, 2)]);
    expect(classifyImpact(d)).toBe('cost-up');
  });

  it('only price decreases → cost-down', () => {
    const d = buildChartData([line('a', 'price-changed', 1, 1, 2, 1)]);
    expect(classifyImpact(d)).toBe('cost-down');
  });

  it('equal positive + negative → high-volatility', () => {
    const d = buildChartData([
      line('a', 'price-changed', 1, 1, 1, 100),
      line('b', 'price-changed', 1, 1, 100, 1),
    ]);
    expect(classifyImpact(d)).toBe('high-volatility');
  });
});

describe('summarize', () => {
  it('empty input', () => {
    const s = summarize(buildChartData([]));
    expect(s.lineCount).toBe(0);
    expect(s.topDriverPart).toBe('');
  });

  it('reports line count and category count', () => {
    const lines: BOMLineDiff[] = [
      line('a', 'added', 0, 1, 0, 1, 'fastener'),
      line('b', 'added', 0, 1, 0, 1, 'bearing'),
    ];
    const s = summarize(buildChartData(lines));
    expect(s.lineCount).toBe(2);
    expect(s.categoryCount).toBe(2);
  });

  it('top driver reported when delta exists', () => {
    const d = buildChartData([line('p', 'price-changed', 1, 1, 1, 5)]);
    const s = summarize(d);
    expect(s.topDriverPart).toBe('p');
    expect(s.topDriverDeltaUsd).toBeCloseTo(4, 5);
  });
});
