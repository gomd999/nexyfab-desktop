/**
 * feaConvergenceGuard — Track M (FEA) defence-in-depth.
 *
 * History: the 3D linear-tet FEM used to return astronomically large spurious
 * displacements (~1e12–1e16 mm) and runSimpleFEA surfaced that garbage as real
 * (it ignored `converged`). The solver itself was since fixed (conforming
 * structured-grid mesh + robust inside test + full-face BC + Dirichlet
 * elimination — see femSolver + feaAnalyticBenchmark), so it now converges and
 * lands within ~10% of analytic. This guard stays as defence-in-depth: any input
 * that still produces a non-converged / non-finite / kilometre-scale result must
 * fall back to beam theory rather than show fabricated stress.
 * block-rather-than-silently-wrong.
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

});
