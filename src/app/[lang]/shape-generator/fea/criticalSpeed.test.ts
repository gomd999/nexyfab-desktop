/**
 * criticalSpeed — whirling speed of a rotating shaft, verified: the √(g/δ_st) ≡ √(k/m)
 * equivalence (mg = kδ_st); the single-mass Rayleigh quotient reducing to √(g/δ_st);
 * Dunkerley's combined speed falling below every individual critical speed; and the
 * rad/s→rpm conversion.
 */
import { describe, it, expect } from 'vitest';
import { criticalSpeed, criticalSpeedStiffness, toRPM, dunkerley, rayleighFrequency } from './criticalSpeed';

describe('criticalSpeed — shaft whirl (verified)', () => {
  const dst = 1e-3;

  it('gives √(g/δ_st) ≡ √(k/m) since mg = kδ_st', () => {
    const m = 1, k = (m * 9.80665) / dst;
    expect(criticalSpeed(dst)).toBeCloseTo(Math.sqrt(9.80665 / dst), 9); // 99.03 rad/s
    expect(criticalSpeed(dst)).toBeCloseTo(criticalSpeedStiffness(k, m), 9);
  });

  it('the single-mass Rayleigh quotient reduces to √(g/δ_st)', () => {
    expect(rayleighFrequency([10], [dst])).toBeCloseTo(criticalSpeed(dst), 9);
    // independent of the (single) weight value
    expect(rayleighFrequency([5], [dst])).toBeCloseTo(rayleighFrequency([50], [dst]), 9);
  });

  it("Dunkerley's combined speed is below every individual critical speed", () => {
    const w1 = 99, w2 = 140;
    const wc = dunkerley([w1, w2]);
    expect(wc).toBeLessThan(Math.min(w1, w2));
    expect(1 / (wc * wc)).toBeCloseTo(1 / w1 ** 2 + 1 / w2 ** 2, 9); // reciprocal-square sum
  });

  it('converts rad/s to rpm', () => {
    expect(toRPM(criticalSpeed(dst))).toBeCloseTo((criticalSpeed(dst) * 60) / (2 * Math.PI), 6); // ~945 rpm
  });
});
