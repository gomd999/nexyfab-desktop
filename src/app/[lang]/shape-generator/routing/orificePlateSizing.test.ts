import { describe, it, expect } from 'vitest';
import {
  flowFromDp,
  boreForFlow,
  permanentPressureLossPa,
  summarize,
  type OrificeFlowInput,
} from './orificePlateSizing';

const base: OrificeFlowInput = {
  pipeInnerDiameterMm: 100,
  boreDiameterMm: 50,
  differentialPressurePa: 20000,
  fluidDensityKgM3: 998,
};

describe('flowFromDp', () => {
  it('beta = d/D', () => {
    const r = flowFromDp(base);
    expect(r.beta).toBeCloseTo(0.5, 6);
  });

  it('mass flow positive', () => {
    expect(flowFromDp(base).massFlowKgS).toBeGreaterThan(0);
  });

  it('higher Δp → more flow (∝ √Δp)', () => {
    const lo = flowFromDp({ ...base, differentialPressurePa: 10000 });
    const hi = flowFromDp({ ...base, differentialPressurePa: 40000 });
    expect(hi.massFlowKgS).toBeCloseTo(2 * lo.massFlowKgS, 2);
  });

  it('larger bore → more flow', () => {
    const small = flowFromDp({ ...base, boreDiameterMm: 30 });
    const big = flowFromDp({ ...base, boreDiameterMm: 60 });
    expect(big.massFlowKgS).toBeGreaterThan(small.massFlowKgS);
  });

  it('beta in valid range flagged', () => {
    expect(flowFromDp(base).betaInValidRange).toBe(true);
  });

  it('beta out of range → warning', () => {
    const r = flowFromDp({ ...base, boreDiameterMm: 10 }); // β=0.1
    expect(r.betaInValidRange).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('bore ≥ pipe → warning', () => {
    const r = flowFromDp({ ...base, boreDiameterMm: 120 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('volume flow = mass / density', () => {
    const r = flowFromDp(base);
    expect(r.volumeFlowM3S).toBeCloseTo(r.massFlowKgS / 998, 6);
  });
});

describe('boreForFlow', () => {
  it('round-trips approximately with flowFromDp', () => {
    const target = flowFromDp(base).massFlowKgS;
    const bore = boreForFlow(100, target, 20000, 998);
    expect(bore).toBeGreaterThan(30);
    expect(bore).toBeLessThan(70);
  });

  it('higher target flow → larger bore', () => {
    const small = boreForFlow(100, 5, 20000, 998);
    const big = boreForFlow(100, 30, 20000, 998);
    expect(big).toBeGreaterThan(small);
  });

  it('invalid inputs → 0', () => {
    expect(boreForFlow(0, 10, 20000, 998)).toBe(0);
  });
});

describe('permanentPressureLossPa', () => {
  it('lower beta → higher permanent loss', () => {
    const lowBeta = permanentPressureLossPa(0.3, 20000);
    const highBeta = permanentPressureLossPa(0.7, 20000);
    expect(lowBeta).toBeGreaterThan(highBeta);
  });

  it('loss less than Δp', () => {
    expect(permanentPressureLossPa(0.5, 20000)).toBeLessThan(20000);
  });
});

describe('summarize', () => {
  it('reports beta + flow', () => {
    const r = flowFromDp(base);
    const s = summarize(r);
    expect(s.beta).toBe(r.beta);
    expect(s.massFlowKgS).toBe(r.massFlowKgS);
  });
});
