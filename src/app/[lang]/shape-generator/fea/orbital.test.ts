/**
 * orbital — two-body Keplerian mechanics, verified: the circular speed √(μ/r) and LEO
 * period; the escape/circular ratio √2; vis-viva reducing to the circular speed at
 * a=r; Kepler's 3rd law T²∝a³; angular-momentum conservation r_p·v_p=r_a·v_a=h; and
 * the specific energy −μ/(2a).
 */
import { describe, it, expect } from 'vitest';
import {
  circularVelocity, escapeVelocity, visViva, orbitalPeriod, specificEnergy,
  periapsis, apoapsis, angularMomentum, apsisSpeeds,
} from './orbital';

const mu = 3.986e14; // Earth GM (m³/s²)

describe('orbital — Keplerian mechanics (verified)', () => {
  it('circular orbit speed √(μ/r) and a ~92 min LEO period', () => {
    const r = 6.778e6; // ~400 km altitude
    expect(circularVelocity(mu, r)).toBeCloseTo(Math.sqrt(mu / r), 6);
    expect(orbitalPeriod(mu, r) / 60).toBeGreaterThan(90);
    expect(orbitalPeriod(mu, r) / 60).toBeLessThan(95);
    // vis-viva at a=r returns the circular speed.
    expect(visViva(mu, r, r)).toBeCloseTo(circularVelocity(mu, r), 6);
  });

  it('escape speed is √2 times the circular speed', () => {
    const r = 7e6;
    expect(escapeVelocity(mu, r) / circularVelocity(mu, r)).toBeCloseTo(Math.SQRT2, 9);
    expect(escapeVelocity(mu, r)).toBeCloseTo(Math.sqrt((2 * mu) / r), 6);
  });

  it("Kepler's third law: T² ∝ a³", () => {
    const a1 = 7e6, a2 = 1.4e7; // a2 = 2·a1
    expect((orbitalPeriod(mu, a2) / orbitalPeriod(mu, a1)) ** 2).toBeCloseTo((a2 / a1) ** 3, 6); // = 8
  });

  it('angular momentum is conserved: r_p·v_p = r_a·v_a = h', () => {
    const a = 1e7, e = 0.3;
    const s = apsisSpeeds(mu, a, e);
    const h = angularMomentum(mu, a, e);
    expect(periapsis(a, e) * s.vPeri).toBeCloseTo(h, 0);
    expect(apoapsis(a, e) * s.vApo).toBeCloseTo(h, 0);
    expect(s.vPeri).toBeGreaterThan(s.vApo);            // faster at periapsis
  });

  it('the specific orbital energy is ε = −μ/(2a)', () => {
    const a = 1e7;
    expect(specificEnergy(mu, a)).toBeCloseTo(-mu / (2 * a), 6);
    // a larger orbit is less bound (energy closer to 0).
    expect(specificEnergy(mu, 2e7)).toBeGreaterThan(specificEnergy(mu, 1e7));
  });
});
