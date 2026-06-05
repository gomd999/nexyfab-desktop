/**
 * planetaryGear — epicyclic gear-train kinematics by Willis' equation, verified: the
 * coaxial tooth-count geometry N_ring=N_sun+2N_planet; the fixed-ring reduction
 * ω_sun/ω_carrier=1+N_ring/N_sun derived two independent ways; the all-locked rigid-body
 * case; and the Willis sun↔ring round trip.
 */
import { describe, it, expect } from 'vitest';
import { ringTeeth, carrierSpeed, carrierRatioFixedRing, ringSpeed } from './planetaryGear';

describe('planetaryGear — epicyclic kinematics (verified)', () => {
  const Ns = 20, Np = 30, Nr = ringTeeth(Ns, Np); // 80

  it('satisfies the coaxial tooth-count geometry', () => {
    expect(Nr).toBe(80);
    expect(ringTeeth(24, 18)).toBe(60);
  });

  it('gives the fixed-ring reduction two consistent ways', () => {
    const wc = carrierSpeed(Ns, Nr, 100, 0);             // ring held, sun at 100
    expect(wc).toBeCloseTo(20, 9);
    expect(100 / wc).toBeCloseTo(carrierRatioFixedRing(Ns, Nr), 9); // 5.0
    expect(carrierRatioFixedRing(Ns, Nr)).toBeGreaterThan(1);        // speed reduction
  });

  it('rotates rigidly when sun and ring lock together', () => {
    expect(carrierSpeed(Ns, Nr, 50, 50)).toBeCloseTo(50, 9); // whole unit spins as one
  });

  it('round-trips the Willis relation between ring and carrier', () => {
    const wc = carrierSpeed(Ns, Nr, 100, 0);
    expect(ringSpeed(Ns, Nr, 100, wc)).toBeCloseTo(0, 9);    // recovers the held ring
    // a freely-driven ring: carrier then ring should invert
    const wc2 = carrierSpeed(Ns, Nr, 100, 30);
    expect(ringSpeed(Ns, Nr, 100, wc2)).toBeCloseTo(30, 9);
  });
});
