import { describe, it, expect } from 'vitest';
import { compute, suggestStages, summarize, type PumpSpecificSpeedInput } from './pumpSpecificSpeed';

const base: PumpSpecificSpeedInput = {
  flowM3S: 0.05, headM: 50, speedRpm: 2900,
};

describe('compute', () => {
  it('Ns = N√Q / H^0.75', () => {
    const r = compute(base);
    expect(r.specificSpeed).toBeCloseTo(2900 * Math.sqrt(0.05) / Math.pow(50, 0.75), 3);
  });

  it('low Ns → radial impeller', () => {
    const r = compute({ flowM3S: 0.005, headM: 200, speedRpm: 1450 });
    expect(r.impellerType).toBe('radial');
  });

  it('high Ns → axial impeller', () => {
    const r = compute({ flowM3S: 2, headM: 3, speedRpm: 1450 });
    expect(r.impellerType).toBe('axial');
  });

  it('stages reduce head per stage → lower Ns denominator', () => {
    const one = compute({ ...base, stages: 1 });
    const four = compute({ ...base, stages: 4 });
    expect(four.headPerStageM).toBeLessThan(one.headPerStageM);
    expect(four.specificSpeed).toBeGreaterThan(one.specificSpeed);
  });

  it('double suction halves flow per eye', () => {
    const r = compute({ ...base, doubleSuction: true });
    expect(r.flowPerEyeM3S).toBeCloseTo(0.025, 5);
  });

  it('efficiency between 0.3 and 0.92', () => {
    const r = compute(base);
    expect(r.estimatedPeakEfficiency).toBeGreaterThanOrEqual(0.3);
    expect(r.estimatedPeakEfficiency).toBeLessThanOrEqual(0.92);
  });

  it('tiny low-Ns pump less efficient', () => {
    const big = compute({ flowM3S: 0.1, headM: 40, speedRpm: 2900 });
    const tiny = compute({ flowM3S: 0.002, headM: 300, speedRpm: 1450 });
    expect(tiny.estimatedPeakEfficiency).toBeLessThan(big.estimatedPeakEfficiency);
  });

  it('zero head → warning', () => {
    expect(compute({ ...base, headM: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('suggestStages', () => {
  it('high head → more stages', () => {
    const lo = suggestStages(0.05, 50, 2900);
    const hi = suggestStages(0.05, 500, 2900);
    expect(hi).toBeGreaterThanOrEqual(lo);
  });

  it('returns at least 1', () => {
    expect(suggestStages(0.05, 10, 2900)).toBeGreaterThanOrEqual(1);
  });
});

describe('summarize', () => {
  it('reports Ns + impeller + efficiency', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.specificSpeed).toBe(r.specificSpeed);
    expect(s.impellerType).toBe(r.impellerType);
  });
});
