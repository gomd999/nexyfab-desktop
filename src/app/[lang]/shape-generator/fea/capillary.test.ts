/**
 * capillary — surface-tension capillarity, verified: the h ∝ 1/r capillary rise; the
 * maximum rise at θ=0 (perfect wetting); the depression of a non-wetting liquid (θ>90°,
 * mercury); and the sphere = 2× cylinder Young–Laplace pressure.
 */
import { describe, it, expect } from 'vitest';
import { capillaryRise, youngLaplaceSphere, youngLaplaceCylinder, isWetting } from './capillary';

describe('capillary — surface tension (verified)', () => {
  const g = 9.80665, gamma = 0.0728, rho = 1000, r = 5e-4; // water in a 0.5 mm tube

  it('rises inversely with the tube radius (Jurin)', () => {
    const h = capillaryRise(gamma, 0, rho, r, g);
    expect(h).toBeCloseTo((2 * gamma) / (rho * g * r), 9);   // ~29.7 mm
    expect(capillaryRise(gamma, 0, rho, r / 2, g) / h).toBeCloseTo(2, 9); // h ∝ 1/r
  });

  it('rises most at perfect wetting and decreases with contact angle', () => {
    const h0 = capillaryRise(gamma, 0, rho, r, g);
    expect(capillaryRise(gamma, Math.PI / 3, rho, r, g)).toBeLessThan(h0); // cosθ < 1
    expect(isWetting(0)).toBe(true);
  });

  it('depresses a non-wetting liquid (mercury, θ>90°)', () => {
    const thetaHg = (140 * Math.PI) / 180;
    expect(capillaryRise(0.485, thetaHg, 13546, r, g)).toBeLessThan(0); // below the free surface
    expect(isWetting(thetaHg)).toBe(false);
  });

  it('has a spherical Young–Laplace pressure twice the cylindrical', () => {
    expect(youngLaplaceSphere(gamma, r)).toBeCloseTo(2 * youngLaplaceCylinder(gamma, r), 9);
    expect(youngLaplaceSphere(gamma, r / 2)).toBeCloseTo(2 * youngLaplaceSphere(gamma, r), 9); // ∝ 1/r
  });
});
