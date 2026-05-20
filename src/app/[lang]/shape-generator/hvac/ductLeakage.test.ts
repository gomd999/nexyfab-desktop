import { describe, it, expect } from 'vitest';
import { compute, recommendClass, summarize, type DuctLeakageInput } from './ductLeakage';

const base: DuctLeakageInput = {
  leakageClass: 6, surfaceAreaM2: 200, staticPressurePa: 500, systemFlowM3PerS: 5,
};

describe('compute', () => {
  it('static pressure converted to in.wg', () => {
    const r = compute(base);
    expect(r.staticPressureInWg).toBeCloseTo(500 / 248.84, 4);
  });

  it('leakage flow positive', () => {
    expect(compute(base).leakageFlowM3PerS).toBeGreaterThan(0);
  });

  it('tighter class → less leakage', () => {
    const tight = compute({ ...base, leakageClass: 3 });
    const loose = compute({ ...base, leakageClass: 24 });
    expect(loose.leakageFlowM3PerS).toBeGreaterThan(tight.leakageFlowM3PerS);
  });

  it('higher pressure → more leakage (P^0.65)', () => {
    const lo = compute({ ...base, staticPressurePa: 250 });
    const hi = compute({ ...base, staticPressurePa: 1000 });
    expect(hi.leakageFlowM3PerS).toBeGreaterThan(lo.leakageFlowM3PerS);
  });

  it('leakage percent vs system flow', () => {
    const r = compute(base);
    expect(r.leakagePercent).toBeCloseTo((r.leakageFlowM3PerS / 5) * 100, 6);
  });

  it('within allowable flag', () => {
    const tight = compute({ ...base, leakageClass: 3, allowableLeakFraction: 0.1 });
    expect(tight.withinAllowable).toBe(true);
  });

  it('excessive leakage → not within + warning', () => {
    const r = compute({ ...base, leakageClass: 48, allowableLeakFraction: 0.01 });
    expect(r.withinAllowable).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('larger surface area → more leakage', () => {
    const small = compute({ ...base, surfaceAreaM2: 50 });
    const big = compute({ ...base, surfaceAreaM2: 500 });
    expect(big.leakageFlowM3PerS).toBeGreaterThan(small.leakageFlowM3PerS);
  });

  it('zero class → warning', () => {
    expect(compute({ ...base, leakageClass: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('recommendClass', () => {
  it('returns a positive class', () => {
    const c = recommendClass({ surfaceAreaM2: 200, staticPressurePa: 500, systemFlowM3PerS: 5, allowableLeakFraction: 0.05 });
    expect(c).toBeGreaterThan(0);
  });

  it('recommended class meets allowable when applied', () => {
    const inp = { surfaceAreaM2: 200, staticPressurePa: 500, systemFlowM3PerS: 5, allowableLeakFraction: 0.05 };
    const c = recommendClass(inp);
    const r = compute({ ...inp, leakageClass: c });
    expect(r.leakagePercent).toBeCloseTo(5, 0);
  });
});

describe('summarize', () => {
  it('reports leakage + within', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.leakageFlowM3PerS).toBe(r.leakageFlowM3PerS);
    expect(s.withinAllowable).toBe(r.withinAllowable);
  });
});
