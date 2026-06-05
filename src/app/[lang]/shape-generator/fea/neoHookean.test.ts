/**
 * neoHookean — incompressible Neo-Hookean hyperelasticity, verified against the
 * closed-form homogeneous deformations: uniaxial σ = μ(λ²−1/λ) (recovering E = 3μ in
 * the small-strain limit), equibiaxial σ = μ(λ²−1/λ⁴), and the Neo-Hookean signature
 * of an exactly LINEAR simple-shear response τ = μγ with N1 = μγ² — all at det F = 1.
 */
import { describe, it, expect } from 'vitest';
import { uniaxialStress, equibiaxialStress, simpleShear, jacobian } from './neoHookean';

const mu = 0.5;

describe('neoHookean — incompressible hyperelasticity (verified)', () => {
  it('uniaxial stress follows μ(λ²−1/λ) at large stretch', () => {
    for (const lambda of [1.2, 1.5, 2, 3]) {
      expect(uniaxialStress(lambda, mu)).toBeCloseTo(mu * (lambda * lambda - 1 / lambda), 10);
    }
  });

  it('recovers linear elasticity E = 3μ in the small-strain limit', () => {
    const eps = 1e-5;
    expect(uniaxialStress(1 + eps, mu) / eps).toBeCloseTo(3 * mu, 3); // E = 3μ (ν=½)
  });

  it('simple shear is exactly LINEAR (τ = μγ) with N1 = μγ² (the Neo-Hookean signature)', () => {
    for (const gamma of [0.25, 0.5, 1, 2]) {
      const r = simpleShear(gamma, mu);
      expect(r.shear).toBeCloseTo(mu * gamma, 12);          // τ stays linear at all γ
      expect(r.N1).toBeCloseTo(mu * gamma * gamma, 12);     // first normal-stress difference
      expect(r.jacobian).toBeCloseTo(1, 12);                // isochoric
    }
  });

  it('equibiaxial stress follows μ(λ²−1/λ⁴)', () => {
    for (const lambda of [1.3, 2]) {
      expect(equibiaxialStress(lambda, mu)).toBeCloseTo(mu * (lambda * lambda - 1 / lambda ** 4), 10);
    }
  });

  it('is incompressible: det F = 1 for the homogeneous deformations', () => {
    const lambda = 2.5, lt = 1 / Math.sqrt(lambda);
    expect(jacobian([[lambda, 0, 0], [0, lt, 0], [0, 0, lt]])).toBeCloseTo(1, 12);
    expect(jacobian([[1, 1.5, 0], [0, 1, 0], [0, 0, 1]])).toBeCloseTo(1, 12); // shear
  });

  it('stiffens under stretch (rising tangent) — strain hardening', () => {
    const dlam = 1e-4;
    const tangent = (lambda: number) => (uniaxialStress(lambda + dlam, mu) - uniaxialStress(lambda, mu)) / dlam;
    expect(tangent(2)).toBeGreaterThan(tangent(1.2));       // dσ/dλ grows with λ
  });
});
