/**
 * feaAnalyticBenchmark — Track M (FEA) acceptance: the fixed 3D linear-tet solver
 * verified against a closed-form solution.
 *
 * An axial bar (length L, square section A, fixed at one end, total axial force F
 * at the other) has the exact tip displacement δ = F·L / (A·E). For a linear
 * solver this is a clean correctness benchmark: the result must CONVERGE, match δ
 * to engineering accuracy, and obey the exact scaling laws δ ∝ F, δ ∝ L, δ ∝ 1/A.
 *
 * Before the solver fix this diverged to ~1e16 mm garbage (non-conforming mesh +
 * 1e30 penalty BC). After it (conforming structured-grid tets, robust
 * Möller–Trumbore inside test, full-face BC, Dirichlet elimination) it converges
 * and lands within ~10% — the linear-tet discretization is slightly soft; sub-%
 * accuracy would need TET10 / finer meshes (a documented follow-up). 10% is solid
 * engineering accuracy and a night-and-day improvement over divergence.
 *
 * faceIndices are computed on the NON-INDEXED geometry, matching how runFEM reads
 * them (it calls toNonIndexed internally).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { runSimpleFEA, type FEAMaterial } from './simpleFEA';

const steel: FEAMaterial = { youngsModulus: 200, poissonRatio: 0.0, yieldStrength: 250, density: 7.85 };
const E_MPA = steel.youngsModulus * 1000;

function bar(L: number, a: number): THREE.BufferGeometry {
  // segments give the fixed/load faces several triangles → a well-defined plane.
  return new THREE.BoxGeometry(L, a, a, 10, 2, 2).toNonIndexed();
}
function facesByX(g: THREE.BufferGeometry, wantMin: boolean): number[] {
  const pos = g.attributes.position;
  const tris = pos.count / 3;
  const out: number[] = [];
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < pos.count; i++) { mn = Math.min(mn, pos.getX(i)); mx = Math.max(mx, pos.getX(i)); }
  for (let f = 0; f < tris; f++) {
    const b = f * 3;
    const cx = (pos.getX(b) + pos.getX(b + 1) + pos.getX(b + 2)) / 3;
    if (wantMin && Math.abs(cx - mn) < 1e-3) out.push(f);
    if (!wantMin && Math.abs(cx - mx) < 1e-3) out.push(f);
  }
  return out;
}
function axialDisp(L: number, a: number, F: number): { fem: number; method: string } {
  const g = bar(L, a);
  const res = runSimpleFEA(g, {
    material: steel,
    conditions: [
      { type: 'fixed', faceIndices: facesByX(g, true) },
      { type: 'force', faceIndices: facesByX(g, false), value: [F, 0, 0] },
    ],
  });
  return { fem: res.maxDisplacement, method: res.method };
}

describe('FEA analytic benchmark — axial bar (Track M, M1)', () => {
  it('converges via the linear-tet solver (not the beam fallback) and matches FL/AE within ~12%', () => {
    const L = 100, a = 20, F = 80000;
    const analytic = (F * L) / (a * a * E_MPA); // 0.1 mm
    const { fem, method } = axialDisp(L, a, F);
    expect(method).toBe('linear-fem-tet');           // it actually ran the 3D FEM
    expect(fem / analytic).toBeGreaterThan(0.88);
    expect(fem / analytic).toBeLessThan(1.12);
  });

  it('obeys δ ∝ F (linearity) to <1%', () => {
    const base = axialDisp(100, 20, 80000).fem;
    const dbl = axialDisp(100, 20, 160000).fem;
    expect(dbl / base).toBeGreaterThan(1.98);
    expect(dbl / base).toBeLessThan(2.02);
  });

  it('obeys δ ∝ L (axial) within ~10%', () => {
    // The L=100 and L=200 bars are meshed at different relative resolutions, so a
    // little discretization spread around the ideal 2.0 is expected.
    const short = axialDisp(100, 20, 80000).fem;
    const long = axialDisp(200, 20, 80000).fem;
    expect(long / short).toBeGreaterThan(1.82);
    expect(long / short).toBeLessThan(2.18);
  });

  it('obeys δ ∝ 1/A (a thicker section is stiffer)', () => {
    const thin = axialDisp(100, 20, 80000).fem;  // A = 400
    const thick = axialDisp(100, 40, 80000).fem; // A = 1600 → δ ≈ ¼
    expect(thick).toBeLessThan(thin);
    expect(thick / thin).toBeGreaterThan(0.2);
    expect(thick / thin).toBeLessThan(0.32);
  });
});
