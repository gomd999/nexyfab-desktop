import { describe, it, expect } from 'vitest';
import {
  estimate,
  compareProcesses,
  summarize,
  type SurfaceTreatmentInput,
} from './surfaceTreatmentCost';

const base: SurfaceTreatmentInput = {
  process: 'zinc-plate',
  treatedAreaMm2: 50000, // 0.05 m²
};

describe('estimate', () => {
  it('process cost = area × rate', () => {
    const r = estimate(base);
    expect(r.processCost).toBeCloseTo(0.05 * 18, 6);
  });

  it('consumable scales with thickness', () => {
    const thin = estimate({ ...base, thicknessMicron: 5 });
    const thick = estimate({ ...base, thicknessMicron: 20 });
    expect(thick.consumableCost).toBeGreaterThan(thin.consumableCost);
  });

  it('masking added per part', () => {
    const r = estimate({ ...base, maskingCost: 2 });
    expect(r.maskingCost).toBe(2);
  });

  it('setup amortised over batch', () => {
    const r = estimate({ ...base, setupCost: 100, batchQuantity: 500 });
    expect(r.setupCostPerPart).toBeCloseTo(0.2, 6);
  });

  it('reject rate inflates total', () => {
    const clean = estimate({ ...base, rejectRatePercent: 0 });
    const rejecty = estimate({ ...base, rejectRatePercent: 10 });
    expect(rejecty.totalCostPerPart).toBeGreaterThan(clean.totalCostPerPart);
  });

  it('hard-chrome more expensive than passivate', () => {
    const chrome = estimate({ ...base, process: 'hard-chrome' });
    const passivate = estimate({ ...base, process: 'passivate' });
    expect(chrome.totalCostPerPart).toBeGreaterThan(passivate.totalCostPerPart);
  });

  it('rate override respected', () => {
    const r = estimate({ ...base, processRateOverridePerM2: 100 });
    expect(r.processCost).toBeCloseTo(0.05 * 100, 6);
  });

  it('unknown process → warning', () => {
    const r = estimate({ ...base, process: 'XYZ' as never });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('zero area → warning', () => {
    const r = estimate({ ...base, treatedAreaMm2: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('larger area → higher cost', () => {
    const small = estimate({ ...base, treatedAreaMm2: 10000 });
    const big = estimate({ ...base, treatedAreaMm2: 100000 });
    expect(big.totalCostPerPart).toBeGreaterThan(small.totalCostPerPart);
  });
});

describe('compareProcesses', () => {
  it('returns sorted ascending by cost', () => {
    const r = compareProcesses(50000, ['hard-chrome', 'passivate', 'zinc-plate']);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.costPerPart).toBeGreaterThanOrEqual(r[i - 1]!.costPerPart);
    }
  });

  it('passivate cheapest of the three', () => {
    const r = compareProcesses(50000, ['hard-chrome', 'passivate', 'zinc-plate']);
    expect(r[0]!.process).toBe('passivate');
  });
});

describe('summarize', () => {
  it('reports total + process + consumable', () => {
    const r = estimate(base);
    const s = summarize(r);
    expect(s.totalCostPerPart).toBe(r.totalCostPerPart);
    expect(s.processCost).toBe(r.processCost);
  });
});
