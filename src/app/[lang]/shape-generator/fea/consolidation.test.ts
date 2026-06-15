/**
 * consolidation — Terzaghi 1-D poroelastic consolidation, verified: the analytic
 * series gives the textbook degree of consolidation (U=50% at T_v≈0.197, U=90% at
 * T_v≈0.848); the numerically diffused pore pressure reproduces U(T_v); and the
 * effective stress rises from 0 (load fully in the water) to the full surcharge as
 * consolidation completes.
 */
import { describe, it, expect } from 'vitest';
import { consolidationDegree, effectiveStress, consolidate } from './consolidation';

describe('consolidation — Terzaghi 1-D (verified)', () => {
  it('matches the textbook degree-of-consolidation values', () => {
    expect(consolidationDegree(0.197)).toBeCloseTo(0.5, 2);   // U = 50%
    expect(consolidationDegree(0.848)).toBeCloseTo(0.9, 2);   // U = 90%
    expect(consolidationDegree(0)).toBe(0);
    expect(consolidationDegree(3)).toBeGreaterThan(0.99);     // ≈ fully consolidated
  });

  it('U is monotone increasing from 0 toward 1', () => {
    let prev = 0;
    for (const Tv of [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2]) {
      const U = consolidationDegree(Tv);
      expect(U).toBeGreaterThan(prev);
      expect(U).toBeLessThanOrEqual(1);
      prev = U;
    }
  });

  it('obeys the Terzaghi effective-stress principle σ′ = σ − u', () => {
    const sigma = 100;
    expect(effectiveStress(sigma, sigma)).toBe(0);   // t=0: load carried by water
    expect(effectiveStress(sigma, 0)).toBe(sigma);   // t=∞: load carried by skeleton
    expect(effectiveStress(sigma, 40)).toBe(60);     // partway
  });

  it('the numerical pore-pressure diffusion reproduces the analytic U(T_v)', () => {
    const r = consolidate(1, 1, 100, 41, 0.002, 500);
    for (const tvTarget of [0.1, 0.2, 0.5, 0.848]) {
      let i = 0;
      for (let k = 0; k < r.Tv.length; k++) if (Math.abs(r.Tv[k] - tvTarget) < Math.abs(r.Tv[i] - tvTarget)) i = k;
      expect(Math.abs(r.U[i] - consolidationDegree(r.Tv[i]))).toBeLessThan(0.01);
    }
  });

  it('drains from the surface: pore pressure is zero at the drained face, retained at the base', () => {
    const r = consolidate(1, 1, 100, 41, 0.002, 50); // early time
    const prof = r.pressureProfile[r.pressureProfile.length - 1];
    expect(prof[0]).toBeCloseTo(0, 6);               // drained surface
    expect(prof[prof.length - 1]).toBeGreaterThan(prof[0]); // base still pressurised
    expect(prof[prof.length - 1]).toBeLessThanOrEqual(100); // ≤ initial
  });
});
