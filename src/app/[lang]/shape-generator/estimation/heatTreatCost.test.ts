import { describe, it, expect } from 'vitest';
import { estimate, batchEffect, summarize, type HeatTreatCostInput } from './heatTreatCost';

const base: HeatTreatCostInput = {
  process: 'through-harden', partMassKg: 2, partsPerBatch: 100,
  furnaceRatePerHour: 80, energyPricePerKWh: 0.15,
};

describe('estimate', () => {
  it('batch mass = part × count', () => {
    expect(estimate(base).batchMassKg).toBeCloseTo(2 * 100, 3);
  });

  it('furnace cost amortised over batch', () => {
    const r = estimate(base);
    expect(r.furnaceCostPerPart).toBeCloseTo((4 * 80) / 100, 4);
  });

  it('larger batch → lower per-part cost', () => {
    const small = estimate({ ...base, partsPerBatch: 20 });
    const big = estimate({ ...base, partsPerBatch: 500 });
    expect(big.totalCostPerPart).toBeLessThan(small.totalCostPerPart);
  });

  it('nitride has longer cycle than temper', () => {
    const nit = estimate({ ...base, process: 'nitride' });
    const tmp = estimate({ ...base, process: 'temper' });
    expect(nit.cycleHours).toBeGreaterThan(tmp.cycleHours);
  });

  it('anneal has no quench consumable', () => {
    expect(estimate({ ...base, process: 'anneal' }).quenchCostPerPart).toBe(0);
  });

  it('cycle override respected', () => {
    expect(estimate({ ...base, cycleHoursOverride: 10 }).cycleHours).toBe(10);
  });

  it('labour added when given', () => {
    const noL = estimate(base);
    const withL = estimate({ ...base, labourPerPart: 1 });
    expect(withL.totalCostPerPart).toBeCloseTo(noL.totalCostPerPart + 1, 5);
  });

  it('total = sum of components', () => {
    const r = estimate(base);
    expect(r.totalCostPerPart).toBeCloseTo(r.furnaceCostPerPart + r.energyCostPerPart + r.quenchCostPerPart, 6);
  });

  it('unknown process → warning', () => {
    expect(estimate({ ...base, process: 'XYZ' as never }).warnings.length).toBeGreaterThan(0);
  });
});

describe('batchEffect', () => {
  it('sorted ascending, bigger batch cheaper', () => {
    const r = batchEffect(base, [10, 50, 200]);
    expect(r[0]!.partsPerBatch).toBe(200);
  });
});

describe('summarize', () => {
  it('reports total + cycle', () => {
    const r = estimate(base);
    const s = summarize(r);
    expect(s.totalCostPerPart).toBe(r.totalCostPerPart);
    expect(s.cycleHours).toBe(r.cycleHours);
  });
});
