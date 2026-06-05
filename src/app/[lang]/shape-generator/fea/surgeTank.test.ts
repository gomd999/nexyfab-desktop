/**
 * surgeTank — surge-tank mass oscillation, verified: the period T_s = 2π/ω; the maximum
 * surge amplitude derived two independent ways (energy balance ½ρLA_p·V₀² = ½ρg·A_t·Z²
 * and the SHM kinematic (A_p/A_t)·V₀/ω); and the bigger-tank trends (longer period, lower
 * surge).
 */
import { describe, it, expect } from 'vitest';
import { surgePeriod, surgeAngularFrequency, maxSurgeAmplitude } from './surgeTank';

describe('surgeTank — mass oscillation (verified)', () => {
  const L = 1000, At = 20, Ap = 5, g = 9.80665, V0 = 2, rho = 1000;

  it('has period T_s = 2π/ω', () => {
    expect(surgePeriod(L, At, Ap, g)).toBeCloseTo((2 * Math.PI) / surgeAngularFrequency(L, At, Ap, g), 9);
  });

  it('gives the max surge from energy balance and SHM kinematics consistently', () => {
    const Zmax = maxSurgeAmplitude(V0, L, Ap, At, g);
    const KE = 0.5 * rho * L * Ap * V0 * V0;
    const PE = 0.5 * rho * g * At * Zmax * Zmax;
    expect(KE).toBeCloseTo(PE, 3);                                  // tunnel KE ⇒ raised-water PE
    const omega = surgeAngularFrequency(L, At, Ap, g);
    expect(Zmax).toBeCloseTo((Ap / At) * V0 / omega, 9);           // SHM amplitude
  });

  it('responds slower and milder with a bigger surge tank', () => {
    expect(surgePeriod(L, 40, Ap, g)).toBeGreaterThan(surgePeriod(L, At, Ap, g));      // longer period
    expect(maxSurgeAmplitude(V0, L, Ap, 40, g)).toBeLessThan(maxSurgeAmplitude(V0, L, Ap, At, g)); // lower surge
    // period ∝ √A_t
    expect(surgePeriod(L, 4 * At, Ap, g) / surgePeriod(L, At, Ap, g)).toBeCloseTo(2, 9);
  });
});
