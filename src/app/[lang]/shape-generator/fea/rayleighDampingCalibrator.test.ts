import { describe, it, expect } from 'vitest';
import {
  calibrate,
  predictRatio,
  plotSweep,
  minimumDampingFrequencyHz,
  summarize,
} from './rayleighDampingCalibrator';

describe('calibrate', () => {
  it('two-freq match recovers target ratio at each freq', () => {
    const c = calibrate({ freq1Hz: 5, freq2Hz: 50, zeta1: 0.02, zeta2: 0.02 });
    expect(predictRatio(c, 5)).toBeCloseTo(0.02, 5);
    expect(predictRatio(c, 50)).toBeCloseTo(0.02, 5);
  });

  it('different ratios at each freq → both match', () => {
    const c = calibrate({ freq1Hz: 10, freq2Hz: 100, zeta1: 0.01, zeta2: 0.05 });
    expect(predictRatio(c, 10)).toBeCloseTo(0.01, 5);
    expect(predictRatio(c, 100)).toBeCloseTo(0.05, 5);
  });

  it('equal frequencies → singular warning', () => {
    const c = calibrate({ freq1Hz: 10, freq2Hz: 10, zeta1: 0.02, zeta2: 0.02 });
    expect(c.warnings.some(w => w.toLowerCase().includes('differ'))).toBe(true);
  });

  it('non-positive freq → warning', () => {
    const c = calibrate({ freq1Hz: 0, freq2Hz: 10, zeta1: 0.02, zeta2: 0.02 });
    expect(c.warnings.some(w => w.toLowerCase().includes('positive'))).toBe(true);
  });

  it('negative ratio → warning', () => {
    const c = calibrate({ freq1Hz: 5, freq2Hz: 50, zeta1: -0.01, zeta2: 0.02 });
    expect(c.warnings.some(w => w.toLowerCase().includes('non-negative'))).toBe(true);
  });

  it('overdamped → warning', () => {
    const c = calibrate({ freq1Hz: 5, freq2Hz: 50, zeta1: 1.5, zeta2: 1.5 });
    expect(c.warnings.some(w => w.includes('overdamped'))).toBe(true);
  });
});

describe('predictRatio', () => {
  it('zero freq → 0', () => {
    expect(predictRatio({ alpha: 0.5, beta: 1e-4 }, 0)).toBe(0);
  });

  it('mass-proportional damping decays with freq', () => {
    const c = { alpha: 1.0, beta: 0 };
    expect(predictRatio(c, 1)).toBeGreaterThan(predictRatio(c, 10));
  });

  it('stiffness-proportional damping rises with freq', () => {
    const c = { alpha: 0, beta: 1e-4 };
    expect(predictRatio(c, 10)).toBeGreaterThan(predictRatio(c, 1));
  });
});

describe('plotSweep', () => {
  it('produces requested sample count + 1', () => {
    const r = plotSweep({ alpha: 1, beta: 1e-4 }, 1, 100, 20);
    expect(r).toHaveLength(21);
  });

  it('first sample ≈ freqMin, last ≈ freqMax', () => {
    const r = plotSweep({ alpha: 1, beta: 1e-4 }, 1, 100, 10);
    expect(r[0]!.freqHz).toBeCloseTo(1, 3);
    expect(r[r.length - 1]!.freqHz).toBeCloseTo(100, 1);
  });
});

describe('minimumDampingFrequencyHz', () => {
  it('zero coefficients → null', () => {
    expect(minimumDampingFrequencyHz({ alpha: 0, beta: 0 })).toBeNull();
  });

  it('matches √(α/β)/2π for positive coefficients', () => {
    const c = calibrate({ freq1Hz: 10, freq2Hz: 100, zeta1: 0.02, zeta2: 0.02 });
    const fMin = minimumDampingFrequencyHz(c)!;
    expect(fMin).toBeGreaterThan(10);
    expect(fMin).toBeLessThan(100);
  });
});

describe('summarize', () => {
  it('reports α + β + warning count', () => {
    const c = calibrate({ freq1Hz: 5, freq2Hz: 50, zeta1: 0.02, zeta2: 0.02 });
    const s = summarize(c);
    expect(s.alpha).toBe(c.alpha);
    expect(s.beta).toBe(c.beta);
  });
});
