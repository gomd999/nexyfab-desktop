/**
 * feaConvergenceGuard — Track M (FEA, the weakest link) hardening.
 *
 * FINDING (2026-06-04): the 3D linear-tet FEM (femSolver.runFEM) does NOT
 * reliably converge on a simple axial bar — a coarse box mesh leaves
 * under-constrained / sliver-tet nodes, so the CG solve hits its iteration cap
 * and returns an astronomically large spurious maxDisplacement (~1e12–1e16 mm).
 * Even when it does converge it can be ~10–80× off the analytic δ = FL/AE. The
 * 3D solver is therefore not yet trustworthy (roadmap M1 remains open).
 *
 * The robustness bug this pins: runSimpleFEA used to surface that garbage as a
 * real result (it ignored `converged`). The guard now treats a non-converged /
 * non-finite / kilometre-scale result as unusable and falls back to beam theory,
 * so the UI never shows fabricated stress. block-rather-than-silently-wrong.
 *
 * The analytic-accuracy benchmark (δ within a few % of FL/AE) is the M1 acceptance
 * gate and is intentionally `.skip`-documented below until the solver is fixed.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { runSimpleFEA, type FEAMaterial } from './simpleFEA';

const steel: FEAMaterial = { youngsModulus: 200, poissonRatio: 0.0, yieldStrength: 250, density: 7.85 };

function facesByX(g: THREE.BufferGeometry, wantMin: boolean): number[] {
  const pos = g.attributes.position;
  const tris = pos.count / 3;
  const out: number[] = [];
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < pos.count; i++) { minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i)); }
  for (let f = 0; f < tris; f++) {
    const b = f * 3;
    const cx = (pos.getX(b) + pos.getX(b + 1) + pos.getX(b + 2)) / 3;
    if (wantMin && Math.abs(cx - minX) < 1e-3) out.push(f);
    if (!wantMin && Math.abs(cx - maxX) < 1e-3) out.push(f);
  }
  return out;
}

describe('FEA convergence guard (Track M weakest-link hardening)', () => {
  it('never surfaces a non-converged / garbage FEM result as real', () => {
    // A coarse axial-bar setup that makes the tet FEM diverge (verified: conv=false,
    // maxDisp ~1e12). The guard must catch it and return a finite, plausible result.
    const g = new THREE.BoxGeometry(100, 20, 20);
    const res = runSimpleFEA(g, {
      material: steel,
      conditions: [
        { type: 'fixed', faceIndices: facesByX(g, true) },
        { type: 'force', faceIndices: facesByX(g, false), value: [80000, 0, 0] },
      ],
    });

    // Whatever method ends up being used, the reported numbers must be sane —
    // never the astronomical spurious displacement the raw solver produced.
    expect(Number.isFinite(res.maxDisplacement)).toBe(true);
    expect(Number.isFinite(res.maxStress)).toBe(true);
    expect(res.maxDisplacement).toBeLessThan(1e6); // mm — not a kilometre
    expect(res.maxDisplacement).toBeGreaterThanOrEqual(0);
  });

  it('a clean small load still returns a finite, non-negative result', () => {
    const g = new THREE.BoxGeometry(40, 40, 40);
    const res = runSimpleFEA(g, {
      material: steel,
      conditions: [
        { type: 'fixed', faceIndices: facesByX(g, true) },
        { type: 'force', faceIndices: facesByX(g, false), value: [100, 0, 0] },
      ],
    });
    expect(Number.isFinite(res.maxDisplacement)).toBe(true);
    expect(res.maxDisplacement).toBeLessThan(1e6);
    expect(['linear-fem-tet', 'beam-theory']).toContain(res.method);
  });

  // M1 ACCEPTANCE GATE (roadmap) — re-enable when the 3D solver is trustworthy:
  // a cantilever / axial bar must land within a few % of the analytic deflection.
  // Skipped today because the linear-tet solver is ~10–80× off and often diverges.
  it.skip('M1: axial bar tip deflection within a few % of FL/AE', () => {
    const L = 100, a = 20, F = 80000;
    const g = new THREE.BoxGeometry(L, a, a, 25, 5, 5);
    const E = steel.youngsModulus * 1000, A = a * a;
    const analytic = (F * L) / (A * E);
    const res = runSimpleFEA(g, {
      material: steel,
      conditions: [
        { type: 'fixed', faceIndices: facesByX(g, true) },
        { type: 'force', faceIndices: facesByX(g, false), value: [F, 0, 0] },
      ],
    });
    expect(res.method).toBe('linear-fem-tet');
    expect(res.maxDisplacement).toBeGreaterThan(analytic * 0.9);
    expect(res.maxDisplacement).toBeLessThan(analytic * 1.1);
  });
});
