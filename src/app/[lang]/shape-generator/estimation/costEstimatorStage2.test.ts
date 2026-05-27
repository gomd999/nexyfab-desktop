import { describe, it, expect } from 'vitest';
import {
  computeStage2,
  applyStage2,
  buildPriceLadder,
  quantityDiscount,
} from './costEstimatorStage2';

const baseEstimate = { materialCostUsd: 10, machiningCostUsd: 30, perUnitTotalUsd: 40 };

describe('quantityDiscount', () => {
  it('1 unit = full price', () => {
    expect(quantityDiscount(1)).toBe(1.0);
  });

  it('10 units ≈ 85%', () => {
    expect(quantityDiscount(10)).toBeCloseTo(0.85, 2);
  });

  it('100 units ≈ 70%', () => {
    expect(quantityDiscount(100)).toBeCloseTo(0.70, 2);
  });

  it('clamps at 50% for huge quantities', () => {
    expect(quantityDiscount(1e10)).toBeGreaterThanOrEqual(0.5);
    expect(quantityDiscount(1e10)).toBeLessThan(0.51);
  });
});

describe('computeStage2', () => {
  it('CNC setup is amortized over qty', () => {
    const a1 = computeStage2({
      process: 'cnc-mill', toleranceGrade: 'iso2768-m',
      finishingOps: [], surfaceAreaCm2: 100, quantity: 1,
    });
    const a100 = computeStage2({
      process: 'cnc-mill', toleranceGrade: 'iso2768-m',
      finishingOps: [], surfaceAreaCm2: 100, quantity: 100,
    });
    expect(a1.setupPerUnitUsd).toBeGreaterThan(a100.setupPerUnitUsd);
    expect(a1.setupPerUnitUsd / 100).toBeCloseTo(a100.setupPerUnitUsd, 4);
  });

  it('tolerance multiplier ranks correctly', () => {
    const make = (grade: 'iso2768-m' | 'iso2768-f' | 'precision' | 'high-precision') =>
      computeStage2({ process: 'cnc-mill', toleranceGrade: grade, finishingOps: [], surfaceAreaCm2: 100, quantity: 1 });
    expect(make('iso2768-m').toleranceMultiplier).toBeLessThan(make('iso2768-f').toleranceMultiplier);
    expect(make('iso2768-f').toleranceMultiplier).toBeLessThan(make('precision').toleranceMultiplier);
    expect(make('precision').toleranceMultiplier).toBeLessThan(make('high-precision').toleranceMultiplier);
  });

  it('CNC has higher waste than injection (chip vs sprue)', () => {
    const cnc = computeStage2({ process: 'cnc-mill', toleranceGrade: 'iso2768-m', finishingOps: [], surfaceAreaCm2: 100, quantity: 1 });
    const inj = computeStage2({ process: 'injection-mold', toleranceGrade: 'iso2768-m', finishingOps: [], surfaceAreaCm2: 100, quantity: 1 });
    expect(cnc.wasteFactor).toBeGreaterThan(inj.wasteFactor);
  });

  it('finishing cost adds per cm² of surface', () => {
    const noFinish = computeStage2({ process: 'cnc-mill', toleranceGrade: 'iso2768-m', finishingOps: [], surfaceAreaCm2: 100, quantity: 100 });
    const anodized = computeStage2({ process: 'cnc-mill', toleranceGrade: 'iso2768-m', finishingOps: ['anodize-clear'], surfaceAreaCm2: 100, quantity: 100 });
    expect(anodized.finishingPerUnitUsd).toBeGreaterThan(noFinish.finishingPerUnitUsd);
  });

  it('finishing min-lot dominates small orders', () => {
    // 100 cm² × $0.08/cm² = $8 but min lot is $50. At qty=1 each part pays $50.
    const single = computeStage2({ process: 'cnc-mill', toleranceGrade: 'iso2768-m', finishingOps: ['anodize-clear'], surfaceAreaCm2: 50, quantity: 1 });
    expect(single.finishingPerUnitUsd).toBeGreaterThanOrEqual(50 - 1e-6);
  });

  it('multiple finishings stack', () => {
    const one = computeStage2({ process: 'cnc-mill', toleranceGrade: 'iso2768-m', finishingOps: ['anodize-clear'], surfaceAreaCm2: 100, quantity: 100 });
    const two = computeStage2({ process: 'cnc-mill', toleranceGrade: 'iso2768-m', finishingOps: ['anodize-clear', 'bead-blast'], surfaceAreaCm2: 100, quantity: 100 });
    expect(two.finishingPerUnitUsd).toBeGreaterThan(one.finishingPerUnitUsd);
  });
});

describe('applyStage2', () => {
  it('material × waste, machining × tolerance', () => {
    const adj = computeStage2({
      process: 'cnc-mill', toleranceGrade: 'iso2768-f', finishingOps: [], surfaceAreaCm2: 100, quantity: 10,
    });
    const r = applyStage2(baseEstimate, adj);
    expect(r.materialCostUsd).toBeCloseTo(baseEstimate.materialCostUsd * adj.wasteFactor, 5);
    expect(r.machiningCostUsd).toBeCloseTo(baseEstimate.machiningCostUsd * adj.toleranceMultiplier, 5);
  });

  it('total includes setup + finishing', () => {
    const adj = computeStage2({
      process: 'cnc-mill', toleranceGrade: 'iso2768-m', finishingOps: ['bead-blast'], surfaceAreaCm2: 100, quantity: 100,
    });
    const r = applyStage2(baseEstimate, adj);
    expect(r.subtotalUsd).toBeGreaterThan(baseEstimate.materialCostUsd + baseEstimate.machiningCostUsd);
  });

  it('qty discount lowers per-unit price', () => {
    const adj1 = computeStage2({ process: 'cnc-mill', toleranceGrade: 'iso2768-m', finishingOps: [], surfaceAreaCm2: 100, quantity: 1 });
    const adj100 = computeStage2({ process: 'cnc-mill', toleranceGrade: 'iso2768-m', finishingOps: [], surfaceAreaCm2: 100, quantity: 100 });
    const r1 = applyStage2(baseEstimate, adj1);
    const r100 = applyStage2(baseEstimate, adj100);
    expect(r100.totalPerUnitUsd).toBeLessThan(r1.totalPerUnitUsd);
  });
});

describe('buildPriceLadder', () => {
  it('produces 7 default tiers', () => {
    const ladder = buildPriceLadder(baseEstimate, {
      process: 'cnc-mill', toleranceGrade: 'iso2768-m', finishingOps: [], surfaceAreaCm2: 100,
    });
    expect(ladder).toHaveLength(7);
  });

  it('per-unit price monotonically decreases with quantity', () => {
    const ladder = buildPriceLadder(baseEstimate, {
      process: 'cnc-mill', toleranceGrade: 'iso2768-m', finishingOps: ['anodize-clear'], surfaceAreaCm2: 100,
    });
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]!.pricePerUnitUsd).toBeLessThan(ladder[i - 1]!.pricePerUnitUsd);
    }
  });

  it('respects custom quantity tiers', () => {
    const ladder = buildPriceLadder(baseEstimate, {
      process: 'cnc-mill', toleranceGrade: 'iso2768-m', finishingOps: [], surfaceAreaCm2: 100,
    }, [1, 100, 10000]);
    expect(ladder.map(t => t.quantity)).toEqual([1, 100, 10000]);
  });
});
