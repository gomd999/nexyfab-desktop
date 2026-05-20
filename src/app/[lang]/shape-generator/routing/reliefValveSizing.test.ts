import { describe, it, expect } from 'vitest';
import {
  sizeVapor,
  gasCoefficientC,
  capacityOfOrifice,
  summarize,
  type ReliefVaporInput,
} from './reliefValveSizing';

// Steam-ish relief.
const base: ReliefVaporInput = {
  massFlowKgH: 5000,
  relievingTempK: 450,
  molarMassGmol: 18,
  specificHeatRatio: 1.31,
  relievingPressureBarA: 11,
};

describe('gasCoefficientC', () => {
  it('positive for k > 1', () => {
    expect(gasCoefficientC(1.4)).toBeGreaterThan(0);
  });

  it('rises with k', () => {
    expect(gasCoefficientC(1.6)).toBeGreaterThan(gasCoefficientC(1.1));
  });

  it('k ≤ 1 returns floor', () => {
    expect(gasCoefficientC(1)).toBeCloseTo(0.0239, 4);
  });
});

describe('sizeVapor', () => {
  it('required area positive', () => {
    expect(sizeVapor(base).requiredAreaMm2).toBeGreaterThan(0);
  });

  it('selects an orifice ≥ required area', () => {
    const r = sizeVapor(base);
    expect(r.selectedAreaMm2).toBeGreaterThanOrEqual(r.requiredAreaMm2);
  });

  it('higher flow → larger area', () => {
    const lo = sizeVapor({ ...base, massFlowKgH: 2000 });
    const hi = sizeVapor({ ...base, massFlowKgH: 20000 });
    expect(hi.requiredAreaMm2).toBeGreaterThan(lo.requiredAreaMm2);
  });

  it('higher pressure → smaller area', () => {
    const lo = sizeVapor({ ...base, relievingPressureBarA: 5 });
    const hi = sizeVapor({ ...base, relievingPressureBarA: 20 });
    expect(hi.requiredAreaMm2).toBeLessThan(lo.requiredAreaMm2);
  });

  it('selected orifice is a valid API 526 letter', () => {
    const r = sizeVapor(base);
    expect('DEFGHJKLMNPQRT').toContain(r.selectedOrifice);
  });

  it('huge flow exceeds largest orifice → warning', () => {
    const r = sizeVapor({ ...base, massFlowKgH: 5_000_000 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('zero flow → warning', () => {
    const r = sizeVapor({ ...base, massFlowKgH: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('capacityOfOrifice', () => {
  it('larger orifice → more capacity', () => {
    const { massFlowKgH, ...cond } = base;
    void massFlowKgH;
    const e = capacityOfOrifice('E', cond);
    const j = capacityOfOrifice('J', cond);
    expect(j).toBeGreaterThan(e);
  });

  it('selected orifice capacity ≥ required flow', () => {
    const r = sizeVapor(base);
    const { massFlowKgH, ...cond } = base;
    void massFlowKgH;
    const cap = capacityOfOrifice(r.selectedOrifice, cond);
    expect(cap).toBeGreaterThanOrEqual(base.massFlowKgH * 0.99);
  });

  it('unknown letter → 0', () => {
    const { massFlowKgH, ...cond } = base;
    void massFlowKgH;
    expect(capacityOfOrifice('Z', cond)).toBe(0);
  });
});

describe('summarize', () => {
  it('reports area + orifice', () => {
    const r = sizeVapor(base);
    const s = summarize(r);
    expect(s.requiredAreaMm2).toBe(r.requiredAreaMm2);
    expect(s.selectedOrifice).toBe(r.selectedOrifice);
  });
});
