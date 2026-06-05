/**
 * heatExchanger — effectiveness–NTU method, verified: counterflow is more effective
 * than parallel flow; the Cr=0 limit ε=1−e^{−NTU}; the counterflow Cr=1 limit
 * ε=NTU/(1+NTU); the NTU→∞ limits (counterflow→1, parallel→1/(1+Cr)); and the
 * outlet-temperature energy balance Q = Ch·ΔTh = Cc·ΔTc.
 */
import { describe, it, expect } from 'vitest';
import { counterflowEffectiveness, parallelFlowEffectiveness, heatTransferRate, outletTemperatures } from './heatExchanger';

describe('heatExchanger — effectiveness-NTU (verified)', () => {
  it('counterflow is more effective than parallel flow', () => {
    expect(counterflowEffectiveness(2, 0.5)).toBeGreaterThan(parallelFlowEffectiveness(2, 0.5));
    expect(counterflowEffectiveness(2, 0.5)).toBeCloseTo((1 - Math.exp(-1)) / (1 - 0.5 * Math.exp(-1)), 6);
  });

  it('the Cr=0 limit gives ε = 1 − e^{−NTU} for both arrangements', () => {
    expect(counterflowEffectiveness(2, 0)).toBeCloseTo(1 - Math.exp(-2), 9);
    expect(parallelFlowEffectiveness(2, 0)).toBeCloseTo(1 - Math.exp(-2), 9);
  });

  it('the counterflow Cr=1 limit is ε = NTU/(1+NTU)', () => {
    expect(counterflowEffectiveness(2, 1)).toBeCloseTo(2 / 3, 9);
    expect(counterflowEffectiveness(5, 1)).toBeCloseTo(5 / 6, 9);
  });

  it('the NTU→∞ limits: counterflow→1, parallel→1/(1+Cr)', () => {
    expect(counterflowEffectiveness(50, 0.5)).toBeGreaterThan(0.999);
    expect(parallelFlowEffectiveness(50, 0.5)).toBeCloseTo(1 / 1.5, 6);
    // effectiveness ≤ 1 always.
    expect(counterflowEffectiveness(3, 0.7)).toBeLessThanOrEqual(1);
  });

  it('the outlet temperatures satisfy the energy balance Q = Ch·ΔTh = Cc·ΔTc', () => {
    const Cmin = 1000, Ch = 1000, Cc = 2000, ThIn = 400, TcIn = 300;
    const eps = counterflowEffectiveness(2, Cmin / Cc);
    const Q = heatTransferRate(eps, Cmin, ThIn, TcIn);
    const o = outletTemperatures(Q, Ch, Cc, ThIn, TcIn);
    expect(Ch * (ThIn - o.hotOut)).toBeCloseTo(Q, 6);
    expect(Cc * (o.coldOut - TcIn)).toBeCloseTo(Q, 6);
    // physical bounds: neither stream crosses the opposite inlet.
    expect(o.hotOut).toBeGreaterThan(TcIn);            // hot can't fall below cold inlet
    expect(o.coldOut).toBeLessThan(ThIn);              // cold can't exceed hot inlet
    // a counterflow exchanger CAN have a temperature cross (cold out > hot out).
    expect(o.coldOut).toBeGreaterThan(o.hotOut);
  });
});
