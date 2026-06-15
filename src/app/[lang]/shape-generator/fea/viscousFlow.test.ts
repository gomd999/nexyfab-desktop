/**
 * viscousFlow — laminar Couette and Hagen–Poiseuille flow, verified: the linear Couette
 * profile with uniform shear; the Q ∝ R⁴ pipe law; the centreline velocity being twice
 * the mean; and the mean velocity ū = Q/(πR²).
 */
import { describe, it, expect } from 'vitest';
import { couetteShearStress, couetteVelocity, hagenPoiseuilleFlow, poiseuilleMaxVelocity, poiseuilleMeanVelocity, pipeWallShear } from './viscousFlow';

describe('viscousFlow — Couette & Poiseuille (verified)', () => {
  it('has a linear Couette profile with uniform shear', () => {
    const U = 2, h = 0.01, mu = 1e-3;
    expect(couetteVelocity(U, h, h)).toBeCloseTo(U, 12);   // moving plate
    expect(couetteVelocity(U, 0, h)).toBeCloseTo(0, 12);   // stationary plate
    expect(couetteVelocity(U, h / 2, h)).toBeCloseTo(U / 2, 12); // linear
    expect(couetteShearStress(mu, U, h)).toBeCloseTo((mu * U) / h, 12);
  });

  it('obeys the Hagen–Poiseuille Q ∝ R⁴ law', () => {
    const R = 0.01, dp = 1000, mu = 1e-3, L = 1;
    expect(hagenPoiseuilleFlow(R, dp, mu, L)).toBeCloseTo((Math.PI * R ** 4 * dp) / (8 * mu * L), 15);
    expect(hagenPoiseuilleFlow(2 * R, dp, mu, L) / hagenPoiseuilleFlow(R, dp, mu, L)).toBeCloseTo(16, 9);
  });

  it('has a centreline velocity twice the mean', () => {
    const R = 0.01, dp = 1000, mu = 1e-3, L = 1;
    expect(poiseuilleMaxVelocity(R, dp, mu, L)).toBeCloseTo(2 * poiseuilleMeanVelocity(R, dp, mu, L), 12);
  });

  it('relates mean velocity to flow ū = Q/(πR²) and gives the wall shear', () => {
    const R = 0.01, dp = 1000, mu = 1e-3, L = 1;
    const Q = hagenPoiseuilleFlow(R, dp, mu, L);
    expect(poiseuilleMeanVelocity(R, dp, mu, L)).toBeCloseTo(Q / (Math.PI * R * R), 9);
    expect(pipeWallShear(R, dp, L)).toBeCloseTo((R * dp) / (2 * L), 12);
  });
});
