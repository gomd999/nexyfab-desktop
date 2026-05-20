import { describe, it, expect } from 'vitest';
import { mix, oaFractionForMixedTemp, summarize, type AirMixingInput } from './airMixing';

// Return air (warm) + outdoor air (cool).
const base: AirMixingInput = {
  stream1: { flowM3PerS: 3, dryBulbC: 24, humidityRatio: 0.010, enthalpyKJkg: 49 },
  stream2: { flowM3PerS: 1, dryBulbC: 5, humidityRatio: 0.004, enthalpyKJkg: 15 },
};

describe('mix', () => {
  it('mixed mass flow = sum', () => {
    const r = mix(base);
    expect(r.mixedMassFlowKgS).toBeCloseTo((3 + 1) * 1.2, 5);
  });

  it('mix ratio = m1/total', () => {
    const r = mix(base);
    expect(r.mixRatio1).toBeCloseTo(3 / 4, 5);
  });

  it('mixed temp is mass-weighted', () => {
    const r = mix(base);
    expect(r.mixedDryBulbC).toBeCloseTo((3 * 24 + 1 * 5) / 4, 4);
  });

  it('mixed temp between the two streams', () => {
    const r = mix(base);
    expect(r.mixedDryBulbC).toBeGreaterThan(5);
    expect(r.mixedDryBulbC).toBeLessThan(24);
  });

  it('mixed humidity + enthalpy mass-weighted', () => {
    const r = mix(base);
    expect(r.mixedHumidityRatio).toBeCloseTo((3 * 0.010 + 1 * 0.004) / 4, 6);
    expect(r.mixedEnthalpyKJkg).toBeCloseTo((3 * 49 + 1 * 15) / 4, 4);
  });

  it('more outdoor air → cooler mix', () => {
    const lessOA = mix({ ...base, stream2: { ...base.stream2, flowM3PerS: 0.5 } });
    const moreOA = mix({ ...base, stream2: { ...base.stream2, flowM3PerS: 3 } });
    expect(moreOA.mixedDryBulbC).toBeLessThan(lessOA.mixedDryBulbC);
  });

  it('zero total flow → warning', () => {
    const r = mix({ stream1: { ...base.stream1, flowM3PerS: 0 }, stream2: { ...base.stream2, flowM3PerS: 0 } });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('oaFractionForMixedTemp', () => {
  it('target = return → 0 OA', () => {
    expect(oaFractionForMixedTemp(24, 5, 24)).toBeCloseTo(0, 5);
  });

  it('target = outdoor → 100% OA', () => {
    expect(oaFractionForMixedTemp(24, 5, 5)).toBeCloseTo(1, 5);
  });

  it('midpoint → 0.5', () => {
    expect(oaFractionForMixedTemp(24, 4, 14)).toBeCloseTo(0.5, 5);
  });

  it('clamped to [0,1]', () => {
    expect(oaFractionForMixedTemp(24, 5, 30)).toBe(0);
    expect(oaFractionForMixedTemp(24, 5, 0)).toBe(1);
  });
});

describe('summarize', () => {
  it('reports mixed temp + ratio', () => {
    const r = mix(base);
    const s = summarize(r);
    expect(s.mixedDryBulbC).toBe(r.mixedDryBulbC);
    expect(s.mixRatio1).toBe(r.mixRatio1);
  });
});
