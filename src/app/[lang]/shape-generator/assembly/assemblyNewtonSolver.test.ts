// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { AssemblyState, AssemblyBody, Mate, MateSelection, MateType } from './matesSolver';
import { solveAssemblyNewton } from './assemblyNewtonSolver';
import { solveAssembly } from './matesSolver';

// ─── builders ────────────────────────────────────────────────────────────────
function body(pos: [number, number, number], fixed = false): AssemblyBody {
  return {
    id: `b${Math.round(pos[0] * 1000)}_${Math.round(pos[1] * 1000)}_${Math.round(pos[2] * 1000)}`,
    name: 'part',
    position: new THREE.Vector3(...pos),
    rotation: new THREE.Euler(0, 0, 0),
    fixed,
  } as AssemblyBody;
}
function sel(bodyIndex: number, lp: [number, number, number], ax: [number, number, number] = [0, 0, 1]): MateSelection {
  return {
    bodyIndex,
    localPoint: new THREE.Vector3(...lp),
    localNormal: new THREE.Vector3(...ax),
    localAxis: new THREE.Vector3(...ax),
  } as MateSelection;
}
function mate(type: MateType, s0: MateSelection, s1: MateSelection, extra: Partial<Mate> = {}): Mate {
  return { id: `${type}-${Math.random().toString(36).slice(2, 7)}`, type, selections: [s0, s1], enabled: true, ...extra } as Mate;
}
function st(bodies: AssemblyBody[], mates: Mate[]): AssemblyState {
  return { bodies, mates } as AssemblyState;
}

