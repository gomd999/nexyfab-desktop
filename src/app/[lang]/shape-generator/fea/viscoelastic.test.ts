/**
 * viscoelastic — Maxwell and Kelvin–Voigt linear viscoelasticity, verified: the Maxwell
 * stress relaxation to σ₀/e at t=τ (and to 0 at long time); the Maxwell instant-elastic-
 * then-linear creep; the Kelvin–Voigt delayed creep from 0 to σ/E; and τ=η/E.
 */
import { describe, it, expect } from 'vitest';
import { relaxationTime, maxwellRelaxation, maxwellCreep, kelvinVoigtCreep, relaxationModulus } from './viscoelastic';

describe('viscoelastic — Maxwell & Kelvin–Voigt (verified)', () => {
  const E = 1e9, eta = 1e10, tau = relaxationTime(eta, E), s0 = 1e6;

  it('relaxes Maxwell stress to σ₀/e at one time constant', () => {
    expect(tau).toBeCloseTo(10, 9);                          // η/E
    expect(maxwellRelaxation(s0, 0, tau)).toBeCloseTo(s0, 6);
    expect(maxwellRelaxation(s0, tau, tau)).toBeCloseTo(s0 / Math.E, 6);
    expect(maxwellRelaxation(s0, 100 * tau, tau)).toBeLessThan(s0 * 1e-6); // fully relaxes
    expect(relaxationModulus(E, tau, tau)).toBeCloseTo(E / Math.E, 6);
  });

  it('creeps Maxwell from instant-elastic σ/E and grows without bound', () => {
    expect(maxwellCreep(s0, E, eta, 0)).toBeCloseTo(s0 / E, 12);          // instant elastic
    expect(maxwellCreep(s0, E, eta, 100)).toBeGreaterThan(maxwellCreep(s0, E, eta, 0));
    // linear viscous term: doubling time past the elastic part doubles the flow strain
    const flow = (t: number) => maxwellCreep(s0, E, eta, t) - s0 / E;
    expect(flow(200)).toBeCloseTo(2 * flow(100), 9);
  });

  it('creeps Kelvin–Voigt from 0 up to the σ/E asymptote', () => {
    expect(kelvinVoigtCreep(s0, E, tau, 0)).toBeCloseTo(0, 12);           // dashpot blocks instant strain
    expect(kelvinVoigtCreep(s0, E, tau, tau)).toBeCloseTo((s0 / E) * (1 - 1 / Math.E), 12); // 63.2%
    expect(kelvinVoigtCreep(s0, E, tau, 100 * tau)).toBeCloseTo(s0 / E, 6); // bounded asymptote
  });
});
