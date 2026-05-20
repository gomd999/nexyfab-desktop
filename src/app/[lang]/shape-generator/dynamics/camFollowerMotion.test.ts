import { describe, it, expect } from 'vitest';
import {
  generate,
  peakAccelCoefficient,
  summarize,
  type CamSegmentInput,
} from './camFollowerMotion';

const base: CamSegmentInput = {
  liftMm: 20,
  segmentAngleDeg: 90,
  camSpeedRpm: 300,
  law: 'cycloidal',
};

describe('generate', () => {
  it('starts at 0, ends at full lift', () => {
    const r = generate(base);
    expect(r.profile[0]!.displacementMm).toBeCloseTo(0, 4);
    expect(r.profile[r.profile.length - 1]!.displacementMm).toBeCloseTo(20, 4);
  });

  it('fall segment goes lift → 0', () => {
    const r = generate({ ...base, fall: true });
    expect(r.profile[0]!.displacementMm).toBeCloseTo(20, 4);
    expect(r.profile[r.profile.length - 1]!.displacementMm).toBeCloseTo(0, 4);
  });

  it('cycloidal has zero acceleration at both ends', () => {
    const r = generate({ ...base, law: 'cycloidal' });
    expect(Math.abs(r.profile[0]!.accelerationMmS2)).toBeLessThan(1);
    expect(Math.abs(r.profile[r.profile.length - 1]!.accelerationMmS2)).toBeLessThan(1);
  });

  it('SHM nonzero acceleration at ends', () => {
    const r = generate({ ...base, law: 'simple-harmonic' });
    expect(Math.abs(r.profile[0]!.accelerationMmS2)).toBeGreaterThan(1);
  });

  it('peak velocity positive', () => {
    expect(generate(base).peakVelocityMmS).toBeGreaterThan(0);
  });

  it('cycloidal peak accel > SHM peak accel (same lift/segment)', () => {
    const cyc = generate({ ...base, law: 'cycloidal' });
    const shm = generate({ ...base, law: 'simple-harmonic' });
    expect(cyc.peakAccelerationMmS2).toBeGreaterThan(shm.peakAccelerationMmS2);
  });

  it('uniform law → constant velocity, zero interior accel', () => {
    const r = generate({ ...base, law: 'uniform' });
    const mid = r.profile[Math.floor(r.profile.length / 2)]!;
    expect(mid.accelerationMmS2).toBeCloseTo(0, 4);
  });

  it('higher cam speed → higher peak velocity', () => {
    const slow = generate({ ...base, camSpeedRpm: 100 });
    const fast = generate({ ...base, camSpeedRpm: 600 });
    expect(fast.peakVelocityMmS).toBeGreaterThan(slow.peakVelocityMmS);
  });

  it('zero lift → warning', () => {
    const r = generate({ ...base, liftMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('peakAccelCoefficient', () => {
  it('uniform → Infinity', () => {
    expect(peakAccelCoefficient('uniform')).toBe(Infinity);
  });

  it('cycloidal (2π) > SHM (π²/2) > parabolic (4)', () => {
    expect(peakAccelCoefficient('cycloidal')).toBeGreaterThan(peakAccelCoefficient('simple-harmonic'));
    expect(peakAccelCoefficient('simple-harmonic')).toBeGreaterThan(peakAccelCoefficient('parabolic'));
  });
});

describe('summarize', () => {
  it('reports law + peaks', () => {
    const r = generate(base);
    const s = summarize(r);
    expect(s.law).toBe('cycloidal');
    expect(s.peakVelocityMmS).toBe(r.peakVelocityMmS);
  });
});
