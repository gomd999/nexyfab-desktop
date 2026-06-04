/**
 * modalFEM — natural-frequency analysis on the real HEX8 FEM kernel, verified
 * against the analytic cantilever beam. (The crude voxel approximation was
 * replaced by assembling the verified element stiffness + lumped mass and solving
 * K φ = ω² M φ with the now-CG-backed inverse power iteration.)
 */
import { describe, it, expect } from 'vitest';
import { TopologyGrid } from '../analysis/topology3D';
import { hex8Modes, fixedFaceNodes } from './modalFEM';

const E = 210000, nu = 0.3, rho = 7.85e-9; // steel, N-mm-tonne-MPa units

/** Euler–Bernoulli cantilever first bending frequency (Hz). */
function analyticFirst(L: number, width: number, thick: number): number {
  const I = (width * thick ** 3) / 12, A = width * thick;
  return (1.875 ** 2 / (2 * Math.PI)) * Math.sqrt((E * I) / (rho * A * L ** 4));
}
function modes(nx: number, ny: number, nz: number, h: number, n = 4): number[] {
  const grid = new TopologyGrid(nx, ny, nz);
  return hex8Modes(grid, { E, nu, rho, cell: h, fixed: fixedFaceNodes(grid, 'x'), nModes: n }).frequenciesHz;
}

describe('modalFEM — cantilever natural frequency (FEA, verified)', () => {
  it('first frequency matches the analytic cantilever within ~10%', () => {
    const f = modes(20, 3, 3, 8, 1)[0];          // finer through-thickness → least locking
    const analytic = analyticFirst(20 * 8, 3 * 8, 3 * 8);
    expect(f).toBeGreaterThan(0);
    expect(f / analytic).toBeGreaterThan(0.9);
    expect(f / analytic).toBeLessThan(1.1);
  });

  it('resolves the degenerate first-bending PAIR of a square section (M-orthogonal)', () => {
    const f = modes(16, 2, 2, 10, 3);
    // a square cantilever bends equally in Y and Z → two near-equal lowest modes.
    expect(f[0]).toBeGreaterThan(0);
    expect(f[1] / f[0]).toBeGreaterThan(0.95);
    expect(f[1] / f[0]).toBeLessThan(1.05);
    // the next mode is clearly higher (2nd bending), not a spurious ~0.
    expect(f[2]).toBeGreaterThan(f[1] * 2);
  });

  it('obeys the beam scaling laws: f ∝ 1/L² and f ∝ √E', () => {
    const fL12 = modes(12, 2, 2, 10, 1)[0];
    const fL24 = modes(24, 2, 2, 10, 1)[0];
    expect(fL12 / fL24).toBeGreaterThan(3.6);    // ideal 4 (×2 length → /4)
    expect(fL12 / fL24).toBeLessThan(4.4);

    const grid = new TopologyGrid(12, 2, 2);
    const fixed = fixedFaceNodes(grid, 'x');
    const fE = hex8Modes(grid, { E, nu, rho, cell: 10, fixed, nModes: 1 }).frequenciesHz[0];
    const f4E = hex8Modes(grid, { E: 4 * E, nu, rho, cell: 10, fixed, nModes: 1 }).frequenciesHz[0];
    expect(f4E / fE).toBeGreaterThan(1.95);      // ideal 2 (×4 stiffness → ×√4)
    expect(f4E / fE).toBeLessThan(2.05);
  });
});
