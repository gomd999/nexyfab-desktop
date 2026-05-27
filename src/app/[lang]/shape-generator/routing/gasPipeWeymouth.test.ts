import { describe, it, expect } from 'vitest';
import { compute, diameterForFlow, summarize, type GasPipeInput } from './gasPipeWeymouth';

const base: GasPipeInput = {
  inletPressurePsia: 800, outletPressurePsia: 600, innerDiameterIn: 12,
  lengthMiles: 20, gasGravity: 0.6, flowingTempR: 520, compressibility: 0.9, efficiency: 0.92,
};

describe('compute', () => {
  it('matches Weymouth formula', () => {
    const r = compute(base);
    const dp2 = 800 ** 2 - 600 ** 2;
    const expected = 433.5 * 0.92 * (519.67 / 14.696)
      * Math.sqrt(dp2 / (0.6 * 520 * 20 * 0.9)) * Math.pow(12, 2.667);
    expect(r.flowScfPerDay).toBeCloseTo(expected, 0);
  });

  it('MMscf/day = scf/day / 1e6', () => {
    const r = compute(base);
    expect(r.flowMMscfPerDay).toBeCloseTo(r.flowScfPerDay / 1e6, 6);
  });

  it('larger diameter → more flow', () => {
    const small = compute({ ...base, innerDiameterIn: 8 });
    const big = compute({ ...base, innerDiameterIn: 16 });
    expect(big.flowScfPerDay).toBeGreaterThan(small.flowScfPerDay);
  });

  it('bigger pressure drop → more flow', () => {
    const lo = compute({ ...base, outletPressurePsia: 750 });
    const hi = compute({ ...base, outletPressurePsia: 400 });
    expect(hi.flowScfPerDay).toBeGreaterThan(lo.flowScfPerDay);
  });

  it('pressure drop = P1 − P2', () => {
    expect(compute(base).pressureDropPsi).toBe(200);
  });

  it('outlet ≥ inlet → warning + zero flow', () => {
    const r = compute({ ...base, outletPressurePsia: 900 });
    expect(r.flowScfPerDay).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('positive velocity', () => {
    expect(compute(base).averageVelocityFtPerSec).toBeGreaterThan(0);
  });

  it('flags velocity over erosional limit', () => {
    // short run + large bore spikes the carried flow → velocity
    const r = compute({ ...base, innerDiameterIn: 30, lengthMiles: 0.1 });
    expect(r.velocityOk).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('diameterForFlow', () => {
  it('round-trips with compute', () => {
    const flow = compute(base).flowScfPerDay;
    const { innerDiameterIn, ...rest } = base;
    void innerDiameterIn;
    expect(diameterForFlow(rest, flow)).toBeCloseTo(12, 3);
  });
});

describe('summarize', () => {
  it('reports flow + velocity ok', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.flowMMscfPerDay).toBe(r.flowMMscfPerDay);
    expect(s.velocityOk).toBe(r.velocityOk);
  });
});
