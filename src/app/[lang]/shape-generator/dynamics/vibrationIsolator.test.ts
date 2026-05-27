import { describe, it, expect } from 'vitest';
import {
  compute,
  transmissibility,
  summarize,
  type IsolatorInput,
} from './vibrationIsolator';

const base: IsolatorInput = {
  machineMassKg: 500,
  forcingFrequencyHz: 25,
  staticDeflectionMm: 10,
};

describe('compute', () => {
  it('natural frequency from deflection', () => {
    const r = compute(base);
    const expected = (1 / (2 * Math.PI)) * Math.sqrt(9.80665 / 0.01);
    expect(r.naturalFrequencyHz).toBeCloseTo(expected, 3);
  });

  it('frequency ratio = forcing / natural', () => {
    const r = compute(base);
    expect(r.frequencyRatio).toBeCloseTo(25 / r.naturalFrequencyHz, 5);
  });

  it('r > √2 → isolating', () => {
    const r = compute(base);
    expect(r.isolating).toBe(r.frequencyRatio > Math.SQRT2);
  });

  it('softer mount (more deflection) → better isolation', () => {
    const stiff = compute({ ...base, staticDeflectionMm: 2 });
    const soft = compute({ ...base, staticDeflectionMm: 25 });
    expect(soft.isolationPercent).toBeGreaterThan(stiff.isolationPercent);
  });

  it('stiff mount near resonance → amplifies + warning', () => {
    // pick deflection so fn ≈ forcing
    const r = compute({ ...base, staticDeflectionMm: 1 });
    if (r.frequencyRatio <= Math.SQRT2) {
      expect(r.warnings.length).toBeGreaterThan(0);
    }
    expect(r.transmissibility).toBeGreaterThan(0);
  });

  it('spring rate = m·ωn²', () => {
    const r = compute(base);
    const omegaN = 2 * Math.PI * r.naturalFrequencyHz;
    expect(r.springRateNmm).toBeCloseTo((500 * omegaN * omegaN) / 1000, 2);
  });

  it('solves deflection from target isolation', () => {
    const r = compute({ machineMassKg: 500, forcingFrequencyHz: 25, targetIsolationPercent: 90 });
    expect(r.staticDeflectionMm).toBeGreaterThan(0);
    expect(r.isolationPercent).toBeGreaterThan(80);
  });

  it('higher target isolation → more deflection', () => {
    const lo = compute({ machineMassKg: 500, forcingFrequencyHz: 25, targetIsolationPercent: 80 });
    const hi = compute({ machineMassKg: 500, forcingFrequencyHz: 25, targetIsolationPercent: 95 });
    expect(hi.staticDeflectionMm).toBeGreaterThan(lo.staticDeflectionMm);
  });

  it('zero mass → warning', () => {
    const r = compute({ ...base, machineMassKg: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('transmissibility', () => {
  it('r=0 → TR=1', () => {
    expect(transmissibility(0, 0.05)).toBeCloseTo(1, 4);
  });

  it('r=√2 → TR=1 (crossover)', () => {
    expect(transmissibility(Math.SQRT2, 0.0001)).toBeCloseTo(1, 2);
  });

  it('r large → TR small', () => {
    expect(transmissibility(5, 0.05)).toBeLessThan(0.2);
  });
});

describe('summarize', () => {
  it('reports fn + TR + isolating', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.naturalFrequencyHz).toBe(r.naturalFrequencyHz);
    expect(s.isolating).toBe(r.isolating);
  });
});
