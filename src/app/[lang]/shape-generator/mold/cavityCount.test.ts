import { describe, it, expect } from 'vitest';
import { compute, costForCavities, summarize, type CavityCountInput } from './cavityCount';

const base: CavityCountInput = {
  totalParts: 500_000, cycleTimeSec: 30, machineHourRate: 60,
  baseToolingCost: 20_000, extraCavityCost: 6_000, maxCavities: 64,
};

describe('compute', () => {
  it('n* = √(rate·parts·cycle / (3600·extraCost))', () => {
    const expected = Math.sqrt((60 * 500_000 * 30) / (3600 * 6_000));
    expect(compute(base).optimalContinuous).toBeCloseTo(expected, 5);
  });

  it('recommended is a clamped integer near n*', () => {
    const r = compute(base);
    expect(Number.isInteger(r.recommendedCavities)).toBe(true);
    expect(Math.abs(r.recommendedCavities - r.optimalContinuous)).toBeLessThanOrEqual(1);
  });

  it('recommended cavity count is the cost minimum among neighbours', () => {
    const r = compute(base);
    const here = costForCavities(base, r.recommendedCavities);
    expect(here).toBeLessThanOrEqual(costForCavities(base, r.recommendedCavities + 1));
    expect(here).toBeLessThanOrEqual(costForCavities(base, Math.max(1, r.recommendedCavities - 1)));
  });

  it('total = tooling + machine', () => {
    const r = compute(base);
    expect(r.totalCostAtRecommended).toBeCloseTo(r.toolingCost + r.machineCost, 4);
  });

  it('more parts → more cavities optimal', () => {
    const few = compute({ ...base, totalParts: 50_000 });
    const many = compute({ ...base, totalParts: 5_000_000 });
    expect(many.optimalContinuous).toBeGreaterThan(few.optimalContinuous);
  });

  it('clamps to machine max when n* too high', () => {
    const r = compute({ ...base, totalParts: 100_000_000, maxCavities: 16 });
    expect(r.clampedByMachine).toBe(true);
    expect(r.recommendedCavities).toBe(16);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('cost per part = total / parts', () => {
    const r = compute(base);
    expect(r.costPerPart).toBeCloseTo(r.totalCostAtRecommended / 500_000, 8);
  });

  it('cheaper extra cavities → more cavities optimal', () => {
    const dear = compute({ ...base, extraCavityCost: 20_000 });
    const cheap = compute({ ...base, extraCavityCost: 2_000 });
    expect(cheap.optimalContinuous).toBeGreaterThan(dear.optimalContinuous);
  });
});

describe('costForCavities', () => {
  it('single cavity = base tooling + full machine time', () => {
    const expected = 20_000 + 60 * (500_000 * 30) / 3600;
    expect(costForCavities(base, 1)).toBeCloseTo(expected, 2);
  });
});

describe('summarize', () => {
  it('reports recommended + cost per part', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.recommendedCavities).toBe(r.recommendedCavities);
    expect(s.costPerPart).toBe(r.costPerPart);
  });
});
