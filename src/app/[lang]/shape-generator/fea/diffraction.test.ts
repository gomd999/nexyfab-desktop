/**
 * diffraction — wave optics, verified: the grating equation d·sinθ=mλ; the larger
 * diffraction angle of higher orders; the resolving power m·N; and the two-slit fringe
 * spacing λL/d.
 */
import { describe, it, expect } from 'vitest';
import { gratingSpacing, gratingAngle, singleSlitMinimum, resolvingPower, fringeSpacing } from './diffraction';

describe('diffraction — wave optics (verified)', () => {
  const d = gratingSpacing(600000), lambda = 550e-9; // 600 lines/mm, green light

  it('obeys the grating equation d·sinθ = m·λ', () => {
    const theta = gratingAngle(1, lambda, d);
    expect(d * Math.sin(theta)).toBeCloseTo(1 * lambda, 15);
    expect(gratingSpacing(600000)).toBeCloseTo(1 / 600000, 15);
  });

  it('diffracts higher orders to larger angles', () => {
    expect(gratingAngle(2, lambda, d)).toBeGreaterThan(gratingAngle(1, lambda, d));
    // longer wavelength diffracts more at the same order
    expect(gratingAngle(1, 650e-9, d)).toBeGreaterThan(gratingAngle(1, lambda, d));
  });

  it('has resolving power R = m·N', () => {
    expect(resolvingPower(2, 500)).toBe(1000);
    expect(singleSlitMinimum(1, lambda, 1e-4)).toBeCloseTo(Math.asin(lambda / 1e-4), 12);
  });

  it('spaces two-slit fringes by Δy = λL/d', () => {
    expect(fringeSpacing(lambda, 2, 1e-4)).toBeCloseTo((lambda * 2) / 1e-4, 15); // 11 mm
    expect(fringeSpacing(lambda, 2, 2e-4)).toBeCloseTo(fringeSpacing(lambda, 2, 1e-4) / 2, 15); // ∝ 1/d
  });
});
