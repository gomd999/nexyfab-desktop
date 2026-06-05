/**
 * rocketEquation — ideal rocket propulsion, verified: the Tsiolkovsky Δv = v_e·ln(MR)
 * (an e-fold mass ratio yields Δv = v_e); the v_e = I_sp·g₀ identity; the thrust ṁ·v_e;
 * and the propellant mass fraction.
 */
import { describe, it, expect } from 'vitest';
import { exhaustVelocity, deltaV, thrust, massRatio, propellantFraction } from './rocketEquation';

describe('rocketEquation — ideal propulsion (verified)', () => {
  const Isp = 300, ve = exhaustVelocity(Isp);

  it('relates exhaust velocity to specific impulse v_e = I_sp·g₀', () => {
    expect(ve).toBeCloseTo(300 * 9.80665, 6); // 2942 m/s
  });

  it('gives Δv = v_e·ln(MR), with Δv = v_e at an e-fold mass ratio', () => {
    expect(deltaV(ve, Math.E, 1)).toBeCloseTo(ve, 6);        // ln(e) = 1
    expect(deltaV(ve, 10, 2)).toBeCloseTo(ve * Math.log(5), 6);
    expect(massRatio(10, 2)).toBe(5);
  });

  it('computes ideal thrust ṁ·v_e', () => {
    expect(thrust(200, ve)).toBeCloseTo(200 * ve, 3);        // ~588 kN
    expect(thrust(400, ve) / thrust(200, ve)).toBeCloseTo(2, 9);
  });

  it('gives the propellant mass fraction ζ = 1 − m_f/m₀', () => {
    expect(propellantFraction(10, 2)).toBeCloseTo(0.8, 9);
    expect(propellantFraction(10, 10)).toBeCloseTo(0, 9);    // no propellant burned
  });
});
