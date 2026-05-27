import { describe, it, expect } from 'vitest';
import {
  estimate,
  cavityBreakeven,
  summarize,
  type MoldingPieceCostInput,
} from './moldingPieceCost';

const base: MoldingPieceCostInput = {
  cycleTimeSec: 30,
  cavities: 4,
  machineRatePerHour: 60,
  partMassG: 25,
  runnerMassG: 20,
  materialPricePerKg: 2.5,
};

describe('estimate', () => {
  it('machine cost per part = shot machine / cavities', () => {
    const r = estimate(base);
    const machinePerShot = (30 / 3600) * 60;
    expect(r.machineCostPerPart).toBeCloseTo(machinePerShot / 4, 6);
  });

  it('material cost includes part + runner share', () => {
    const r = estimate(base);
    const netG = 25 + 20 / 4;
    expect(r.materialCostPerPart).toBeCloseTo((netG / 1000) * 2.5, 6);
  });

  it('regrind reduces material cost', () => {
    const none = estimate({ ...base, regrindFraction: 0 });
    const recycled = estimate({ ...base, regrindFraction: 1 });
    expect(recycled.materialCostPerPart).toBeLessThan(none.materialCostPerPart);
  });

  it('more cavities → lower machine cost per part', () => {
    const few = estimate({ ...base, cavities: 1 });
    const many = estimate({ ...base, cavities: 8 });
    expect(many.machineCostPerPart).toBeLessThan(few.machineCostPerPart);
  });

  it('tool cost amortised over life', () => {
    const r = estimate({ ...base, toolCost: 40000, toolLifeParts: 100000 });
    expect(r.toolCostPerPart).toBeCloseTo(0.4, 6);
  });

  it('setup amortised over batch', () => {
    const r = estimate({ ...base, setupCost: 300, batchQuantity: 10000 });
    expect(r.setupCostPerPart).toBeCloseTo(0.03, 6);
  });

  it('scrap inflates total cost', () => {
    const clean = estimate({ ...base, scrapRatePercent: 0 });
    const scrappy = estimate({ ...base, scrapRatePercent: 10 });
    expect(scrappy.totalCostPerPart).toBeGreaterThan(clean.totalCostPerPart);
  });

  it('effective yield reflects scrap', () => {
    const r = estimate({ ...base, scrapRatePercent: 5 });
    expect(r.effectiveYieldPercent).toBeCloseTo(95, 6);
  });

  it('zero cavities defaults to 1 + warning', () => {
    const r = estimate({ ...base, cavities: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('total = sum of components / yield', () => {
    const r = estimate({ ...base, scrapRatePercent: 0 });
    expect(r.totalCostPerPart).toBeCloseTo(
      r.machineCostPerPart + r.materialCostPerPart + r.toolCostPerPart + r.setupCostPerPart, 6);
  });
});

describe('cavityBreakeven', () => {
  it('returns sorted by cost ascending', () => {
    const r = cavityBreakeven({ ...base, toolCost: 40000, toolLifeParts: 100000 }, [1, 2, 4, 8]);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.costPerPart).toBeGreaterThanOrEqual(r[i - 1]!.costPerPart);
    }
  });

  it('more cavities tends cheaper per part (machine share)', () => {
    const r = cavityBreakeven(base, [1, 8]);
    const c1 = r.find(x => x.cavities === 1)!;
    const c8 = r.find(x => x.cavities === 8)!;
    expect(c8.costPerPart).toBeLessThan(c1.costPerPart);
  });
});

describe('summarize', () => {
  it('reports total + machine + material', () => {
    const r = estimate(base);
    const s = summarize(r);
    expect(s.totalCostPerPart).toBe(r.totalCostPerPart);
    expect(s.materialCostPerPart).toBe(r.materialCostPerPart);
  });
});
