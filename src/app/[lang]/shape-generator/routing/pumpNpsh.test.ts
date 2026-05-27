import { describe, it, expect } from 'vitest';
import {
  compute,
  maxSuctionLiftM,
  summarize,
  type PumpNpshInput,
} from './pumpNpsh';

// Water at 20°C: ρ≈998, Pv≈2339 Pa. Flooded suction +2 m, 1 m friction.
const base: PumpNpshInput = {
  vapourPressurePa: 2339,
  fluidDensityKgM3: 998,
  staticHeadM: 2,
  frictionHeadM: 1,
};

describe('compute', () => {
  it('NPSHa positive for flooded suction', () => {
    const r = compute(base);
    expect(r.npshAvailableM).toBeGreaterThan(0);
  });

  it('pressure head ~10.3 m for water at atmospheric', () => {
    const r = compute(base);
    expect(r.pressureHeadM).toBeGreaterThan(9.5);
    expect(r.pressureHeadM).toBeLessThan(10.5);
  });

  it('NPSHa = pressureHead + static − friction', () => {
    const r = compute(base);
    expect(r.npshAvailableM).toBeCloseTo(r.pressureHeadM + 2 - 1, 5);
  });

  it('suction lift (negative static) reduces NPSHa', () => {
    const flooded = compute({ ...base, staticHeadM: 2 });
    const lift = compute({ ...base, staticHeadM: -4 });
    expect(lift.npshAvailableM).toBeLessThan(flooded.npshAvailableM);
  });

  it('higher vapour pressure (hot fluid) reduces NPSHa', () => {
    const cold = compute({ ...base, vapourPressurePa: 2339 });
    const hot = compute({ ...base, vapourPressurePa: 47390 }); // ~80°C
    expect(hot.npshAvailableM).toBeLessThan(cold.npshAvailableM);
  });

  it('cavitation margin computed with NPSHr', () => {
    const r = compute({ ...base, npshRequiredM: 3 });
    expect(r.cavitationMarginM).toBeCloseTo(r.npshAvailableM - 3, 5);
  });

  it('safe when margin large', () => {
    const r = compute({ ...base, npshRequiredM: 3 });
    expect(r.cavitationRisk).toBe('safe');
  });

  it('risk when NPSHr exceeds NPSHa', () => {
    const r = compute({ ...base, staticHeadM: -8, npshRequiredM: 6 });
    expect(r.cavitationRisk).toBe('risk');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('no NPSHr → null risk', () => {
    expect(compute(base).cavitationRisk).toBeNull();
  });

  it('zero density → warning', () => {
    const r = compute({ ...base, fluidDensityKgM3: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('maxSuctionLiftM', () => {
  it('positive lift capacity for cold water', () => {
    expect(maxSuctionLiftM({ ...base, npshRequiredM: 3 })).toBeGreaterThan(0);
  });

  it('higher NPSHr → less lift capacity', () => {
    const lo = maxSuctionLiftM({ ...base, npshRequiredM: 2 });
    const hi = maxSuctionLiftM({ ...base, npshRequiredM: 5 });
    expect(hi).toBeLessThan(lo);
  });

  it('no NPSHr → Infinity', () => {
    expect(maxSuctionLiftM(base)).toBe(Infinity);
  });
});

describe('summarize', () => {
  it('reports NPSHa + risk', () => {
    const r = compute({ ...base, npshRequiredM: 3 });
    const s = summarize(r);
    expect(s.npshAvailableM).toBe(r.npshAvailableM);
    expect(s.cavitationRisk).toBe(r.cavitationRisk);
  });
});
