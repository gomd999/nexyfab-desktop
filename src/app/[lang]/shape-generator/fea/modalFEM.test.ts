/**
 * modalFEM — natural-frequency analysis on the real HEX8 FEM kernel, verified
 * against the analytic cantilever beam. (The crude voxel approximation was
 * replaced by assembling the verified element stiffness + lumped mass and solving
 * K φ = ω² M φ with the now-CG-backed inverse power iteration.)
 */
import { describe, it, expect } from 'vitest';
import { TopologyGrid } from '../analysis/topology3D';
import { hex8Modes, hex8Participation, hex8HarmonicResponse, fixedFaceNodes } from './modalFEM';

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

describe('modalFEM — modal mass participation (resonance assessment)', () => {
  // A cantilever thin in Y (ny < nz) → the lowest mode is bending in Y.
  const grid = new TopologyGrid(16, 2, 4);
  const part = hex8Participation(grid, { E: 210000, nu: 0.3, rho: 7.85e-9, cell: 10, fixed: fixedFaceNodes(grid, 'x'), nModes: 8 });

  it("the first bending mode captures ~the analytic 61% of the section's mass, in its bending direction only", () => {
    const m1 = part.perMode[0];
    const fy = m1.effectiveMass.y / part.totalMass.y;
    expect(fy).toBeGreaterThan(0.55);            // Euler–Bernoulli first mode ≈ 0.613
    expect(fy).toBeLessThan(0.70);
    // it's a pure-Y bending mode: negligible participation in x and z.
    expect(m1.effectiveMass.x / part.totalMass.x).toBeLessThan(0.02);
    expect(m1.effectiveMass.z / part.totalMass.z).toBeLessThan(0.02);
  });

  it('finds an axial mode dominating the X direction', () => {
    const axial = part.perMode.find((m) => m.effectiveMass.x / part.totalMass.x > 0.5);
    expect(axial, 'an axial mode should appear with > 50% X effective mass').toBeTruthy();
  });

  it('cumulative effective mass rises monotonically toward 100% and is bounded by 1', () => {
    let prev = 0;
    for (const c of part.cumulativeFraction) {
      expect(c.y).toBeGreaterThanOrEqual(prev - 1e-9); // monotonic
      expect(c.y).toBeLessThan(1.02);                  // can't exceed total mass
      prev = c.y;
    }
    // with 8 modes a slender cantilever reaches the response-spectrum 90% target in Y.
    expect(part.cumulativeFraction[part.cumulativeFraction.length - 1].y).toBeGreaterThan(0.85);
  });
});

describe('modalFEM — harmonic (frequency) response by modal superposition', () => {
  const nx = 16, ny = 2, nz = 4, h = 10;
  const grid = new TopologyGrid(nx, ny, nz);
  const fixed = fixedFaceNodes(grid, 'x');
  const mat = { E: 210000, nu: 0.3, rho: 7.85e-9, cell: h, fixed };
  const f1 = hex8Modes(grid, { ...mat, nModes: 1 }).frequenciesHz[0];
  const tip = grid.node(nx, 1, 2);
  const freqsHz: number[] = [];
  for (let f = 10; f <= 2000; f += 10) freqsHz.push(f);
  const zeta = 0.02;
  const resp = hex8HarmonicResponse(grid, {
    ...mat, nModes: 8, loadNode: tip, loadAxis: 1, loadMag: 1000, probeNode: tip, probeAxis: 1, freqsHz, zeta,
  });
  const peak = resp.amplitude.reduce((acc, a, i) => (a > acc.a ? { a, f: resp.freqHz[i] } : acc), { a: 0, f: 0 });

  it('resonates at the first natural frequency (peak amplitude near f1)', () => {
    expect(peak.f).toBeGreaterThan(f1 * 0.9);
    expect(peak.f).toBeLessThan(f1 * 1.1);
  });

  it('the ω→0 response equals the static deflection', () => {
    expect(resp.amplitude[0]).toBeGreaterThan(0);
    expect(Math.abs(resp.amplitude[0] - resp.staticAmplitude) / resp.staticAmplitude).toBeLessThan(0.02);
  });

  it('amplifies at resonance by ~the quality factor Q = 1/(2ζ)', () => {
    const Q = 1 / (2 * zeta); // = 25
    const amp = peak.a / resp.staticAmplitude;
    expect(amp).toBeGreaterThan(0.5 * Q);   // dominant-mode amplification
    expect(amp).toBeLessThan(1.3 * Q);
  });
});
