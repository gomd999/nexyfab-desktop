import { describe, it, expect } from 'vitest';
import {
  analyzeDropTest,
  analyzeRandomVibration,
  analyzeHarmonicResponse,
  transientSdof,
  type ModeShape,
} from './dynamicAnalysis';

describe('analyzeDropTest', () => {
  it('impact velocity = √(2gh)', () => {
    const r = analyzeDropTest({
      massKg: 1, dropHeightM: 1, contactStiffnessNm: 1e6, dampingRatio: 0,
    });
    expect(r.impactVelocityMs).toBeCloseTo(Math.sqrt(2 * 9.81), 5);
  });

  it('higher drop → higher peak G', () => {
    const lo = analyzeDropTest({ massKg: 1, dropHeightM: 0.1, contactStiffnessNm: 1e6, dampingRatio: 0.05 });
    const hi = analyzeDropTest({ massKg: 1, dropHeightM: 1.0, contactStiffnessNm: 1e6, dampingRatio: 0.05 });
    expect(hi.peakGLoad).toBeGreaterThan(lo.peakGLoad);
  });

  it('stiffer contact → higher G, shorter duration', () => {
    const soft = analyzeDropTest({ massKg: 1, dropHeightM: 1, contactStiffnessNm: 1e5, dampingRatio: 0 });
    const stiff = analyzeDropTest({ massKg: 1, dropHeightM: 1, contactStiffnessNm: 1e7, dampingRatio: 0 });
    expect(stiff.peakGLoad).toBeGreaterThan(soft.peakGLoad);
    expect(stiff.contactDurationMs).toBeLessThan(soft.contactDurationMs);
  });

  it('rebound coefficient = 0 → no rebound', () => {
    const r = analyzeDropTest({
      massKg: 1, dropHeightM: 1, contactStiffnessNm: 1e6, dampingRatio: 0.05,
      reboundCoefficient: 0,
    });
    expect(r.reboundVelocityMs).toBe(0);
  });
});

describe('analyzeRandomVibration', () => {
  const modes: ModeShape[] = [
    { frequencyHz: 100, dampingRatio: 0.02, participationFactor: 1, modalDisplacementMm: 1 },
    { frequencyHz: 200, dampingRatio: 0.02, participationFactor: 0.5, modalDisplacementMm: 0.5 },
  ];
  const psd = {
    frequenciesHz: [10, 50, 100, 500, 1000],
    psdValues: [0.04, 0.04, 0.04, 0.04, 0.04], // flat PSD g²/Hz
  };

  it('per-mode RMS array', () => {
    const r = analyzeRandomVibration(modes, psd);
    expect(r.rmsDisplacementByModeMm).toHaveLength(2);
  });

  it('3σ = 3 × RMS', () => {
    const r = analyzeRandomVibration(modes, psd);
    expect(r.threeSigmaDisplacementMm).toBeCloseTo(r.rmsDisplacementMm * 3, 5);
  });

  it('contributions sum ≈ 100%', () => {
    const r = analyzeRandomVibration(modes, psd);
    const total = r.modeContributions.reduce((s, c) => s + c, 0);
    expect(total).toBeCloseTo(100, 1);
  });

  it('zero damping → zero RMS (or skipped)', () => {
    const zeroDamp: ModeShape[] = [
      { frequencyHz: 100, dampingRatio: 0, participationFactor: 1, modalDisplacementMm: 1 },
    ];
    const r = analyzeRandomVibration(zeroDamp, psd);
    expect(r.rmsDisplacementByModeMm[0]).toBe(0);
  });
});

describe('analyzeHarmonicResponse', () => {
  const modes: ModeShape[] = [
    { frequencyHz: 100, dampingRatio: 0.02, participationFactor: 1, modalDisplacementMm: 1 },
  ];

  it('emits requested sample count', () => {
    const r = analyzeHarmonicResponse(modes, {
      startFreqHz: 10, endFreqHz: 1000, samples: 50, forceAmplitudeN: 100,
    });
    expect(r.frequenciesHz).toHaveLength(50);
    expect(r.displacementMm).toHaveLength(50);
  });

  it('peak at natural frequency', () => {
    const r = analyzeHarmonicResponse(modes, {
      startFreqHz: 50, endFreqHz: 200, samples: 100, forceAmplitudeN: 100, logarithmic: false,
    });
    // Highest displacement near 100Hz.
    let maxIdx = 0;
    for (let i = 1; i < r.displacementMm.length; i++) {
      if (r.displacementMm[i]! > r.displacementMm[maxIdx]!) maxIdx = i;
    }
    const peakFreq = r.frequenciesHz[maxIdx]!;
    expect(Math.abs(peakFreq - 100)).toBeLessThan(10);
  });

  it('detects resonance frequencies', () => {
    const r = analyzeHarmonicResponse(modes, {
      startFreqHz: 50, endFreqHz: 200, samples: 200, forceAmplitudeN: 100, logarithmic: false,
    });
    expect(r.resonanceFrequenciesHz.length).toBeGreaterThan(0);
  });
});

describe('transientSdof', () => {
  it('zero force → zero response', () => {
    const force = new Array(100).fill(0);
    const r = transientSdof(1, 1000, 0.5, force, { beta: 0.25, gamma: 0.5, timeStepS: 0.001, totalTimeS: 0.1 });
    expect(r.displacement.every(d => Math.abs(d) < 1e-9)).toBe(true);
  });

  it('step force produces oscillation', () => {
    const force = new Array(200).fill(10);
    const r = transientSdof(1, 1000, 5, force, { beta: 0.25, gamma: 0.5, timeStepS: 0.001, totalTimeS: 0.2 });
    // Final position approaches 10 / 1000 = 0.01.
    expect(Math.abs(r.displacement[r.displacement.length - 1]!)).toBeLessThan(0.05);
  });

  it('emits position + velocity + accel arrays of same length', () => {
    const force = new Array(50).fill(1);
    const r = transientSdof(1, 1000, 0.1, force, { beta: 0.25, gamma: 0.5, timeStepS: 0.001, totalTimeS: 0.05 });
    expect(r.displacement.length).toBe(50);
    expect(r.velocity.length).toBe(50);
    expect(r.acceleration.length).toBe(50);
  });
});