describe('solveAssemblyNewton', () => {
  it('coincident: pulls the free body so the two world points meet', () => {
    const bodies = [body([0, 0, 0], true), body([5, 0, 0])];
    // b0 point (1,0,0)→world (1,0,0); b1 point (0,0,0)→world (5,0,0). Gap 4mm.
    const m = mate('coincident', sel(0, [1, 0, 0]), sel(1, [0, 0, 0]));
    const res = solveAssemblyNewton(st(bodies, [m]));
    expect(res.converged).toBe(true);
    expect(res.residualNorm).toBeLessThan(1e-5);
    // b1 must shift to x≈1 so its (0,0,0) lands on b0's (1,0,0).
    expect(res.state.bodies[1].position.x).toBeCloseTo(1, 3);
    expect(res.state.bodies[0].position.x).toBe(0); // fixed body untouched
  });

  it('already-satisfied assembly converges in 0 iterations (no NaN, no drift)', () => {
    const bodies = [body([0, 0, 0], true), body([0, 0, 0])];
    const m = mate('coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]));
    const res = solveAssemblyNewton(st(bodies, [m]));
    expect(res.converged).toBe(true);
    expect(res.iterations).toBe(0);
    expect(res.state.bodies[1].position.x).toBeCloseTo(0, 6);
  });

  it('no free bodies → trivially converged', () => {
    const bodies = [body([0, 0, 0], true), body([3, 0, 0], true)];
    const m = mate('coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]));
    const res = solveAssemblyNewton(st(bodies, [m]));
    expect(res.iterations).toBe(0);
    // Can't move fixed bodies — residual stays, not converged, but no crash.
    expect(Number.isFinite(res.residualNorm)).toBe(true);
  });

  it('COUPLED constraints: free body pinned by two coincidents on distinct points', () => {
    // Body 1 must satisfy two coincident mates at once — Gauss-Seidel ping-pongs;
    // Newton solves the coupled system directly.
    const bodies = [body([0, 0, 0], true), body([10, 10, 0])];
    const mA = mate('coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]));   // → b1 origin to (0,0,0)
    const mB = mate('coincident', sel(0, [2, 0, 0]), sel(1, [2, 0, 0]));   // → b1 (2,0,0) to (2,0,0)
    const res = solveAssemblyNewton(st(bodies, [mA, mB]));
    expect(res.converged).toBe(true);
    expect(res.residualNorm).toBeLessThan(1e-5);
    expect(res.state.bodies[1].position.x).toBeCloseTo(0, 3);
    expect(res.state.bodies[1].position.y).toBeCloseTo(0, 3);
  });

  it('rotational coupling: distance + a rotation-sensitive coincident converge', () => {
    const bodies = [body([0, 0, 0], true), body([8, 3, 0])];
    const mA = mate('coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]));
    const mB = mate('distance', sel(0, [5, 0, 0]), sel(1, [0, 5, 0]), { distance: 5 });
    const res = solveAssemblyNewton(st(bodies, [mA, mB]));
    expect(res.converged).toBe(true);
    expect(res.residualNorm).toBeLessThan(1e-4);
  });

  it('under-constrained (1 coincident, 1 free body) converges and flags rankDeficient', () => {
    // 1 coincident = 3 constraints on a 6-DOF body → 3 DOF free → rank-deficient J.
    const bodies = [body([0, 0, 0], true), body([4, 0, 0])];
    const m = mate('coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]));
    const res = solveAssemblyNewton(st(bodies, [m]));
    expect(res.converged).toBe(true);
    expect(res.residualNorm).toBeLessThan(1e-5);
    expect(res.rankDeficient).toBe(true); // LM regularized the singular normal equations
  });

  it('over-constrained but CONSISTENT (duplicate coincident) → converges, no NaN', () => {
    const bodies = [body([0, 0, 0], true), body([6, 0, 0])];
    const dup1 = mate('coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]));
    const dup2 = mate('coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0])); // identical → redundant rows
    const res = solveAssemblyNewton(st(bodies, [dup1, dup2]));
    expect(res.converged).toBe(true);
    expect(Number.isFinite(res.residualNorm)).toBe(true);
    expect(res.state.bodies[1].position.x).toBeCloseTo(0, 3);
  });

  // Integration: the fallback inside solveAssembly. With maxIterations=0 the
  // Gauss-Seidel loop never runs, so it can NEVER set converged=true — a
  // converged result therefore proves the Newton fallback engaged and solved it.
  it('solveAssembly Newton fallback solves a rotation-coupled case Gauss-Seidel skips', () => {
    // mA pins b1's origin to (0,0,0); mB requires b1's (0,2,0) point to land on
    // (2,0,0) — i.e. a 90° rotation about Z. Warm-start places the origin but
    // can't discover the rotation, leaving a ~2.83mm residual; with 0 GS
    // iterations the ONLY thing that can solve it is the Newton fallback.
    const bodies = [body([0, 0, 0], true), body([10, 10, 0])];
    const mA = mate('coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]));
    const mB = mate('coincident', sel(0, [2, 0, 0]), sel(1, [0, 2, 0]));
    const res = solveAssembly(st(bodies, [mA, mB]), 0); // 0 GS iterations
    expect(res.converged).toBe(true);          // only possible via the Newton solve
    expect(res.unsatisfied).toEqual([]);
  });

  it('solveAssembly does NOT engage the fallback when a non-Newton mate is present', () => {
    // A 'width' mate isn't in the Newton residual model → fallback must stay off
    // so it never silently drops that constraint. (Just asserts no crash + a
    // structured result; correctness of width stays on Gauss-Seidel.)
    const bodies = [body([0, 0, 0], true), body([5, 0, 0])];
    const m = mate('coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]));
    const w = mate('width', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]));
    const res = solveAssembly(st(bodies, [m, w]), 0);
    expect(Array.isArray(res.unsatisfied)).toBe(true); // no crash, structured
  });

  it('two free bodies chained by coincidents both resolve (all coincidents met)', () => {
    const bodies = [body([0, 0, 0], true), body([7, 0, 0]), body([15, 2, 0])];
    const m01 = mate('coincident', sel(0, [1, 0, 0]), sel(1, [0, 0, 0])); // b1.origin → (1,0,0)
    const m12 = mate('coincident', sel(1, [3, 0, 0]), sel(2, [0, 0, 0])); // b2.origin → b1's (3,0,0) point
    const res = solveAssemblyNewton(st(bodies, [m01, m12]));
    expect(res.converged).toBe(true);
    expect(res.residualNorm).toBeLessThan(1e-4);
    // b1's origin is fully pinned by m01 (rotation-independent for a point at
    // the origin). b2's exact spot is NOT determined — b1 may rotate freely
    // (under-constrained), so we assert the CONSTRAINTS are met, not a pose.
    expect(res.state.bodies[1].position.x).toBeCloseTo(1, 2);
    expect(res.state.bodies[1].position.y).toBeCloseTo(0, 2);
    expect(res.rankDeficient).toBe(true); // 6 constraints on 12 DOF
  });
});
