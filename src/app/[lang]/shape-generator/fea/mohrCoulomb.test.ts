/**
 * mohrCoulomb — Mohr-Coulomb failure criterion, verified: the flow factor
 * N_φ=tan²(45°+φ/2); the uniaxial compressive strength 2c√N_φ (with the yield function
 * zero there); the confined failure stress σ1=σ3·N_φ+2c√N_φ; the reduction to Tresca at
 * φ=0; and the strengthening with friction angle and confinement.
 */
import { describe, it, expect } from 'vitest';
import { flowFactor, yieldFunction, failureStress1, uniaxialCompressiveStrength, uniaxialTensileStrength } from './mohrCoulomb';

const deg = (d: number) => (d * Math.PI) / 180;
const c = 20, phi = deg(30);

describe('mohrCoulomb — frictional failure criterion (verified)', () => {
  it('the flow factor is N_φ = tan²(45°+φ/2)', () => {
    expect(flowFactor(phi)).toBeCloseTo(Math.tan(deg(45) + phi / 2) ** 2, 9); // = 3
  });

  it('the uniaxial compressive strength is 2c√N_φ (yield function = 0 there)', () => {
    const sc = uniaxialCompressiveStrength(c, phi);
    expect(sc).toBeCloseTo(2 * c * Math.sqrt(flowFactor(phi)), 6);
    expect(yieldFunction(sc, 0, c, phi)).toBeCloseTo(0, 9);
    expect(uniaxialTensileStrength(c, phi)).toBeLessThan(sc);  // weaker in tension
  });

  it('confinement raises the failure stress: σ1 = σ3·N_φ + 2c√N_φ', () => {
    const s3 = 50;
    const s1 = failureStress1(s3, c, phi);
    expect(s1).toBeCloseTo(s3 * flowFactor(phi) + 2 * c * Math.sqrt(flowFactor(phi)), 6);
    expect(yieldFunction(s1, s3, c, phi)).toBeCloseTo(0, 9);   // on the failure surface
    expect(s1).toBeGreaterThan(failureStress1(0, c, phi));     // confinement strengthens
  });

  it('reduces to the Tresca criterion at φ = 0 (max shear = c)', () => {
    expect(yieldFunction(100, 40, c, 0)).toBeCloseTo((100 - 40) / 2 - c, 9);
    expect(flowFactor(0)).toBeCloseTo(1, 12);
  });

  it('a higher friction angle gives a stronger material', () => {
    expect(uniaxialCompressiveStrength(c, deg(40))).toBeGreaterThan(uniaxialCompressiveStrength(c, deg(20)));
    // below the failure surface the yield function is negative (safe).
    expect(yieldFunction(40, 0, c, phi)).toBeLessThan(0);
  });
});
