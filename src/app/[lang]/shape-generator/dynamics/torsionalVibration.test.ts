import { describe, it, expect } from 'vitest';
import {
  compute,
  resonanceCheck,
  equivalentInertia,
  summarize,
  type TorsionalInput,
} from './torsionalVibration';

const base: TorsionalInput = {
  shaft: { diameterMm: 40, lengthMm: 500, shearModulusGPa: 79 },
  inertia1KgM2: 0.5,
};

describe('compute', () => {
  it('single-disc natural frequency positive', () => {
    const r = compute(base);
    expect(r.naturalFrequencyHz).toBeGreaterThan(0);
    expect(r.mode).toBe('single-disc');
  });

  it('polar moment = π/32·d⁴', () => {
    const r = compute(base);
    expect(r.polarMomentMm4).toBeCloseTo((Math.PI / 32) * Math.pow(40, 4), 2);
  });

  it('stiffness = GJ/L', () => {
    const r = compute(base);
    const J = (Math.PI / 32) * Math.pow(40, 4) * 1e-12;
    const expected = (79e9 * J) / 0.5;
    expect(r.torsionalStiffnessNmPerRad).toBeCloseTo(expected, 0);
  });

  it('larger inertia → lower frequency', () => {
    const light = compute({ ...base, inertia1KgM2: 0.2 });
    const heavy = compute({ ...base, inertia1KgM2: 2 });
    expect(heavy.naturalFrequencyHz).toBeLessThan(light.naturalFrequencyHz);
  });

  it('larger diameter → higher frequency', () => {
    const thin = compute({ ...base, shaft: { ...base.shaft, diameterMm: 30 } });
    const thick = compute({ ...base, shaft: { ...base.shaft, diameterMm: 50 } });
    expect(thick.naturalFrequencyHz).toBeGreaterThan(thin.naturalFrequencyHz);
  });

  it('two-disc mode uses equivalent inertia', () => {
    const r = compute({ ...base, inertia2KgM2: 0.5 });
    expect(r.mode).toBe('two-disc');
    expect(r.naturalFrequencyHz).toBeGreaterThan(0);
  });

  it('two-disc freq higher than single (smaller equiv inertia)', () => {
    const single = compute(base);
    const two = compute({ ...base, inertia2KgM2: 0.5 });
    expect(two.naturalFrequencyHz).toBeGreaterThan(single.naturalFrequencyHz);
  });

  it('rpm = Hz × 60', () => {
    const r = compute(base);
    expect(r.naturalFrequencyRpm).toBeCloseTo(r.naturalFrequencyHz * 60, 6);
  });

  it('zero diameter → warning', () => {
    const r = compute({ ...base, shaft: { ...base.shaft, diameterMm: 0 } });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('resonanceCheck', () => {
  it('flags near resonance', () => {
    const r = compute(base);
    const rpm = (r.naturalFrequencyHz * 60) / 2; // order 2 → excitation = fn
    const chk = resonanceCheck(r, rpm, 2);
    expect(chk.nearResonance).toBe(true);
  });

  it('away from resonance → safe', () => {
    const r = compute(base);
    const chk = resonanceCheck(r, 100, 1);
    expect(chk.nearResonance).toBe(false);
  });

  it('excitation Hz = order × rpm/60', () => {
    const r = compute(base);
    const chk = resonanceCheck(r, 1200, 4);
    expect(chk.excitationHz).toBeCloseTo((1200 / 60) * 4, 6);
  });
});

describe('equivalentInertia', () => {
  it('I1·I2/(I1+I2)', () => {
    expect(equivalentInertia(2, 2)).toBeCloseTo(1, 6);
  });
});

describe('summarize', () => {
  it('reports frequency + mode', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.naturalFrequencyHz).toBe(r.naturalFrequencyHz);
    expect(s.mode).toBe('single-disc');
  });
});
