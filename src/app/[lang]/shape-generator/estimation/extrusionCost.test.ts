import { describe, it, expect } from 'vitest';
import {
  estimate,
  compareMaterials,
  summarize,
  type ExtrusionCostInput,
} from './extrusionCost';

const base: ExtrusionCostInput = {
  material: 'aluminium',
  crossSectionAreaMm2: 400,
  materialPricePerKg: 3,
  lineRatePerMin: 5,
  partLengthM: 2,
};

describe('estimate', () => {
  it('mass per metre = area × density', () => {
    const r = estimate(base);
    expect(r.massPerMeterKg).toBeCloseTo(400 * 1e-6 * 2700, 6);
  });

  it('material cost includes scrap yield', () => {
    const r = estimate(base);
    const massPerM = 400 * 1e-6 * 2700;
    expect(r.materialCostPerMeter).toBeCloseTo((massPerM / 0.92) * 3, 5);
  });

  it('line cost = rate / line speed', () => {
    const r = estimate(base);
    expect(r.lineCostPerMeter).toBeCloseTo(5 / 25, 5);
  });

  it('cost per part = per metre × length', () => {
    const r = estimate(base);
    expect(r.costPerPart).toBeCloseTo(r.costPerMeter * 2, 6);
  });

  it('larger cross-section → heavier + costlier', () => {
    const small = estimate({ ...base, crossSectionAreaMm2: 200 });
    const big = estimate({ ...base, crossSectionAreaMm2: 800 });
    expect(big.costPerMeter).toBeGreaterThan(small.costPerMeter);
  });

  it('plastic faster line → lower line cost than steel', () => {
    const pvc = estimate({ ...base, material: 'pvc' });
    const steel = estimate({ ...base, material: 'steel' });
    expect(pvc.lineCostPerMeter).toBeLessThan(steel.lineCostPerMeter);
  });

  it('finishing added per metre', () => {
    const bare = estimate(base);
    const anodised = estimate({ ...base, finishingPerMeter: 1 });
    expect(anodised.costPerMeter).toBeCloseTo(bare.costPerMeter + 1, 6);
  });

  it('die cost amortised by throughput', () => {
    const r = estimate(base);
    expect(r.dieCostPerMeter).toBeGreaterThan(0);
  });

  it('unknown material → warning', () => {
    const r = estimate({ ...base, material: 'XYZ' as never });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('compareMaterials', () => {
  it('sorted ascending', () => {
    const r = compareMaterials(400, 3, 5, 2, ['aluminium', 'pvc', 'steel']);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.costPerPart).toBeGreaterThanOrEqual(r[i - 1]!.costPerPart);
    }
  });
});

describe('summarize', () => {
  it('reports per-metre + per-part', () => {
    const r = estimate(base);
    const s = summarize(r);
    expect(s.costPerMeter).toBe(r.costPerMeter);
    expect(s.costPerPart).toBe(r.costPerPart);
  });
});
