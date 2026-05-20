import { describe, it, expect } from 'vitest';
import { compute, minWallForFlow, summarize, type InjectionPressureInput } from './injectionPressure';

// PP, 150 mm flow, 2 mm wall → FLR 75, P = 0.15·75 = 11.25 MPa
const base: InjectionPressureInput = { polymer: 'PP', flowLengthMm: 150, wallThicknessMm: 2 };

describe('compute', () => {
  it('flow-length ratio = flowLength / wall', () => {
    expect(compute(base).flowLengthRatio).toBeCloseTo(75, 5);
  });

  it('fill pressure = C·FLR (no thin-wall factor at t≥1)', () => {
    expect(compute(base).fillPressureMPa).toBeCloseTo(0.15 * 75, 5);
  });

  it('PC needs more pressure than PP at same geometry', () => {
    const pp = compute(base);
    const pc = compute({ ...base, polymer: 'PC' });
    expect(pc.fillPressureMPa).toBeGreaterThan(pp.fillPressureMPa);
  });

  it('longer flow → higher pressure', () => {
    const shortP = compute({ ...base, flowLengthMm: 100 });
    const longP = compute({ ...base, flowLengthMm: 400 });
    expect(longP.fillPressureMPa).toBeGreaterThan(shortP.fillPressureMPa);
  });

  it('thinner wall (<1mm) applies amplification factor', () => {
    const r = compute({ ...base, flowLengthMm: 50, wallThicknessMm: 0.5 });
    const flr = 50 / 0.5;
    const plain = 0.15 * flr;
    expect(r.fillPressureMPa).toBeGreaterThan(plain);
  });

  it('flags flow ratio over material limit', () => {
    const r = compute({ polymer: 'PC', flowLengthMm: 600, wallThicknessMm: 2 }); // FLR 300 > 120
    expect(r.flowFeasible).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('flags pressure over machine max', () => {
    const r = compute({ polymer: 'PC', flowLengthMm: 1000, wallThicknessMm: 1, machineMaxPressureMPa: 180 });
    expect(r.withinMachine).toBe(false);
  });

  it('pressure margin positive when within machine', () => {
    expect(compute(base).pressureMarginPct).toBeGreaterThan(0);
  });

  it('zero wall → warning', () => {
    expect(compute({ ...base, wallThicknessMm: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('minWallForFlow', () => {
  it('= flowLength / maxFlowRatio', () => {
    expect(minWallForFlow('PP', 280)).toBeCloseTo(280 / 280, 5);
  });
});

describe('summarize', () => {
  it('reports pressure + feasibility flags', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.fillPressureMPa).toBe(r.fillPressureMPa);
    expect(s.flowFeasible).toBe(r.flowFeasible);
  });
});
