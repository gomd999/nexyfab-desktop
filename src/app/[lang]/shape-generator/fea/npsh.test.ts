/**
 * npsh — pump suction performance, verified: the NPSHa head balance; the cavitation
 * criterion NPSHa<NPSHr; the suction-lift sensitivity (more lift ⇒ less margin); and
 * hotter liquid (higher vapour pressure) reducing NPSHa toward cavitation.
 */
import { describe, it, expect } from 'vitest';
import { vaporPressureHead, npshAvailable, cavitates, thomaNumber } from './npsh';

describe('npsh — suction / cavitation (verified)', () => {
  const Patm = 101325, Pvap = 2339, rho = 1000, g = 9.80665; // cold water (20°C)

  it('balances the available NPSH head', () => {
    const Na = npshAvailable(Patm, Pvap, rho, g, 2, 0.5);
    expect(Na).toBeCloseTo((Patm - Pvap) / (rho * g) - 2 - 0.5, 9); // ~7.59 m
    expect(vaporPressureHead(Pvap, rho, g)).toBeCloseTo(Pvap / (rho * g), 12);
  });

  it('cavitates when the available head drops below the required', () => {
    const Na = npshAvailable(Patm, Pvap, rho, g, 2, 0.5); // 7.59 m
    expect(cavitates(Na, 4)).toBe(false);   // comfortable margin
    expect(cavitates(Na, 10)).toBe(true);   // pump needs more than available ⇒ cavitation
  });

  it('loses margin with more suction lift', () => {
    expect(npshAvailable(Patm, Pvap, rho, g, 5, 0.5)).toBeLessThan(npshAvailable(Patm, Pvap, rho, g, 2, 0.5));
  });

  it('is reduced by a hotter (higher-vapour-pressure) liquid', () => {
    const cold = npshAvailable(Patm, 2339, rho, g, 2, 0.5);   // 20°C
    const hot = npshAvailable(Patm, 12349, rho, g, 2, 0.5);   // 50°C
    expect(hot).toBeLessThan(cold);                            // closer to cavitation
    expect(thomaNumber(cold, 30)).toBeCloseTo(cold / 30, 9);
  });
});
