import { describe, it, expect } from 'vitest';
import { compute, effectiveness, summarize, type CoolingTowerInput } from './coolingTower';

const base: CoolingTowerInput = {
  waterInletC: 37, waterOutletC: 32, wetBulbC: 27, waterFlowM3H: 100,
};

describe('compute', () => {
  it('range = inlet − outlet', () => {
    expect(compute(base).rangeC).toBeCloseTo(5, 6);
  });

  it('approach = outlet − wetbulb', () => {
    expect(compute(base).approachC).toBeCloseTo(5, 6);
  });

  it('heat rejection positive', () => {
    expect(compute(base).heatRejectionKW).toBeGreaterThan(0);
  });

  it('evaporation positive + scales with range', () => {
    const small = compute({ ...base, waterInletC: 34 }); // range 2
    const big = compute({ ...base, waterInletC: 42 });    // range 10
    expect(big.evaporationM3H).toBeGreaterThan(small.evaporationM3H);
  });

  it('makeup = evaporation + drift + blowdown', () => {
    const r = compute(base);
    expect(r.makeupM3H).toBeCloseTo(r.evaporationM3H + r.driftM3H + r.blowdownM3H, 6);
  });

  it('more cycles → less blowdown', () => {
    const lo = compute({ ...base, cyclesOfConcentration: 2 });
    const hi = compute({ ...base, cyclesOfConcentration: 6 });
    expect(hi.blowdownM3H).toBeLessThan(lo.blowdownM3H);
  });

  it('infeasible when outlet ≤ wet bulb', () => {
    const r = compute({ ...base, waterOutletC: 26, wetBulbC: 27 });
    expect(r.feasible).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('L/G computed when air mass flow given', () => {
    const r = compute({ ...base, airMassFlowKgS: 25 });
    expect(r.lgRatio).not.toBeNull();
    expect(r.lgRatio!).toBeGreaterThan(0);
  });

  it('no air flow → null L/G', () => {
    expect(compute(base).lgRatio).toBeNull();
  });
});

describe('effectiveness', () => {
  it('range/(range+approach)', () => {
    const r = compute(base);
    expect(effectiveness(r)).toBeCloseTo(5 / (5 + 5), 6);
  });

  it('smaller approach → higher effectiveness', () => {
    const wide = compute({ ...base, wetBulbC: 22 }); // approach 10
    const tight = compute({ ...base, wetBulbC: 30 }); // approach 2
    expect(effectiveness(tight)).toBeGreaterThan(effectiveness(wide));
  });
});

describe('summarize', () => {
  it('reports range + approach + makeup', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.rangeC).toBe(r.rangeC);
    expect(s.makeupM3H).toBe(r.makeupM3H);
  });
});
