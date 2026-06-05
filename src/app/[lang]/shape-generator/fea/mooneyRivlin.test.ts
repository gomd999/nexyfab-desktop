/**
 * mooneyRivlin — two-parameter incompressible hyperelasticity, verified against the
 * closed forms: uniaxial σ = 2(λ²−1/λ)(C10+C01/λ); reduction to Neo-Hookean at C01=0
 * (μ=2C10); simple shear τ = 2(C10+C01)γ (still exactly linear); small-strain modulus
 * μ = 2(C10+C01); and the C01 term reshaping the large-stretch response.
 */
import { describe, it, expect } from 'vitest';
import { uniaxialStress, simpleShear, shearModulus, jacobian } from './mooneyRivlin';
import { uniaxialStress as neoHookeanUniaxial } from './neoHookean';

const C10 = 0.3, C01 = 0.1;
const mu = shearModulus(C10, C01); // 0.8

describe('mooneyRivlin — two-parameter hyperelasticity (verified)', () => {
  it('uniaxial stress follows 2(λ²−1/λ)(C10+C01/λ)', () => {
    for (const lambda of [1.2, 1.5, 2, 3]) {
      const expected = 2 * (lambda * lambda - 1 / lambda) * (C10 + C01 / lambda);
      expect(uniaxialStress(lambda, C10, C01)).toBeCloseTo(expected, 10);
    }
  });

  it('reduces to Neo-Hookean when C01 = 0 (μ = 2·C10)', () => {
    for (const lambda of [1.5, 2.5]) {
      expect(uniaxialStress(lambda, 0.25, 0)).toBeCloseTo(neoHookeanUniaxial(lambda, 0.5), 10);
    }
  });

  it('simple shear is exactly linear τ = 2(C10+C01)γ at det F = 1', () => {
    for (const gamma of [0.25, 0.5, 1, 2]) {
      const r = simpleShear(gamma, C10, C01);
      expect(r.shear).toBeCloseTo(mu * gamma, 12);
      expect(r.jacobian).toBeCloseTo(1, 12);
    }
  });

  it('recovers E = 3μ = 6(C10+C01) in the small-strain limit', () => {
    const eps = 1e-5;
    expect(uniaxialStress(1 + eps, C10, C01) / eps).toBeCloseTo(3 * mu, 3);
  });

  it('the C01 term reshapes the large-stretch curve at fixed μ', () => {
    // both have μ = 0.8, but the response diverges at large λ.
    const lambda = 4;
    const mixed = uniaxialStress(lambda, 0.2, 0.2);
    const pureNH = uniaxialStress(lambda, 0.4, 0);
    expect(mu).toBeCloseTo(shearModulus(0.2, 0.2), 12);
    expect(mixed).toBeLessThan(pureNH);                 // C01 softens the upturn
    // ...yet they agree to leading order at small stretch.
    expect(uniaxialStress(1.01, 0.2, 0.2) / uniaxialStress(1.01, 0.4, 0)).toBeCloseTo(1, 2);
  });

  it('is incompressible: det F = 1', () => {
    const lambda = 3, lt = 1 / Math.sqrt(lambda);
    expect(jacobian([[lambda, 0, 0], [0, lt, 0], [0, 0, lt]])).toBeCloseTo(1, 12);
  });
});
