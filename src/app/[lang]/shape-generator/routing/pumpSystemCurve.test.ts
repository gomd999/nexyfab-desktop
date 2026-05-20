import { describe, it, expect } from 'vitest';
import { compute, systemHeadM, pumpHeadM, summarize, type PumpSystemInput } from './pumpSystemCurve';

const base: PumpSystemInput = {
  staticHeadM: 10,
  systemDutyFlowM3H: 50, systemDutyHeadM: 20,
  pumpShutoffHeadM: 40, pumpDutyFlowM3H: 60, pumpDutyHeadM: 22,
};

describe('compute', () => {
  it('system k from duty point', () => {
    const r = compute(base);
    expect(r.systemResistanceK).toBeCloseTo((20 - 10) / (50 ** 2), 8);
  });

  it('pump b from shutoff + duty', () => {
    const r = compute(base);
    expect(r.pumpCoeffB).toBeCloseTo((40 - 22) / (60 ** 2), 8);
  });

  it('operating point on both curves', () => {
    const r = compute(base);
    const hSys = systemHeadM(base.staticHeadM, r.systemResistanceK, r.operatingFlowM3H);
    const hPump = pumpHeadM(base.pumpShutoffHeadM, r.pumpCoeffB, r.operatingFlowM3H);
    expect(hSys).toBeCloseTo(hPump, 4);
    expect(r.operatingHeadM).toBeCloseTo(hSys, 4);
  });

  it('operating flow positive + bounded', () => {
    const r = compute(base);
    expect(r.operatingFlowM3H).toBeGreaterThan(0);
    expect(r.operatingFlowM3H).toBeLessThan(base.pumpDutyFlowM3H * 3);
  });

  it('meets required flow flag', () => {
    const r = compute(base);
    const lo = compute({ ...base, requiredFlowM3H: r.operatingFlowM3H * 0.5 });
    const hi = compute({ ...base, requiredFlowM3H: r.operatingFlowM3H * 2 });
    expect(lo.meetsRequiredFlow).toBe(true);
    expect(hi.meetsRequiredFlow).toBe(false);
  });

  it('higher static head → lower operating flow (same system k)', () => {
    // Keep k = (dutyHead − static)/dutyFlow² constant (=0.004) by raising the
    // duty head with the static head; only the static lift differs.
    const low = compute({ ...base, staticHeadM: 5, systemDutyHeadM: 15 });
    const high = compute({ ...base, staticHeadM: 30, systemDutyHeadM: 40 });
    expect(high.operatingFlowM3H).toBeLessThan(low.operatingFlowM3H);
  });

  it('non-descending pump curve → warning', () => {
    const r = compute({ ...base, pumpDutyHeadM: 45 }); // duty head > shutoff
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('curve helpers', () => {
  it('system head rises with flow', () => {
    expect(systemHeadM(10, 0.004, 60)).toBeGreaterThan(systemHeadM(10, 0.004, 20));
  });
  it('pump head falls with flow', () => {
    expect(pumpHeadM(40, 0.005, 60)).toBeLessThan(pumpHeadM(40, 0.005, 20));
  });
});

describe('summarize', () => {
  it('reports operating point', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.operatingFlowM3H).toBe(r.operatingFlowM3H);
  });
});
