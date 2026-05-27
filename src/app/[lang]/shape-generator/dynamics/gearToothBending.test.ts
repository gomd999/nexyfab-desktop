import { describe, it, expect } from 'vitest';
import { compute, lewisFormFactor, summarize, type GearToothInput } from './gearToothBending';

const base: GearToothInput = {
  torqueNm: 100, pitchDiameterMm: 80, moduleMm: 4, faceWidthMm: 40,
  toothCount: 20, rotationalSpeedRpm: 1000, allowableStressMpa: 200,
};

describe('compute', () => {
  it('tangential force = 2T/d', () => {
    const r = compute(base);
    expect(r.tangentialForceN).toBeCloseTo((100 * 1000 * 2) / 80, 3);
  });

  it('pitch-line velocity = π·d·N/60', () => {
    const r = compute(base);
    expect(r.pitchLineVelocityMS).toBeCloseTo((Math.PI * 0.08 * 1000) / 60, 5);
  });

  it('higher speed → higher dynamic factor → more stress', () => {
    const slow = compute({ ...base, rotationalSpeedRpm: 200 });
    const fast = compute({ ...base, rotationalSpeedRpm: 3000 });
    expect(fast.dynamicFactorKv).toBeGreaterThan(slow.dynamicFactorKv);
    expect(fast.bendingStressMpa).toBeGreaterThan(slow.bendingStressMpa);
  });

  it('bigger module + face → lower stress', () => {
    const small = compute({ ...base, moduleMm: 2, faceWidthMm: 20 });
    const big = compute({ ...base, moduleMm: 6, faceWidthMm: 60 });
    expect(big.bendingStressMpa).toBeLessThan(small.bendingStressMpa);
  });

  it('safety factor = allowable / design stress', () => {
    const r = compute(base);
    expect(r.safetyFactor).toBeCloseTo(200 / r.bendingStressMpa, 5);
  });

  it('passes flag matches SF ≥ 1', () => {
    const r = compute(base);
    expect(r.passes).toBe(r.safetyFactor >= 1);
  });

  it('overloaded → fail + warning', () => {
    const r = compute({ ...base, torqueNm: 5000, allowableStressMpa: 100 });
    expect(r.passes).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('zero module → warning', () => {
    expect(compute({ ...base, moduleMm: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('lewisFormFactor', () => {
  it('rises with tooth count', () => {
    expect(lewisFormFactor(60)).toBeGreaterThan(lewisFormFactor(14));
  });

  it('clamps below min', () => {
    expect(lewisFormFactor(8)).toBeCloseTo(0.245, 3);
  });

  it('interpolates between table points', () => {
    const y = lewisFormFactor(22);
    expect(y).toBeGreaterThan(lewisFormFactor(20));
    expect(y).toBeLessThan(lewisFormFactor(25));
  });
});

describe('summarize', () => {
  it('reports stress + SF', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.bendingStressMpa).toBe(r.bendingStressMpa);
    expect(s.passes).toBe(r.passes);
  });
});
