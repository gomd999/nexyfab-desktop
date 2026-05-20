import { describe, it, expect } from 'vitest';
import {
  estimate,
  compareProcesses,
  dieCastBreakeven,
  summarize,
  type CastingCostInput,
} from './castingCost';

const base: CastingCostInput = {
  process: 'sand',
  partMassG: 2000,
  materialPricePerKg: 3,
};

describe('estimate', () => {
  it('poured mass = part / yield', () => {
    const r = estimate(base);
    expect(r.pouredMassG).toBeCloseTo(2000 / 0.55, 2);
  });

  it('material cost nets scrap credit', () => {
    const noScrap = estimate({ ...base, scrapReturnPricePerKg: 0 });
    const withScrap = estimate({ ...base, scrapReturnPricePerKg: 2 });
    expect(withScrap.materialCost).toBeLessThan(noScrap.materialCost);
  });

  it('HPDC higher yield → less poured mass than sand', () => {
    const sand = estimate({ ...base, process: 'sand' });
    const hpdc = estimate({ ...base, process: 'high-pressure-die' });
    expect(hpdc.pouredMassG).toBeLessThan(sand.pouredMassG);
  });

  it('HPDC tool cost per part higher tooling but lower labour', () => {
    const hpdc = estimate({ ...base, process: 'high-pressure-die' });
    expect(hpdc.toolCostPerPart).toBeGreaterThan(0);
    expect(hpdc.processCost).toBeLessThan(estimate({ ...base, process: 'sand' }).processCost);
  });

  it('yield override respected', () => {
    const r = estimate({ ...base, yieldOverride: 0.8 });
    expect(r.pouredMassG).toBeCloseTo(2000 / 0.8, 2);
  });

  it('tool override respected', () => {
    const r = estimate({ ...base, toolPrice: 100000, toolLifeParts: 100000 });
    expect(r.toolCostPerPart).toBeCloseTo(1, 6);
  });

  it('total = sum of components', () => {
    const r = estimate(base);
    expect(r.totalCostPerPart).toBeCloseTo(r.materialCost + r.processCost + r.toolCostPerPart + r.finishingCost, 6);
  });

  it('unknown process → warning', () => {
    const r = estimate({ ...base, process: 'XYZ' as never });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('heavier part → higher cost', () => {
    const light = estimate({ ...base, partMassG: 500 });
    const heavy = estimate({ ...base, partMassG: 5000 });
    expect(heavy.totalCostPerPart).toBeGreaterThan(light.totalCostPerPart);
  });
});

describe('compareProcesses', () => {
  it('sorted ascending by cost', () => {
    const r = compareProcesses(2000, 3, ['sand', 'high-pressure-die', 'investment']);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.costPerPart).toBeGreaterThanOrEqual(r[i - 1]!.costPerPart);
    }
  });
});

describe('dieCastBreakeven', () => {
  it('returns a positive break-even quantity', () => {
    const q = dieCastBreakeven(2000, 3);
    expect(q).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports total + material + poured mass', () => {
    const r = estimate(base);
    const s = summarize(r);
    expect(s.totalCostPerPart).toBe(r.totalCostPerPart);
    expect(s.pouredMassG).toBe(r.pouredMassG);
  });
});
