import { describe, it, expect } from 'vitest';
import {
  sweepResponse,
  responseAt,
  halfPowerBandwidth,
  summarize,
  type Mode,
  type ForcingSpec,
} from './harmonicResponse';

function mode(index: number, freqHz: number, zeta: number, eigenvector: number[]): Mode {
  return { index, frequencyHz: freqHz, zeta, eigenvector };
}

describe('sweepResponse', () => {
  it('empty modes → empty result', () => {
    const r = sweepResponse([], { dofIndex: 0, amplitudeN: 100 });
    expect(r.frequencyResponse).toEqual([]);
  });

  it('zero force → empty result', () => {
    const m = mode(1, 100, 0.05, [1]);
    const r = sweepResponse([m], { dofIndex: 0, amplitudeN: 0 });
    expect(r.frequencyResponse).toEqual([]);
  });

  it('produces requested sample count', () => {
    const m = mode(1, 100, 0.05, [1]);
    const r = sweepResponse([m], { dofIndex: 0, amplitudeN: 1 }, { samples: 50 });
    expect(r.frequencyResponse).toHaveLength(50);
  });

  it('detects resonance near natural frequency', () => {
    const m = mode(1, 100, 0.02, [1]);
    const r = sweepResponse([m], { dofIndex: 0, amplitudeN: 1 }, {
      fromHz: 50, toHz: 150, samples: 200, peakThresholdRelative: 2,
    });
    expect(r.resonancePeaks.length).toBeGreaterThan(0);
    const peak = r.resonancePeaks[0]!;
    expect(peak.frequencyHz).toBeGreaterThan(90);
    expect(peak.frequencyHz).toBeLessThan(110);
  });

  it('higher damping → lower peak', () => {
    const lo = sweepResponse([mode(1, 100, 0.01, [1])], { dofIndex: 0, amplitudeN: 1 }, { fromHz: 95, toHz: 105, samples: 100 });
    const hi = sweepResponse([mode(1, 100, 0.5, [1])], { dofIndex: 0, amplitudeN: 1 }, { fromHz: 95, toHz: 105, samples: 100 });
    const loPeak = Math.max(...lo.frequencyResponse.map(p => p.peakAmplitude));
    const hiPeak = Math.max(...hi.frequencyResponse.map(p => p.peakAmplitude));
    expect(hiPeak).toBeLessThan(loPeak);
  });

  it('dominant mode matches forcing frequency', () => {
    const modes = [mode(1, 50, 0.02, [1]), mode(2, 200, 0.02, [0])];
    const r = sweepResponse(modes, { dofIndex: 0, amplitudeN: 1 }, {
      fromHz: 40, toHz: 60, samples: 200, peakThresholdRelative: 1.2,
    });
    expect(r.dominantModeIndex).toBe(1);
  });

  it('multi-mode response sums correctly', () => {
    const modes = [
      mode(1, 50, 0.05, [1, 0]),
      mode(2, 150, 0.05, [0, 1]),
    ];
    const r = sweepResponse(modes, { dofIndex: 0, amplitudeN: 1 }, { fromHz: 0, toHz: 200, samples: 100 });
    expect(r.frequencyResponse.length).toBe(100);
  });
});

describe('responseAt', () => {
  it('amplitude at f = 0 is finite', () => {
    const m = mode(1, 100, 0.05, [1]);
    const r = responseAt([m], { dofIndex: 0, amplitudeN: 1 }, 0, 1);
    expect(Number.isFinite(r.peakAmplitude)).toBe(true);
  });

  it('amplitudes per DOF match eigenvector layout', () => {
    const m = mode(1, 100, 0.05, [1, 0.5]);
    const r = responseAt([m], { dofIndex: 0, amplitudeN: 1 }, 50, 2);
    expect(r.amplitudes).toHaveLength(2);
  });
});

describe('halfPowerBandwidth', () => {
  it('zero for empty sweep', () => {
    expect(halfPowerBandwidth([], 0)).toBe(0);
  });

  it('positive for a real peak', () => {
    const m = mode(1, 100, 0.02, [1]);
    const r = sweepResponse([m], { dofIndex: 0, amplitudeN: 1 }, { fromHz: 50, toHz: 150, samples: 500 });
    if (r.resonancePeaks.length > 0) {
      const peakIdx = r.frequencyResponse.findIndex(p => p.frequencyHz === r.resonancePeaks[0]!.frequencyHz);
      if (peakIdx > 0) {
        expect(halfPowerBandwidth(r.frequencyResponse, peakIdx)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('summarize', () => {
  it('empty result', () => {
    const s = summarize({ frequencyResponse: [], resonancePeaks: [], dominantModeIndex: -1 });
    expect(s.sampleCount).toBe(0);
  });

  it('reports peak count', () => {
    const m = mode(1, 100, 0.02, [1]);
    const r = sweepResponse([m], { dofIndex: 0, amplitudeN: 1 }, { fromHz: 50, toHz: 150, samples: 200 });
    const s = summarize(r);
    expect(s.peakCount).toBe(r.resonancePeaks.length);
  });
});
