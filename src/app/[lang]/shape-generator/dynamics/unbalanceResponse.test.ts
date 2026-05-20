import { describe, it, expect } from 'vitest';
import { compute, responseCurve, summarize, type UnbalanceResponseInput } from './unbalanceResponse';

const base: UnbalanceResponseInput = {
  rotorMassKg: 50, unbalanceKgMm: 2, naturalFrequencyHz: 50, dampingRatio: 0.05,
};

describe('compute', () => {
  it('resonance rpm = fn × 60', () => {
    expect(compute(base).resonanceRpm).toBeCloseTo(3000, 3);
  });

  it('Q factor = 1/(2ζ)', () => {
    expect(compute(base).qFactor).toBeCloseTo(1 / (2 * 0.05), 5);
  });

  it('peak amplitude = eqEcc × Q', () => {
    const r = compute(base);
    const eqEcc = 2 / 50; // mm
    expect(r.peakAmplitudeMm).toBeCloseTo(eqEcc * r.qFactor, 5);
  });

  it('self-centring amplitude = eqEcc', () => {
    expect(compute(base).selfCentringAmplitudeMm).toBeCloseTo(2 / 50, 6);
  });

  it('more damping → lower peak', () => {
    const lo = compute({ ...base, dampingRatio: 0.02 });
    const hi = compute({ ...base, dampingRatio: 0.15 });
    expect(hi.peakAmplitudeMm).toBeLessThan(lo.peakAmplitudeMm);
  });

  it('operating point evaluated when speed given', () => {
    const r = compute({ ...base, operatingSpeedRpm: 1500 });
    expect(r.operatingPoint).not.toBeNull();
    expect(r.operatingPoint!.frequencyRatio).toBeCloseTo(0.5, 5);
  });

  it('near-resonance operating speed → warning', () => {
    const r = compute({ ...base, operatingSpeedRpm: 3000 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('larger unbalance → larger peak', () => {
    const lo = compute({ ...base, unbalanceKgMm: 1 });
    const hi = compute({ ...base, unbalanceKgMm: 4 });
    expect(hi.peakAmplitudeMm).toBeGreaterThan(lo.peakAmplitudeMm);
  });

  it('zero mass → warning', () => {
    expect(compute({ ...base, rotorMassKg: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('responseCurve', () => {
  it('peaks near resonance', () => {
    const curve = responseCurve(base, 6000, 60);
    const peak = curve.reduce((m, p) => p.amplitudeMm > m.amplitudeMm ? p : m, curve[0]!);
    expect(Math.abs(peak.frequencyRatio - 1)).toBeLessThan(0.15);
  });

  it('amplitude approaches eqEcc far above resonance', () => {
    const curve = responseCurve(base, 30000, 100);
    const last = curve[curve.length - 1]!;
    expect(last.amplitudeMm).toBeCloseTo(2 / 50, 1);
  });
});

describe('summarize', () => {
  it('reports resonance + peak', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.resonanceRpm).toBe(r.resonanceRpm);
    expect(s.peakAmplitudeMm).toBe(r.peakAmplitudeMm);
  });
});
