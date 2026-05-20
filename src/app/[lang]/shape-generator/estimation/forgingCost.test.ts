import { describe, it, expect } from 'vitest';
import {
  estimate,
  materialUtilisation,
  compareProcesses,
  summarize,
  type ForgingCostInput,
} from './forgingCost';

const base: ForgingCostInput = {
  process: 'closed-die',
  partMassG: 1500,
  materialPricePerKg: 4,
  strokeTimeSec: 8,
  pressRatePerHour: 180,
};

describe('estimate', () => {
  it('flash mass = part × flash fraction', () => {
    const r = estimate(base);
    expect(r.flashMassG).toBeCloseTo(1500 * 0.25, 3);
  });

  it('billet mass accounts for flash + scale loss', () => {
    const r = estimate(base);
    const expected = (1500 + 1500 * 0.25) / (1 - 0.03);
    expect(r.billetMassG).toBeCloseTo(expected, 2);
  });

  it('material cost nets flash scrap credit', () => {
    const noScrap = estimate({ ...base, scrapReturnPricePerKg: 0 });
    const withScrap = estimate({ ...base, scrapReturnPricePerKg: 2 });
    expect(withScrap.materialCost).toBeLessThan(noScrap.materialCost);
  });

  it('die cost amortised over life', () => {
    const r = estimate({ ...base, diePrice: 30000, dieLifeParts: 10000 });
    expect(r.dieCostPerPart).toBeCloseTo(3, 6);
  });

  it('open-die has less flash than closed-die', () => {
    const closed = estimate({ ...base, process: 'closed-die' });
    const open = estimate({ ...base, process: 'open-die' });
    expect(open.flashMassG).toBeLessThan(closed.flashMassG);
  });

  it('cold-forge has no scale loss', () => {
    const r = estimate({ ...base, process: 'cold-forge' });
    // billet = (part + flash) / 1 (no scale)
    expect(r.billetMassG).toBeCloseTo(1500 * 1.05, 2);
  });

  it('total = sum of components', () => {
    const r = estimate(base);
    expect(r.totalCostPerPart).toBeCloseTo(
      r.materialCost + r.forgeCost + r.dieCostPerPart + r.trimCost + r.heatTreatCost, 6);
  });

  it('heat treat added when given', () => {
    const noHT = estimate(base);
    const ht = estimate({ ...base, heatTreatPerPart: 2 });
    expect(ht.totalCostPerPart).toBeCloseTo(noHT.totalCostPerPart + 2, 6);
  });

  it('unknown process → warning', () => {
    const r = estimate({ ...base, process: 'XYZ' as never });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('materialUtilisation', () => {
  it('part / billet < 1', () => {
    const r = estimate(base);
    expect(materialUtilisation(r, 1500)).toBeLessThan(1);
    expect(materialUtilisation(r, 1500)).toBeGreaterThan(0);
  });
});

describe('compareProcesses', () => {
  it('sorted ascending', () => {
    const r = compareProcesses(1500, 4, 8, 180, ['closed-die', 'open-die', 'upset']);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.costPerPart).toBeGreaterThanOrEqual(r[i - 1]!.costPerPart);
    }
  });
});

describe('summarize', () => {
  it('reports total + billet', () => {
    const r = estimate(base);
    const s = summarize(r);
    expect(s.totalCostPerPart).toBe(r.totalCostPerPart);
    expect(s.billetMassG).toBe(r.billetMassG);
  });
});
