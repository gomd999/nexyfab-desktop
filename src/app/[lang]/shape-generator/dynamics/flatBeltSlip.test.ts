import { describe, it, expect } from 'vitest';
import { compute, minSlackTensionN, summarize, type FlatBeltSlipInput } from './flatBeltSlip';

const base: FlatBeltSlipInput = {
  // ratio 700/300 = 2.33 < capstan limit e^(0.3π) ≈ 2.57 → no gross slip
  tightTensionN: 700, slackTensionN: 300, beltCrossSectionMm2: 100, beltModulusMpa: 300,
  driverDiameterMm: 100, drivenDiameterMm: 200, driverRpm: 1450,
  wrapAngleRad: Math.PI, frictionCoefficient: 0.3,
};

describe('compute', () => {
  it('tension ratio = T1/T2', () => {
    expect(compute(base).tensionRatio).toBeCloseTo(700 / 300, 5);
  });

  it('capstan limit = e^(μθ)', () => {
    expect(compute(base).capstanLimitRatio).toBeCloseTo(Math.exp(0.3 * Math.PI), 5);
  });

  it('no gross slip when ratio < limit', () => {
    expect(compute(base).grossSlip).toBe(false);
  });

  it('gross slip when ratio exceeds limit', () => {
    const r = compute({ ...base, tightTensionN: 3000 });
    expect(r.grossSlip).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('slip margin = limit / ratio', () => {
    const r = compute(base);
    expect(r.slipMargin).toBeCloseTo(r.capstanLimitRatio / r.tensionRatio, 5);
  });

  it('creep loss = (T1−T2)/(A·E)', () => {
    const r = compute(base);
    expect(r.creepLossPercent).toBeCloseTo((700 - 300) / (100 * 300) * 100, 6);
  });

  it('actual driven < ideal (creep loss)', () => {
    const r = compute(base);
    expect(r.actualDrivenRpm).toBeLessThan(r.idealDrivenRpm);
  });

  it('higher tension difference → more creep', () => {
    const lo = compute({ ...base, tightTensionN: 400 });
    const hi = compute({ ...base, tightTensionN: 1200 });
    expect(hi.creepLossPercent).toBeGreaterThan(lo.creepLossPercent);
  });

  it('zero slack → warning', () => {
    expect(compute({ ...base, slackTensionN: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('minSlackTensionN', () => {
  it('positive for valid drive', () => {
    expect(minSlackTensionN(5000, 7.6, 0.3, Math.PI)).toBeGreaterThan(0);
  });

  it('more power → more slack tension', () => {
    expect(minSlackTensionN(10000, 7.6, 0.3, Math.PI)).toBeGreaterThan(minSlackTensionN(2000, 7.6, 0.3, Math.PI));
  });

  it('zero speed → Infinity', () => {
    expect(minSlackTensionN(5000, 0, 0.3, Math.PI)).toBe(Infinity);
  });
});

describe('summarize', () => {
  it('reports slip + creep', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.grossSlip).toBe(r.grossSlip);
    expect(s.creepLossPercent).toBe(r.creepLossPercent);
  });
});
