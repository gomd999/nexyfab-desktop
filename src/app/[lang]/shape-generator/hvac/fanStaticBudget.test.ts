import { describe, it, expect } from 'vitest';
import {
  compute,
  pressureShares,
  summarize,
  type FanStaticBudgetInput,
} from './fanStaticBudget';

const base: FanStaticBudgetInput = {
  components: [
    { name: 'filter', dropPa: 120 },
    { name: 'cooling-coil', dropPa: 250 },
    { name: 'terminal', dropPa: 80 },
  ],
  ductLengthM: 50,
  frictionRatePaPerM: 0.8,
  fittingLossesPa: 60,
  flowRateM3PerS: 2,
};

describe('compute', () => {
  it('component total sums drops', () => {
    const r = compute(base);
    expect(r.componentTotalPa).toBe(120 + 250 + 80);
  });

  it('duct friction = length × rate', () => {
    const r = compute(base);
    expect(r.ductFrictionPa).toBeCloseTo(50 * 0.8, 6);
  });

  it('ESP = components + duct + fittings', () => {
    const r = compute(base);
    expect(r.externalStaticPa).toBeCloseTo(450 + 40 + 60, 6);
  });

  it('fan static includes safety margin', () => {
    const r = compute({ ...base, safetyMarginPercent: 10 });
    expect(r.fanStaticPa).toBeCloseTo(r.externalStaticPa * 1.1, 6);
  });

  it('air power = Q × fan static', () => {
    const r = compute(base);
    expect(r.airPowerW).toBeCloseTo(2 * r.fanStaticPa, 6);
  });

  it('shaft power = air / efficiency', () => {
    const r = compute({ ...base, fanEfficiency: 0.5 });
    expect(r.shaftPowerW).toBeCloseTo(r.airPowerW / 0.5, 6);
  });

  it('dominant component is the largest drop', () => {
    expect(compute(base).dominantComponent).toBe('cooling-coil');
  });

  it('ductwork can be dominant', () => {
    const r = compute({ ...base, ductLengthM: 1000, frictionRatePaPerM: 1 });
    expect(r.dominantComponent).toBe('ductwork');
  });

  it('zero flow → warning', () => {
    const r = compute({ ...base, flowRateM3PerS: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('pressureShares', () => {
  it('shares sum to ~1', () => {
    const r = compute(base);
    const shares = pressureShares(r, base);
    const sum = shares.reduce((s, x) => s + x.fraction, 0);
    expect(sum).toBeCloseTo(1, 4);
  });

  it('sorted descending', () => {
    const r = compute(base);
    const shares = pressureShares(r, base);
    for (let i = 1; i < shares.length; i++) {
      expect(shares[i]!.fraction).toBeLessThanOrEqual(shares[i - 1]!.fraction);
    }
  });
});

describe('summarize', () => {
  it('reports ESP + fan static + shaft power', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.externalStaticPa).toBe(r.externalStaticPa);
    expect(s.fanStaticPa).toBe(r.fanStaticPa);
  });
});
