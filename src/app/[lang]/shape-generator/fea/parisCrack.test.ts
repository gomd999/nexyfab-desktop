/**
 * parisCrack — fatigue crack growth by the Paris law, verified: ΔK = Y·Δσ·√(πa);
 * da/dN = C·ΔK^m; the critical crack a_c = (K_Ic/(Y·σ))²/π; the closed-form cycles to
 * failure equals a direct numerical integration; and the life scales as 1/Δσ^m.
 */
import { describe, it, expect } from 'vitest';
import {
  stressIntensityRange, crackGrowthRate, criticalCrackLength, cyclesToFailure, integrateCrack, ParisMaterial,
} from './parisCrack';

const mat: ParisMaterial = { C: 1e-11, m: 3, Y: 1.12 };
const dSigma = 100, Kic = 50, sigmaMax = 100, a0 = 0.001;
const ac = criticalCrackLength(Kic, sigmaMax, mat.Y);

describe('parisCrack — Paris-law crack growth (verified)', () => {
  it('the stress-intensity range and growth rate follow the Paris forms', () => {
    expect(stressIntensityRange(dSigma, 0.01, mat.Y)).toBeCloseTo(mat.Y * dSigma * Math.sqrt(Math.PI * 0.01), 8);
    const dK = stressIntensityRange(dSigma, a0, mat.Y);
    expect(crackGrowthRate(dK, mat)).toBeCloseTo(mat.C * dK ** mat.m, 18);
  });

  it('the critical crack length is a_c = (K_Ic/(Y·σ))²/π', () => {
    expect(ac).toBeCloseTo((Kic / (mat.Y * sigmaMax)) ** 2 / Math.PI, 10);
    // K reaches the toughness there.
    expect(mat.Y * sigmaMax * Math.sqrt(Math.PI * ac)).toBeCloseTo(Kic, 8);
  });

  it('the closed-form life equals a direct numerical integration', () => {
    const closed = cyclesToFailure(a0, ac, dSigma, mat);
    const numeric = integrateCrack(a0, ac, dSigma, mat);
    expect(numeric / closed).toBeGreaterThan(0.999);
    expect(numeric / closed).toBeLessThan(1.001);
    expect(closed).toBeGreaterThan(0);
  });

  it('life scales as 1/Δσ^m (at a fixed crack interval)', () => {
    const base = cyclesToFailure(a0, ac, dSigma, mat);
    expect(cyclesToFailure(a0, ac, 2 * dSigma, mat) / base).toBeCloseTo(1 / 2 ** mat.m, 6); // 1/8
  });

  it('a larger initial crack gives a shorter life', () => {
    const small = cyclesToFailure(a0, ac, dSigma, mat);
    const large = cyclesToFailure(5 * a0, ac, dSigma, mat);
    expect(large).toBeLessThan(small);
    expect(large).toBeGreaterThan(0);
  });
});
