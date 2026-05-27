import { describe, it, expect } from 'vitest';
import {
  estimate,
  breakEvenBatch,
  summarize,
  type MachiningCostInput,
} from './machiningCycleCost';

const base: MachiningCostInput = {
  features: [
    { name: 'pocket', removedVolumeMm3: 60000, mrrMm3PerMin: 20000, toolChangeSec: 15 },
    { name: 'holes', removedVolumeMm3: 5000, mrrMm3PerMin: 10000, toolChangeSec: 15 },
  ],
  handlingTimeSec: 60,
  machineRatePerHour: 60,
  labourRatePerHour: 40,
  setupCost: 200,
  batchQuantity: 50,
  tools: [{ toolPrice: 80, toolLifeParts: 200 }],
};

describe('estimate', () => {
  it('cut time = Σ volume / MRR', () => {
    const r = estimate(base);
    expect(r.cutTimeMin).toBeCloseTo(60000 / 20000 + 5000 / 10000, 6);
  });

  it('cycle time includes tool change + handling', () => {
    const r = estimate(base);
    expect(r.cycleTimeMin).toBeCloseTo(r.cutTimeMin + 30 / 60 + 60 / 60, 6);
  });

  it('machine+labour cost = (cycle/60)·rate', () => {
    const r = estimate(base);
    expect(r.machineLabourCost).toBeCloseTo((r.cycleTimeMin / 60) * 100, 6);
  });

  it('setup amortised over batch', () => {
    const r = estimate(base);
    expect(r.setupCostPerPart).toBeCloseTo(200 / 50, 6);
  });

  it('tooling cost per part = price / life', () => {
    const r = estimate(base);
    expect(r.toolingCostPerPart).toBeCloseTo(80 / 200, 6);
  });

  it('total = machine+labour + setup + tooling', () => {
    const r = estimate(base);
    expect(r.totalCostPerPart).toBeCloseTo(r.machineLabourCost + r.setupCostPerPart + r.toolingCostPerPart, 6);
  });

  it('margin applied to price', () => {
    const r = estimate({ ...base, marginPercent: 25 });
    expect(r.priceWithMargin).toBeCloseTo(r.totalCostPerPart * 1.25, 6);
  });

  it('bigger batch → lower setup per part', () => {
    const small = estimate({ ...base, batchQuantity: 10 });
    const big = estimate({ ...base, batchQuantity: 1000 });
    expect(big.setupCostPerPart).toBeLessThan(small.setupCostPerPart);
  });

  it('non-positive MRR feature → warning', () => {
    const r = estimate({ ...base, features: [{ name: 'bad', removedVolumeMm3: 100, mrrMm3PerMin: 0 }] });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('zero batch → warning', () => {
    const r = estimate({ ...base, batchQuantity: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('breakEvenBatch', () => {
  it('returns a positive batch size', () => {
    expect(breakEvenBatch(base, 0.1)).toBeGreaterThan(0);
  });

  it('tighter setup fraction → larger break-even batch', () => {
    const loose = breakEvenBatch(base, 0.2);
    const tight = breakEvenBatch(base, 0.05);
    expect(tight).toBeGreaterThan(loose);
  });
});

describe('summarize', () => {
  it('reports cycle + cost + price', () => {
    const r = estimate({ ...base, marginPercent: 20 });
    const s = summarize(r);
    expect(s.totalCostPerPart).toBe(r.totalCostPerPart);
    expect(s.priceWithMargin).toBe(r.priceWithMargin);
  });
});
