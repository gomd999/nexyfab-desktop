import { describe, it, expect } from 'vitest';
import {
  quoteBatch,
  sweepQuantities,
  compareQuotes,
  DEFAULT_SHOP_RATES,
  type PartQuoteRequest,
} from './batchQuoteService';

function part(id: string, qty: number, opts: Partial<PartQuoteRequest> = {}): PartQuoteRequest {
  return {
    partId: id,
    quantity: qty,
    unitCost: { materialUsd: 10, laborSec: 600, setupSec: 1800 },
    materialId: 'AL6061',
    machineId: 'mill1',
    leadTimeDays: 5,
    ...opts,
  };
}

describe('quoteBatch — empty', () => {
  it('empty parts → empty quote', () => {
    const q = quoteBatch([]);
    expect(q.lines).toHaveLength(0);
    expect(q.totalUsd).toBe(0);
  });
});

describe('quoteBatch — single part', () => {
  it('one part: line total = quantity × unit', () => {
    const q = quoteBatch([part('a', 1)]);
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0]!.quantity).toBe(1);
    expect(q.lines[0]!.unitCostAfterDiscountUsd).toBeCloseTo(q.lines[0]!.lineTotalUsd, 5);
  });

  it('quantity discount applies at 50 units', () => {
    const small = quoteBatch([part('a', 1)]);
    const big = quoteBatch([part('a', 50)]);
    expect(big.lines[0]!.discountMultiplier).toBeLessThan(small.lines[0]!.discountMultiplier);
  });
});

describe('quoteBatch — setup sharing', () => {
  it('two same-material/machine parts share setup', () => {
    const isolated = quoteBatch([part('a', 1, { machineId: 'mill1' })]);
    const isolatedB = quoteBatch([part('b', 1, { machineId: 'mill2' })]);
    const shared = quoteBatch([part('a', 1, { machineId: 'mill1' }), part('b', 1, { machineId: 'mill1' })]);
    expect(shared.setupSavingsUsd).toBeGreaterThan(0);
    expect(shared.totalUsd).toBeLessThan(isolated.totalUsd + isolatedB.totalUsd);
  });

  it('different machines → no shared setup', () => {
    const q = quoteBatch([part('a', 1, { machineId: 'mill1' }), part('b', 1, { machineId: 'mill2' })]);
    expect(q.setupSavingsUsd).toBe(0);
  });
});

describe('quoteBatch — discounts', () => {
  it('quantity discount savings reported', () => {
    const q = quoteBatch([part('a', 100)]);
    expect(q.quantityDiscountUsd).toBeGreaterThan(0);
  });

  it('discount tier picked from highest qualifying', () => {
    const q1 = quoteBatch([part('a', 99)]);
    const q2 = quoteBatch([part('a', 100)]);
    expect(q2.lines[0]!.discountMultiplier).toBeLessThanOrEqual(q1.lines[0]!.discountMultiplier);
  });
});

describe('quoteBatch — lead time', () => {
  it('lead time = max + margin', () => {
    const q = quoteBatch([
      part('a', 1, { leadTimeDays: 3 }),
      part('b', 1, { leadTimeDays: 7 }),
    ]);
    expect(q.leadTimeDays).toBe(7 + DEFAULT_SHOP_RATES.leadTimeMarginDays);
  });
});

describe('quoteBatch — totals', () => {
  it('raw total >= discounted total', () => {
    const q = quoteBatch([part('a', 100)]);
    expect(q.rawTotalUsd).toBeGreaterThan(q.totalUsd);
  });
});

describe('sweepQuantities', () => {
  it('produces one scenario per quantity', () => {
    const scenarios = sweepQuantities(part('a', 1), [1, 10, 100]);
    expect(scenarios).toHaveLength(3);
  });

  it('higher qty → lower unit cost', () => {
    const scenarios = sweepQuantities(part('a', 1), [1, 100]);
    expect(scenarios[1]!.unitCostUsd).toBeLessThan(scenarios[0]!.unitCostUsd);
  });
});

describe('compareQuotes', () => {
  it('returns per-part diff', () => {
    const a = quoteBatch([part('p1', 1), part('p2', 1)]);
    const b = quoteBatch([part('p1', 10), part('p2', 10)]);
    const c = compareQuotes(a, b);
    expect(c.perPartDiffs).toHaveLength(2);
  });

  it('total diff = sum of part diffs', () => {
    const a = quoteBatch([part('p1', 1)]);
    const b = quoteBatch([part('p1', 5)]);
    const c = compareQuotes(a, b);
    expect(c.totalDiffUsd).toBeCloseTo(c.perPartDiffs[0]!.diffUsd, 4);
  });
});
