import { describe, it, expect } from 'vitest';
import { estimate, costPerUnit, compareModes, summarize, type FreightCostInput } from './freightCost';

const base: FreightCostInput = {
  mode: 'air', actualWeightKg: 20, volumeCm3: 150000,
};

describe('estimate', () => {
  it('dim weight = volume / dimFactor', () => {
    const r = estimate(base);
    expect(r.dimWeightKg).toBeCloseTo(150000 / 5000, 5);
  });

  it('billable = max(actual, dim)', () => {
    const r = estimate(base);
    expect(r.billableWeightKg).toBeCloseTo(Math.max(20, 30), 5);
    expect(r.dimWeighted).toBe(true);
  });

  it('actual governs for dense cargo', () => {
    const r = estimate({ ...base, actualWeightKg: 100, volumeCm3: 50000 });
    expect(r.dimWeighted).toBe(false);
    expect(r.billableWeightKg).toBeCloseTo(100, 5);
  });

  it('fuel surcharge applied', () => {
    const r = estimate(base);
    expect(r.fuelSurcharge).toBeCloseTo(r.baseFreight * 0.18, 5);
  });

  it('insurance from value', () => {
    const r = estimate({ ...base, insuranceValueAmount: 10000, insuranceRate: 0.005 });
    expect(r.insurance).toBeCloseTo(50, 4);
  });

  it('air more expensive than sea per kg', () => {
    const air = estimate({ ...base, mode: 'air' });
    const sea = estimate({ ...base, mode: 'sea-lcl' });
    expect(air.totalCost).toBeGreaterThan(sea.totalCost);
  });

  it('total = base + fuel + insurance + handling', () => {
    const r = estimate({ ...base, handlingFee: 25, insuranceValueAmount: 1000 });
    expect(r.totalCost).toBeCloseTo(r.baseFreight + r.fuelSurcharge + r.insurance + r.handling, 5);
  });

  it('unknown mode → warning', () => {
    expect(estimate({ ...base, mode: 'XYZ' as never }).warnings.length).toBeGreaterThan(0);
  });
});

describe('costPerUnit', () => {
  it('total / units', () => {
    const r = estimate(base);
    expect(costPerUnit(r, 10)).toBeCloseTo(r.totalCost / 10, 6);
  });
});

describe('compareModes', () => {
  it('sorted ascending', () => {
    const r = compareModes(20, 150000, ['air', 'road', 'sea-lcl']);
    for (let i = 1; i < r.length; i++) expect(r[i]!.totalCost).toBeGreaterThanOrEqual(r[i - 1]!.totalCost);
  });
});

describe('summarize', () => {
  it('reports billable + total', () => {
    const r = estimate(base);
    const s = summarize(r);
    expect(s.billableWeightKg).toBe(r.billableWeightKg);
    expect(s.totalCost).toBe(r.totalCost);
  });
});
