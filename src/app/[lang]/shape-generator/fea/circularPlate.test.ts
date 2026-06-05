/**
 * circularPlate — axisymmetric circular-plate bending, verified: the flexural rigidity
 * Et³/(12(1−ν²)); the clamped uniform-load centre deflection qa⁴/(64D); the simply-
 * supported deflection (larger by (5+ν)/(1+ν)); the t³ stiffness dependence; and the
 * central point-load deflections (simply supported > clamped).
 */
import { describe, it, expect } from 'vitest';
import {
  flexuralRigidity, clampedUniform, simplySupportedUniform, clampedPointLoad, simplySupportedPointLoad,
} from './circularPlate';

const E = 200e9, t = 0.01, nu = 0.3, a = 0.5, q = 10000;
const D = flexuralRigidity(E, t, nu);

describe('circularPlate — axisymmetric bending (verified)', () => {
  it('the flexural rigidity is Et³/(12(1−ν²))', () => {
    expect(D).toBeCloseTo((E * t ** 3) / (12 * (1 - nu * nu)), 4);
  });

  it('clamped uniform-load centre deflection is qa⁴/(64D)', () => {
    expect(clampedUniform(q, a, D)).toBeCloseTo((q * a ** 4) / (64 * D), 9);
  });

  it('a simply-supported plate deflects more than a clamped one', () => {
    const ratio = simplySupportedUniform(q, a, D, nu) / clampedUniform(q, a, D);
    expect(ratio).toBeCloseTo((5 + nu) / (1 + nu), 6);   // ≈ 4.08
    expect(ratio).toBeGreaterThan(1);
  });

  it('doubling the thickness cuts the deflection to 1/8 (t³)', () => {
    const D2 = flexuralRigidity(E, 2 * t, nu);
    expect(clampedUniform(q, a, D2) / clampedUniform(q, a, D)).toBeCloseTo(1 / 8, 6);
  });

  it('central point load: simply supported deflects more than clamped', () => {
    const P = 5000;
    expect(clampedPointLoad(P, a, D)).toBeCloseTo((P * a * a) / (16 * Math.PI * D), 9);
    expect(simplySupportedPointLoad(P, a, D, nu)).toBeGreaterThan(clampedPointLoad(P, a, D));
    expect(simplySupportedPointLoad(P, a, D, nu) / clampedPointLoad(P, a, D)).toBeCloseTo((3 + nu) / (1 + nu), 6);
  });
});
