/**
 * hertzContact — Hertzian elastic contact, verified against the closed forms: the
 * contact radius a=(3FR/4E*)^(1/3), peak pressure p0=3F/(2πa²), approach δ=a²/R, the
 * hemispherical pressure integrating to the applied force ∫p dA=F, and the nonlinear
 * force–approach law F ∝ δ^(3/2).
 */
import { describe, it, expect } from 'vitest';
import {
  effectiveModulus, effectiveRadius, contactRadius, maxPressure, approach,
  forceFromApproach, integratedForce,
} from './hertzContact';

const Estar = effectiveModulus(210000, 0.3, 210000, 0.3);
const R = 10, F = 100;

describe('hertzContact — sphere contact (verified)', () => {
  it('contact radius, peak pressure and approach match the Hertz formulas', () => {
    const a = contactRadius(F, R, Estar);
    expect(a).toBeCloseTo(Math.cbrt((3 * F * R) / (4 * Estar)), 10);
    expect(maxPressure(F, a)).toBeCloseTo((3 * F) / (2 * Math.PI * a * a), 8);
    expect(approach(F, R, Estar)).toBeCloseTo((a * a) / R, 10);
  });

  it('the hemispherical pressure integrates to the applied force (∫p dA = F)', () => {
    const a = contactRadius(F, R, Estar), p0 = maxPressure(F, a);
    expect(integratedForce(a, p0) / F).toBeGreaterThan(0.999);
    expect(integratedForce(a, p0) / F).toBeLessThan(1.001);
    expect(integratedForce(a, p0)).toBeCloseTo((2 / 3) * p0 * Math.PI * a * a, 4); // = (2/3)p0·πa²
  });

  it('the force–approach law F = (4/3)E*√R·δ^(3/2) is self-consistent and nonlinear', () => {
    const delta = approach(F, R, Estar);
    expect(forceFromApproach(delta, R, Estar)).toBeCloseTo(F, 4);        // round-trip
    // doubling the approach raises the force by 2^(3/2) (stiffening contact).
    expect(forceFromApproach(2 * delta, R, Estar) / F).toBeCloseTo(Math.pow(2, 1.5), 6);
  });

  it('combines radii and moduli correctly (sphere–sphere and sphere–flat)', () => {
    expect(effectiveRadius(10, 20)).toBeCloseTo(1 / (1 / 10 + 1 / 20), 10);
    expect(effectiveRadius(10, Infinity)).toBeCloseTo(10, 10);          // sphere on a flat
    expect(effectiveModulus(210000, 0.3, 210000, 0.3))
      .toBeCloseTo(1 / (2 * (1 - 0.09) / 210000), 4);
  });

  it('a larger load grows the patch as F^(1/3) and the pressure as F^(1/3)', () => {
    const a1 = contactRadius(F, R, Estar), a2 = contactRadius(8 * F, R, Estar);
    expect(a2 / a1).toBeCloseTo(2, 6);                                   // 8^(1/3) = 2
    expect(maxPressure(8 * F, a2) / maxPressure(F, a1)).toBeCloseTo(2, 6); // p0 ∝ F/a² ∝ F^(1/3)
  });
});
