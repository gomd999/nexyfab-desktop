import { describe, it, expect } from 'vitest';
import {
  computeCascade,
  sensitivity,
  compareScenarios,
  POOLS_STANDARD_MACHINE_SHOP,
  POOLS_LIGHT_MARGIN,
  type PartCostInput,
  type CostPool,
} from './costCascade';

const samplePart: PartCostInput = {
  materialUsd: 20,
  laborHours: 1,
  laborRateUsd: 50,
};

describe('computeCascade', () => {
  it('material + labor included', () => {
    const r = computeCascade(samplePart, []);
    expect(r.lines.find(l => l.poolId === 'material')?.amountUsd).toBe(20);
    expect(r.lines.find(l => l.poolId === 'labor')?.amountUsd).toBe(50);
  });

  it('flat pool adds fixed amount', () => {
    const pools: CostPool[] = [
      { id: 'setup', name: 'Setup', order: 5, basis: 'flat', rate: 30 },
    ];
    const r = computeCascade(samplePart, pools);
    expect(r.lines.find(l => l.poolId === 'setup')?.amountUsd).toBe(30);
  });

  it('per-labor-hour scales with hours', () => {
    const pools: CostPool[] = [
      { id: 'foh', name: 'FOH', order: 10, basis: 'per-labor-hour', rate: 25 },
    ];
    const r1 = computeCascade({ ...samplePart, laborHours: 1 }, pools);
    const r2 = computeCascade({ ...samplePart, laborHours: 2 }, pools);
    const f1 = r1.lines.find(l => l.poolId === 'foh')!.amountUsd;
    const f2 = r2.lines.find(l => l.poolId === 'foh')!.amountUsd;
    expect(f2).toBe(f1 * 2);
  });

  it('percent-of subtotal cascades', () => {
    const pools: CostPool[] = [
      { id: 'ga', name: 'G&A', order: 10, basis: 'percent-of', rate: 0.1 },
    ];
    const r = computeCascade(samplePart, pools);
    const ga = r.lines.find(l => l.poolId === 'ga')!.amountUsd;
    // 10% of (20 + 50) = 7
    expect(ga).toBeCloseTo(7, 5);
  });

  it('percent-of named pool', () => {
    const pools: CostPool[] = [
      { id: 'extra', name: 'Extra', order: 10, basis: 'percent-of', rate: 0.5, percentOf: 'material' },
    ];
    const r = computeCascade(samplePart, pools);
    expect(r.lines.find(l => l.poolId === 'extra')?.amountUsd).toBe(10);
  });

  it('cascade order honored', () => {
    const pools: CostPool[] = [
      { id: 'margin', name: 'Margin', order: 100, basis: 'percent-of', rate: 0.3 },
      { id: 'ga', name: 'G&A', order: 50, basis: 'percent-of', rate: 0.1 },
    ];
    const r = computeCascade(samplePart, pools);
    // G&A should run before margin.
    const gaIdx = r.lines.findIndex(l => l.poolId === 'ga');
    const marginIdx = r.lines.findIndex(l => l.poolId === 'margin');
    expect(gaIdx).toBeLessThan(marginIdx);
  });

  it('total sums all lines', () => {
    const r = computeCascade(samplePart, POOLS_STANDARD_MACHINE_SHOP);
    const expected = r.lines.reduce((s, l) => s + l.amountUsd, 0);
    expect(r.totalUsd).toBeCloseTo(expected, 5);
  });

  it('subtotals are cumulative', () => {
    const r = computeCascade(samplePart, []);
    expect(r.subtotals[0]!.subtotalUsd).toBe(20);
    expect(r.subtotals[1]!.subtotalUsd).toBe(70);
  });
});

describe('sensitivity', () => {
  it('returns 3 input rows', () => {
    const r = sensitivity(samplePart, POOLS_STANDARD_MACHINE_SHOP);
    expect(r).toHaveLength(3);
  });

  it('bumping material has positive impact', () => {
    const r = sensitivity(samplePart, POOLS_STANDARD_MACHINE_SHOP);
    const material = r.find(x => x.inputName === 'materialUsd');
    expect(material!.perPercentImpactUsd).toBeGreaterThan(0);
  });
});

describe('compareScenarios', () => {
  it('lighter pools produce lower total', () => {
    const c = compareScenarios(samplePart, POOLS_STANDARD_MACHINE_SHOP, POOLS_LIGHT_MARGIN);
    expect(c.totalB).toBeLessThan(c.totalA);
  });

  it('lists pool-level diffs', () => {
    const c = compareScenarios(samplePart, POOLS_STANDARD_MACHINE_SHOP, POOLS_LIGHT_MARGIN);
    expect(c.poolDiffs.length).toBeGreaterThan(0);
  });
});

describe('preset pools', () => {
  it('standard machine shop has FOH/GA/margin', () => {
    const ids = POOLS_STANDARD_MACHINE_SHOP.map(p => p.id);
    expect(ids).toContain('foh');
    expect(ids).toContain('ga');
    expect(ids).toContain('margin');
  });

  it('light-margin has lower margin than standard', () => {
    const sLM = POOLS_LIGHT_MARGIN.find(p => p.id === 'margin')!;
    const sSM = POOLS_STANDARD_MACHINE_SHOP.find(p => p.id === 'margin')!;
    expect(sLM.rate).toBeLessThan(sSM.rate);
  });
});
