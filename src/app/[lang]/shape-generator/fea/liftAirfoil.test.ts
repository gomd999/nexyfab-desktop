/**
 * liftAirfoil — Kutta–Joukowski lift and thin-airfoil theory, verified: the lift per span
 * L'=ρVΓ; the thin-airfoil C_L=2πα; the consistency of the two lift expressions
 * ρVΓ ≡ q·c·C_L; and the C_L=L/(qS) inverse.
 */
import { describe, it, expect } from 'vitest';
import { kuttaJoukowskiLift, dynamicPressure, liftCoefficient, liftFromCoefficient, thinAirfoilCL, thinAirfoilCirculation } from './liftAirfoil';

describe('liftAirfoil — Kutta–Joukowski + thin airfoil (verified)', () => {
  const rho = 1.225, V = 50, c = 1.5, alpha = (5 * Math.PI) / 180;

  it('gives the thin-airfoil lift slope C_L = 2πα', () => {
    expect(thinAirfoilCL(alpha)).toBeCloseTo(2 * Math.PI * alpha, 12); // 0.548 at 5°
    expect(thinAirfoilCL(alpha) / thinAirfoilCL(alpha / 2)).toBeCloseTo(2, 12); // linear in α
  });

  it('makes ρVΓ and q·c·C_L consistent', () => {
    const Gamma = thinAirfoilCirculation(c, V, alpha);
    const Lkj = kuttaJoukowskiLift(rho, V, Gamma);
    const q = dynamicPressure(rho, V);
    const Lcl = liftFromCoefficient(thinAirfoilCL(alpha), q, c);
    expect(Lkj).toBeCloseTo(Lcl, 6);                          // the two lift forms agree
  });

  it('recovers C_L from the Kutta–Joukowski lift', () => {
    const Gamma = thinAirfoilCirculation(c, V, alpha);
    const Lkj = kuttaJoukowskiLift(rho, V, Gamma);
    const q = dynamicPressure(rho, V);
    expect(liftCoefficient(Lkj, q, c)).toBeCloseTo(thinAirfoilCL(alpha), 9);
  });

  it('scales lift with V² at fixed angle of attack', () => {
    // Γ ∝ V, so L' = ρVΓ ∝ V²
    const g1 = thinAirfoilCirculation(c, V, alpha), g2 = thinAirfoilCirculation(c, 2 * V, alpha);
    const L1 = kuttaJoukowskiLift(rho, V, g1), L2 = kuttaJoukowskiLift(rho, 2 * V, g2);
    expect(L2 / L1).toBeCloseTo(4, 9);
  });
});
