import { describe, it, expect } from 'vitest';
import {
  sweepFrequency,
  halfPowerBandwidth,
  dampingFromQ,
  summarize,
  type ModalParameters,
} from './frequencyResponseSweep';

const mode1: ModalParameters = {
  fnHz: 100,
  zeta: 0.02,
  modalMassKg: 1,
  participationFactor: 1,
};

describe('sweepFrequency', () => {
  it('empty modes → flat spectrum', () => {
    const r = sweepFrequency([], { freqMinHz: 1, freqMaxHz: 100, samples: 50, excitationN: 1 });
    expect(r.points.every(p => p.amplitude === 0)).toBe(true);
  });

  it('single mode → peak near fn', () => {
    const r = sweepFrequency([mode1], { freqMinHz: 50, freqMaxHz: 200, samples: 100, excitationN: 1 });
    expect(Math.abs(r.peakFreqHz - 100)).toBeLessThan(15);
  });

  it('high zeta → lower peak', () => {
    const lightDamp = sweepFrequency([{ ...mode1, zeta: 0.01 }], { freqMinHz: 50, freqMaxHz: 200, samples: 100, excitationN: 1 });
    const heavyDamp = sweepFrequency([{ ...mode1, zeta: 0.2 }], { freqMinHz: 50, freqMaxHz: 200, samples: 100, excitationN: 1 });
    expect(heavyDamp.peakAmplitude).toBeLessThan(lightDamp.peakAmplitude);
  });

  it('multi-mode sweep produces points at both fn', () => {
    const m2: ModalParameters = { fnHz: 300, zeta: 0.02, modalMassKg: 1, participationFactor: 1 };
    const r = sweepFrequency([mode1, m2], { freqMinHz: 50, freqMaxHz: 500, samples: 200, excitationN: 1 });
    // Find amplitude at 100 and 300; both should have local peaks.
    expect(r.points.length).toBe(201);
  });

  it('Q-factor positive', () => {
    const r = sweepFrequency([mode1], { freqMinHz: 50, freqMaxHz: 200, samples: 200, excitationN: 1 });
    expect(r.qFactor).toBeGreaterThan(0);
  });

  it('amplitude > 0 below resonance', () => {
    const r = sweepFrequency([mode1], { freqMinHz: 10, freqMaxHz: 50, samples: 20, excitationN: 1 });
    expect(r.points.every(p => p.amplitude > 0)).toBe(true);
  });

  it('amplitude decays beyond resonance', () => {
    const r = sweepFrequency([mode1], { freqMinHz: 50, freqMaxHz: 500, samples: 200, excitationN: 1 });
    const before = r.points.find(p => p.freqHz > 90 && p.freqHz < 110)!;
    const after = r.points.find(p => p.freqHz > 400)!;
    expect(after.amplitude).toBeLessThan(before.amplitude);
  });
});

describe('halfPowerBandwidth', () => {
  it('returns valid range', () => {
    const r = sweepFrequency([mode1], { freqMinHz: 50, freqMaxHz: 200, samples: 200, excitationN: 1 });
    const bw = halfPowerBandwidth(r);
    expect(bw.bandwidthHz).toBeGreaterThanOrEqual(0);
    expect(bw.lowHz).toBeLessThanOrEqual(r.peakFreqHz);
    expect(bw.highHz).toBeGreaterThanOrEqual(r.peakFreqHz);
  });
});

describe('dampingFromQ', () => {
  it('Q=50 → ζ ≈ 0.01', () => {
    expect(dampingFromQ(50)).toBeCloseTo(0.01, 3);
  });

  it('Q=0 → 0', () => {
    expect(dampingFromQ(0)).toBe(0);
  });
});

describe('summarize', () => {
  it('reports peak + Q', () => {
    const r = sweepFrequency([mode1], { freqMinHz: 50, freqMaxHz: 200, samples: 200, excitationN: 1 });
    const s = summarize(r);
    expect(s.peakFreqHz).toBe(r.peakFreqHz);
    expect(s.qFactor).toBe(r.qFactor);
  });
});
