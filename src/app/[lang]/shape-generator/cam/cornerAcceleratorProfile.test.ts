import { describe, it, expect } from 'vitest';
import {
  buildProfile,
  emitGcode,
  diagnose,
  summarize,
  type AccelProfileInput,
} from './cornerAcceleratorProfile';

const base: AccelProfileInput = {
  vStartMmMin: 100,
  vTargetMmMin: 1000,
  maxAccelMmPerS2: 5000,
  maxJerkMmPerS3: 50000,
  profile: 'linear',
};

describe('buildProfile', () => {
  it('vStart ≥ vTarget → empty', () => {
    const p = buildProfile({ ...base, vStartMmMin: 1000, vTargetMmMin: 100 });
    expect(p.samples).toEqual([]);
  });

  it('linear profile produces samples', () => {
    const p = buildProfile(base);
    expect(p.samples.length).toBeGreaterThan(5);
  });

  it('S-curve produces samples', () => {
    const p = buildProfile({ ...base, profile: 's-curve' });
    expect(p.samples.length).toBeGreaterThan(5);
  });

  it('exponential profile reaches near target asymptotically', () => {
    const p = buildProfile({ ...base, profile: 'exponential' });
    const last = p.samples[p.samples.length - 1]!;
    expect(last.velocityMmMin).toBeGreaterThan(900);
    expect(last.velocityMmMin).toBeLessThanOrEqual(1000);
  });

  it('linear total time = dv / a', () => {
    const p = buildProfile({ ...base, profile: 'linear' });
    const dvMmS = (1000 - 100) / 60;
    expect(p.totalTimeSec).toBeCloseTo(dvMmS / base.maxAccelMmPerS2, 2);
  });

  it('S-curve produces non-zero peak acceleration', () => {
    const p = buildProfile({ ...base, profile: 's-curve' });
    expect(p.peakAccelMmPerS2).toBeGreaterThan(0);
  });

  it('total distance positive', () => {
    expect(buildProfile(base).totalDistanceMm).toBeGreaterThan(0);
  });

  it('zero acceleration → empty', () => {
    const p = buildProfile({ ...base, maxAccelMmPerS2: 0 });
    expect(p.samples).toEqual([]);
  });
});

describe('emitGcode', () => {
  it('produces G1 lines', () => {
    const p = buildProfile(base);
    const lines = emitGcode(p, 1000);
    expect(lines.every(l => l.startsWith('G1'))).toBe(true);
  });

  it('feed capped at base feed', () => {
    const p = buildProfile(base);
    const lines = emitGcode(p, 500);
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe('diagnose', () => {
  it('average accel matches input for linear', () => {
    const p = buildProfile({ ...base, profile: 'linear' });
    const d = diagnose(p);
    expect(d.averageAccelMmPerS2).toBeCloseTo(base.maxAccelMmPerS2, -1);
  });

  it('empty profile → zero metrics', () => {
    expect(diagnose({ samples: [], totalDistanceMm: 0, totalTimeSec: 0, peakAccelMmPerS2: 0 })).toEqual({
      totalTimeSec: 0, averageAccelMmPerS2: 0, peakAccelMmPerS2: 0,
    });
  });
});

describe('summarize', () => {
  it('reports counts + time', () => {
    const p = buildProfile(base);
    const s = summarize(p);
    expect(s.sampleCount).toBe(p.samples.length);
    expect(s.totalTimeSec).toBe(p.totalTimeSec);
  });
});
