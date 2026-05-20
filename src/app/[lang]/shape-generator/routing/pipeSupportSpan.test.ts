import { describe, it, expect } from 'vitest';
import {
  compute,
  supportCount,
  summarize,
  type PipeSupportInput,
} from './pipeSupportSpan';

// 2" steel pipe, water-filled.
const base: PipeSupportInput = {
  outerDiameterMm: 60,
  wallThicknessMm: 3.9,
  pipeMaterialDensityKgM3: 7850,
  youngMpa: 200000,
  allowableStressMpa: 100,
};

describe('compute', () => {
  it('produces positive spans', () => {
    const r = compute(base);
    expect(r.spanBySagMm).toBeGreaterThan(0);
    expect(r.spanByStressMm).toBeGreaterThan(0);
  });

  it('recommended = min(sag, stress)', () => {
    const r = compute(base);
    expect(r.recommendedSpanMm).toBeCloseTo(Math.min(r.spanBySagMm, r.spanByStressMm), 4);
  });

  it('governing flag matches smaller span', () => {
    const r = compute(base);
    const expected = r.spanBySagMm <= r.spanByStressMm ? 'sag' : 'stress';
    expect(r.governing).toBe(expected);
  });

  it('weight per metre positive', () => {
    expect(compute(base).weightPerMeterN).toBeGreaterThan(0);
  });

  it('moment of inertia matches hollow circle', () => {
    const r = compute(base);
    const Di = 60 - 2 * 3.9;
    const expected = (Math.PI / 64) * (Math.pow(60, 4) - Math.pow(Di, 4));
    expect(r.momentOfInertiaMm4).toBeCloseTo(expected, 0);
  });

  it('tighter sag allowance → shorter sag span', () => {
    const loose = compute({ ...base, allowableSagMm: 10 });
    const tight = compute({ ...base, allowableSagMm: 1 });
    expect(tight.spanBySagMm).toBeLessThan(loose.spanBySagMm);
  });

  it('insulation mass reduces span', () => {
    const bare = compute(base);
    const insulated = compute({ ...base, insulationMassPerMKg: 10 });
    expect(insulated.recommendedSpanMm).toBeLessThan(bare.recommendedSpanMm);
  });

  it('first natural frequency positive', () => {
    expect(compute(base).firstNaturalFreqHz).toBeGreaterThan(0);
  });

  it('bad wall thickness → warning', () => {
    const r = compute({ ...base, wallThicknessMm: 40 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('supportCount', () => {
  it('count grows with run length', () => {
    const r = compute(base);
    const short = supportCount(r, 5000);
    const long = supportCount(r, 20000);
    expect(long).toBeGreaterThan(short);
  });

  it('includes both end supports (+1)', () => {
    const r = compute(base);
    const n = supportCount(r, r.recommendedSpanMm);
    expect(n).toBe(2);
  });
});

describe('summarize', () => {
  it('reports span + governing', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.recommendedSpanMm).toBe(r.recommendedSpanMm);
    expect(s.governing).toBe(r.governing);
  });
});
