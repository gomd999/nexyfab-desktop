import { describe, it, expect } from 'vitest';
import { compute, motionFraction, peakDrivenVelocityRadS, summarize, type GenevaInput } from './genevaMechanism';

const base: GenevaInput = { slots: 4, drivePinRadiusMm: 30, driveSpeedRpm: 60 };

describe('compute', () => {
  it('index angle = 360/n', () => {
    expect(compute(base).indexAngleDeg).toBeCloseTo(90, 5);
  });

  it('motion + dwell = 360', () => {
    const r = compute(base);
    expect(r.motionAngleDeg + r.dwellAngleDeg).toBeCloseTo(360, 5);
  });

  it('centre distance = r / sin(π/n)', () => {
    const r = compute(base);
    expect(r.centreDistanceMm).toBeCloseTo(30 / Math.sin(Math.PI / 4), 4);
  });

  it('more slots → smaller index angle', () => {
    const four = compute({ ...base, slots: 4 });
    const eight = compute({ ...base, slots: 8 });
    expect(eight.indexAngleDeg).toBeLessThan(four.indexAngleDeg);
  });

  it('peak velocity ratio positive', () => {
    expect(compute(base).peakVelocityRatio).toBeGreaterThan(0);
  });

  it('fewer slots → higher peak velocity ratio (jerkier)', () => {
    const three = compute({ ...base, slots: 3 });
    const eight = compute({ ...base, slots: 8 });
    expect(three.peakVelocityRatio).toBeGreaterThan(eight.peakVelocityRatio);
  });

  it('peak acceleration ratio positive', () => {
    expect(compute(base).peakAccelRatio).toBeGreaterThan(0);
  });

  it('< 3 slots → warning', () => {
    expect(compute({ ...base, slots: 2 }).warnings.length).toBeGreaterThan(0);
  });

  it('zero pin radius → warning', () => {
    expect(compute({ ...base, drivePinRadiusMm: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('motionFraction', () => {
  it('= 1/slots', () => {
    expect(motionFraction(4)).toBeCloseTo(0.25, 6);
  });

  it('< 3 → 0', () => {
    expect(motionFraction(2)).toBe(0);
  });
});

describe('peakDrivenVelocityRadS', () => {
  it('scales with drive speed', () => {
    const r = compute(base);
    const slow = peakDrivenVelocityRadS(r, 30);
    const fast = peakDrivenVelocityRadS(r, 120);
    expect(fast).toBeCloseTo(slow * 4, 4);
  });
});

describe('summarize', () => {
  it('reports index + peak vel + dwell', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.indexAngleDeg).toBe(r.indexAngleDeg);
    expect(s.peakVelocityRatio).toBe(r.peakVelocityRatio);
  });
});
