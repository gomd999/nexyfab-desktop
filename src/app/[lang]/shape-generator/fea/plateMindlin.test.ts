/**
 * plateMindlin — 4-node Mindlin plate with selective reduced integration, verified
 * against the Timoshenko series solutions (simply-supported & clamped square plates,
 * uniform and point loads) and — critically — the thin-plate limit, where selective
 * reduced integration keeps the deflection finite (no shear locking).
 */
import { describe, it, expect } from 'vitest';
import { mindlinPlateSolve } from './plateMindlin';

const E = 210000, nu = 0.3, A = 1000;
const D = (t: number) => (E * t ** 3) / (12 * (1 - nu * nu));

describe('plateMindlin — plate bending (verified vs Timoshenko)', () => {
  it('simply-supported square under uniform load → 0.00406 q A⁴/D, convergent', () => {
    const t = 10, q = 0.01, analytic = (0.00406 * q * A ** 4) / D(t);
    const coarse = mindlinPlateSolve({ nx: 8, ny: 8, lx: A / 8, ly: A / 8, E, nu, thickness: t, pressure: q });
    const fine = mindlinPlateSolve({ nx: 16, ny: 16, lx: A / 16, ly: A / 16, E, nu, thickness: t, pressure: q });
    expect(Math.abs(fine.maxDeflection) / analytic).toBeGreaterThan(0.98);
    expect(Math.abs(fine.maxDeflection) / analytic).toBeLessThan(1.03);
    // refinement converges toward the analytic value.
    const eCoarse = Math.abs(Math.abs(coarse.maxDeflection) - analytic);
    const eFine = Math.abs(Math.abs(fine.maxDeflection) - analytic);
    expect(eFine).toBeLessThan(eCoarse);
  });

  it('simply-supported square under a central point load → 0.0116 P A²/D', () => {
    const t = 10, P = 1000, analytic = (0.0116 * P * A ** 2) / D(t);
    const r = mindlinPlateSolve({ nx: 16, ny: 16, lx: A / 16, ly: A / 16, E, nu, thickness: t, pointLoad: { value: P, x: A / 2, y: A / 2 } });
    expect(Math.abs(r.maxDeflection) / analytic).toBeGreaterThan(0.97);
    expect(Math.abs(r.maxDeflection) / analytic).toBeLessThan(1.03);
  });

  it('clamped square under uniform load → 0.00126 q A⁴/D', () => {
    const t = 10, q = 0.01, analytic = (0.00126 * q * A ** 4) / D(t);
    const r = mindlinPlateSolve({ nx: 16, ny: 16, lx: A / 16, ly: A / 16, E, nu, thickness: t, pressure: q, clamped: true });
    expect(Math.abs(r.maxDeflection) / analytic).toBeGreaterThan(0.97);
    expect(Math.abs(r.maxDeflection) / analytic).toBeLessThan(1.03);
  });

  it('does NOT shear-lock in the thin limit (selective reduced integration)', () => {
    const q = 0.01;
    // the normalised deflection w·D/(q·A⁴) must stay ≈ 0.00406 as t/A → 0,
    // not collapse to zero as a fully-integrated element would.
    for (const t of [20, 4, 2]) {
      const r = mindlinPlateSolve({ nx: 12, ny: 12, lx: A / 12, ly: A / 12, E, nu, thickness: t, pressure: q });
      const norm = (Math.abs(r.maxDeflection) * D(t)) / (q * A ** 4);
      expect(norm).toBeGreaterThan(0.0039);    // within ~3.5% of 0.00406 — no locking
      expect(norm).toBeLessThan(0.0043);
    }
  });
});
