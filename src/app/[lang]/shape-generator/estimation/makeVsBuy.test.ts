import { describe, it, expect } from 'vitest';
import { analyze, perPartCosts, summarize, type MakeVsBuyInput } from './makeVsBuy';

const base: MakeVsBuyInput = {
  makeFixedCost: 50000, makeVariableCost: 8, buyPerPartCost: 12, annualVolume: 5000,
};

describe('analyze', () => {
  it('break-even = (makeFixed − buyNRE)/(buyPP − makeVar)', () => {
    const r = analyze(base);
    expect(r.breakEvenVolume).toBeCloseTo(50000 / (12 - 8), 4);
  });

  it('low volume → buy cheaper', () => {
    const r = analyze({ ...base, annualVolume: 1000 });
    expect(r.cheaperOption).toBe('buy');
  });

  it('high volume → make cheaper', () => {
    const r = analyze({ ...base, annualVolume: 50000 });
    expect(r.cheaperOption).toBe('make');
  });

  it('make total = fixed + var·q', () => {
    const r = analyze(base);
    expect(r.makeTotalCost).toBeCloseTo(50000 + 8 * 5000, 4);
  });

  it('buy NRE shifts break-even', () => {
    const noNRE = analyze(base);
    const withNRE = analyze({ ...base, buyNRE: 20000 });
    expect(withNRE.breakEvenVolume).not.toBeCloseTo(noNRE.breakEvenVolume!, 0);
  });

  it('cost gap = |make − buy|', () => {
    const r = analyze(base);
    expect(r.costGap).toBeCloseTo(Math.abs(r.makeTotalCost - r.buyTotalCost), 4);
  });

  it('capacity exceeded flagged when make + over capacity', () => {
    const r = analyze({ ...base, annualVolume: 50000, inHouseCapacityPerYear: 20000 });
    expect(r.capacityExceeded).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('no break-even when variable costs equal', () => {
    const r = analyze({ ...base, makeVariableCost: 12, buyPerPartCost: 12 });
    expect(r.breakEvenVolume).toBeNull();
  });

  it('zero volume → warning', () => {
    expect(analyze({ ...base, annualVolume: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('perPartCosts', () => {
  it('make per-part decreases with volume', () => {
    const lo = perPartCosts(base, 1000);
    const hi = perPartCosts(base, 100000);
    expect(hi.makePerPart).toBeLessThan(lo.makePerPart);
  });

  it('buy per-part ≈ buyPerPart with no NRE', () => {
    const c = perPartCosts(base, 5000);
    expect(c.buyPerPart).toBeCloseTo(12, 5);
  });
});

describe('summarize', () => {
  it('reports cheaper + break-even', () => {
    const r = analyze(base);
    const s = summarize(r);
    expect(s.cheaperOption).toBe(r.cheaperOption);
    expect(s.breakEvenVolume).toBe(r.breakEvenVolume);
  });
});
