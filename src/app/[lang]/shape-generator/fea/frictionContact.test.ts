/**
 * frictionContact — Coulomb stick/slip friction, verified: a contact point sticks
 * (elastic traction k_t·u) while the demand is below μ·p_n and slips at the cap μ·p_n
 * above it; the macroscopic block friction is min(F, μN); an incline slips when
 * tan θ > μ (angle of repose = atan μ); the traction stays inside the friction cone;
 * and a sliding cycle dissipates positive energy.
 */
import { describe, it, expect } from 'vitest';
import { coulombReturn, frictionForce, inclineSlips, angleOfRepose, frictionWork } from './frictionContact';

const mu = 0.3, pn = 100, kt = 1e5, bound = mu * pn; // 30

describe('frictionContact — Coulomb stick/slip (verified)', () => {
  it('sticks (elastic traction) below the friction bound', () => {
    const s = coulombReturn(2e-4, pn, mu, kt);
    expect(s.slipping).toBe(false);
    expect(s.traction).toBeCloseTo(kt * 2e-4, 9); // = 20, elastic
    expect(Math.abs(s.traction)).toBeLessThan(bound);
    expect(s.slip).toBe(0);
  });

  it('slips at the cap μ·p_n above the bound, accumulating slip', () => {
    const s = coulombReturn(5e-4, pn, mu, kt);
    expect(s.slipping).toBe(true);
    expect(s.traction).toBeCloseTo(bound, 9);     // capped at 30
    expect(s.slip).toBeGreaterThan(0);
  });

  it('the macroscopic block friction is min(|F|, μN), opposing motion', () => {
    expect(frictionForce(20, pn, mu)).toBeCloseTo(20, 9);   // stick: equals applied
    expect(frictionForce(50, pn, mu)).toBeCloseTo(bound, 9); // slip: capped at μN
    expect(frictionForce(-50, pn, mu)).toBeCloseTo(-bound, 9); // opposes (sign)
  });

  it('an incline slips when tan θ > μ (angle of repose = atan μ)', () => {
    expect(angleOfRepose(mu)).toBeCloseTo(Math.atan(mu), 12);
    expect(inclineSlips(20 * Math.PI / 180, mu)).toBe(true);  // > 16.7°
    expect(inclineSlips(10 * Math.PI / 180, mu)).toBe(false); // < 16.7°
  });

  it('the traction never leaves the friction cone |t| ≤ μ·p_n', () => {
    let maxT = 0;
    for (let u = -1e-3; u <= 1e-3; u += 1e-5) maxT = Math.max(maxT, Math.abs(coulombReturn(u, pn, mu, kt).traction));
    expect(maxT).toBeLessThanOrEqual(bound + 1e-9);
  });

  it('friction hysteresis dissipates positive energy, growing with amplitude', () => {
    const cycle = (amp: number) => {
      const hist: number[] = [];
      for (let i = 0; i <= 40; i++) hist.push(amp * Math.sin((i / 40) * 2 * Math.PI));
      return frictionWork(hist, pn, mu, kt).dissipated;
    };
    expect(cycle(5e-4)).toBeGreaterThan(0);            // genuine sliding ⇒ dissipation
    expect(cycle(1e-3)).toBeGreaterThan(cycle(5e-4));  // larger sliding ⇒ more dissipation
    // below the stick threshold (|u|·k_t < μN ⇒ amp < bound/k_t) it never slips.
    expect(cycle(bound / kt * 0.9)).toBeCloseTo(0, 9);
  });
});
