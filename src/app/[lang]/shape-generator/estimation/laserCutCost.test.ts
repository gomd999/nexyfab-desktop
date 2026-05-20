import { describe, it, expect } from 'vitest';
import {
  estimate,
  partsPerHour,
  summarize,
  type LaserCutCostInput,
} from './laserCutCost';

const base: LaserCutCostInput = {
  cutLengthMm: 2000,
  pierceCount: 8,
  thicknessMm: 3,
  material: 'mild-steel',
  machineRatePerHour: 90,
};

describe('estimate', () => {
  it('feed falls with thickness', () => {
    const thin = estimate({ ...base, thicknessMm: 1 });
    const thick = estimate({ ...base, thicknessMm: 6 });
    expect(thick.feedRateMmMin).toBeLessThan(thin.feedRateMmMin);
  });

  it('stainless slower than mild steel', () => {
    const mild = estimate({ ...base, material: 'mild-steel' });
    const ss = estimate({ ...base, material: 'stainless' });
    expect(ss.feedRateMmMin).toBeLessThan(mild.feedRateMmMin);
  });

  it('cut time = length / feed', () => {
    const r = estimate(base);
    expect(r.cutTimeMin).toBeCloseTo(base.cutLengthMm / r.feedRateMmMin, 6);
  });

  it('more pierces → more pierce time', () => {
    const few = estimate({ ...base, pierceCount: 2 });
    const many = estimate({ ...base, pierceCount: 20 });
    expect(many.pierceTimeMin).toBeGreaterThan(few.pierceTimeMin);
  });

  it('thicker → longer pierce time per hole', () => {
    const thin = estimate({ ...base, thicknessMm: 1 });
    const thick = estimate({ ...base, thicknessMm: 10 });
    expect(thick.pierceTimeMin).toBeGreaterThan(thin.pierceTimeMin);
  });

  it('material cost added when sheet info present', () => {
    const noMat = estimate(base);
    const withMat = estimate({ ...base, sheetAreaMm2: 50000, materialPricePerKg: 1.5 });
    expect(withMat.materialCost).toBeGreaterThan(0);
    expect(withMat.totalCostPerPart).toBeGreaterThan(noMat.totalCostPerPart);
  });

  it('total = machine+gas + material', () => {
    const r = estimate({ ...base, sheetAreaMm2: 50000, materialPricePerKg: 1.5 });
    expect(r.totalCostPerPart).toBeCloseTo(r.machineGasCost + r.materialCost, 6);
  });

  it('unknown material → warning', () => {
    const r = estimate({ ...base, material: 'XYZ' as never });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('zero thickness → warning', () => {
    const r = estimate({ ...base, thicknessMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('lower nesting yield → more material cost', () => {
    const good = estimate({ ...base, sheetAreaMm2: 50000, materialPricePerKg: 1.5, nestingYield: 0.9 });
    const poor = estimate({ ...base, sheetAreaMm2: 50000, materialPricePerKg: 1.5, nestingYield: 0.5 });
    expect(poor.materialCost).toBeGreaterThan(good.materialCost);
  });
});

describe('partsPerHour', () => {
  it('inverse of cycle time', () => {
    const r = estimate(base);
    expect(partsPerHour(r)).toBeCloseTo(60 / r.cycleTimeMin, 6);
  });
});

describe('summarize', () => {
  it('reports total + cycle + feed', () => {
    const r = estimate(base);
    const s = summarize(r);
    expect(s.totalCostPerPart).toBe(r.totalCostPerPart);
    expect(s.feedRateMmMin).toBe(r.feedRateMmMin);
  });
});
