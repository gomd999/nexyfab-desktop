import { describe, it, expect } from 'vitest';
import { compute, diameterForHeadLoss, agedCFactor, summarize, type HazenWilliamsInput } from './hazenWilliams';

const base: HazenWilliamsInput = {
  flowM3S: 0.02, innerDiameterMm: 100, lengthM: 100, cFactor: 130,
};

describe('compute', () => {
  it('velocity = Q/A', () => {
    const r = compute(base);
    const A = (Math.PI / 4) * 0.1 * 0.1;
    expect(r.velocityMS).toBeCloseTo(0.02 / A, 5);
  });

  it('head loss positive', () => {
    expect(compute(base).headLossM).toBeGreaterThan(0);
  });

  it('higher flow → more head loss (∝ Q^1.852)', () => {
    const lo = compute({ ...base, flowM3S: 0.01 });
    const hi = compute({ ...base, flowM3S: 0.04 });
    expect(hi.headLossM / lo.headLossM).toBeGreaterThan(3); // 4^1.852 ≈ 12
  });

  it('rougher pipe (lower C) → more head loss', () => {
    const smooth = compute({ ...base, cFactor: 150 });
    const rough = compute({ ...base, cFactor: 90 });
    expect(rough.headLossM).toBeGreaterThan(smooth.headLossM);
  });

  it('larger diameter → much less head loss', () => {
    const small = compute({ ...base, innerDiameterMm: 80 });
    const big = compute({ ...base, innerDiameterMm: 150 });
    expect(big.headLossM).toBeLessThan(small.headLossM);
  });

  it('high velocity → erosion warning', () => {
    const r = compute({ ...base, flowM3S: 0.05, innerDiameterMm: 80 });
    if (r.velocityMS > 3) expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('pressure drop derived from head', () => {
    const r = compute(base);
    expect(r.pressureDropBar).toBeCloseTo(r.headLossM * 9806.65 / 1e5, 6);
  });

  it('zero C → warning', () => {
    expect(compute({ ...base, cFactor: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('diameterForHeadLoss', () => {
  it('round-trips with compute', () => {
    const r = compute(base);
    const D = diameterForHeadLoss(0.02, r.headLossPerMm, 130);
    expect(D).toBeCloseTo(100, 0);
  });

  it('lower target loss → bigger diameter', () => {
    expect(diameterForHeadLoss(0.02, 0.001, 130)).toBeGreaterThan(diameterForHeadLoss(0.02, 0.01, 130));
  });
});

describe('agedCFactor', () => {
  it('declines with age', () => {
    expect(agedCFactor(130, 20)).toBeLessThan(130);
  });

  it('floored at 60% of new', () => {
    expect(agedCFactor(130, 200)).toBeCloseTo(130 * 0.6, 4);
  });
});

describe('summarize', () => {
  it('reports velocity + head loss', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.velocityMS).toBe(r.velocityMS);
    expect(s.headLossM).toBe(r.headLossM);
  });
});
