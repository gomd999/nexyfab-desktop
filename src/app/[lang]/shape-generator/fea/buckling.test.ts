/**
 * buckling — linear (eigenvalue) buckling on the HEX8 kernel, verified against
 * the analytic Euler column. Coarse low-order solid elements are systematically
 * ~14% stiff in buckling (membrane/shear locking with few elements through the
 * section), so the test brackets the analytic value rather than demanding equality
 * — but the physics (P_cr ∝ 1/L², ∝ E, no buckling in tension) is exact.
 */
import { describe, it, expect } from 'vitest';
import { TopologyGrid } from '../analysis/topology3D';
import { hex8LinearBuckling, fixedRootFace } from './buckling';

const E = 210000, nu = 0.3;

/** Euler critical stress of a fixed-free (cantilever) column, weak-axis bending. */
function eulerCantileverStress(nx: number, ny: number, nz: number, h: number): number {
  const Wy = ny * h, Wz = nz * h, L = nx * h;
  const Iz = (Wz * Wy ** 3) / 12, A = Wy * Wz;     // bend in y (Wy ≤ Wz)
  const Pcr = (Math.PI ** 2 * E * Iz) / (4 * L ** 2); // effective length 2L
  return Pcr / A;
}
function lam(nx: number, ny: number, nz: number, h: number, Eo = E, prestress = { xx: -1, yy: 0, zz: 0 }): number {
  const grid = new TopologyGrid(nx, ny, nz);
  return hex8LinearBuckling(grid, { E: Eo, nu, cell: h, fixed: fixedRootFace(grid, 'x'), prestress, iters: 200 }).criticalLoadFactor;
}

describe('buckling — Euler column (FEA, verified)', () => {
  it('critical stress brackets the analytic Euler value (coarse-mesh locking offset)', () => {
    for (const [nx, ny, nz, h] of [[20, 2, 2, 5], [24, 2, 2, 5], [16, 2, 3, 6]] as const) {
      const ratio = lam(nx, ny, nz, h) / eulerCantileverStress(nx, ny, nz, h);
      expect(ratio).toBeGreaterThan(1.0);          // solid elements are stiff, never under
      expect(ratio).toBeLessThan(1.25);            // but only modestly (~14%)
    }
  });

  it('the load factor is positive (a real buckling mode exists under compression)', () => {
    expect(lam(20, 2, 2, 5)).toBeGreaterThan(0);
  });

  it('obeys the Euler scaling laws: P_cr ∝ 1/L² and P_cr ∝ E', () => {
    const r = lam(12, 2, 2, 5) / lam(24, 2, 2, 5);
    expect(r).toBeGreaterThan(3.6);                // ×2 length → /4
    expect(r).toBeLessThan(4.4);
    const e = lam(16, 2, 2, 5, 4 * E) / lam(16, 2, 2, 5);
    expect(e).toBeGreaterThan(3.95);               // ×4 stiffness → ×4
    expect(e).toBeLessThan(4.05);
  });

  it('a column in TENSION does not buckle (non-positive load factor)', () => {
    // σxx = +1 (tension): the geometric stiffness stabilises, so there is no
    // positive compressive multiplier — the lowest factor is ≤ 0.
    expect(lam(20, 2, 2, 5, E, { xx: 1, yy: 0, zz: 0 })).toBeLessThanOrEqual(1e-6);
  });
});
