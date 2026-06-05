/**
 * guyan — static condensation, verified to be EXACT for statics: it reproduces a
 * hand-checkable spring-chain condensation, and on a full FEM stiffness the reduced
 * model recovers the master AND slave displacements of the full solve to machine
 * precision.
 */
import { describe, it, expect } from 'vitest';
import { guyanReduce } from './guyan';
import { TopologyGrid, buildHex8K0 } from '../analysis/topology3D';

/** Dense Gaussian solve A x = b. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c]; for (let j = c; j <= n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((r) => r[n]);
}

describe('guyan — static condensation (verified)', () => {
  it('matches the hand-checkable spring-chain condensation', () => {
    // chain 2,-1,2,-1,2; condense the middle DOF.
    const K = [[2, -1, 0], [-1, 2, -1], [0, -1, 2]];
    const g = guyanReduce(K, [0, 2]);
    expect(g.Kred[0][0]).toBeCloseTo(1.5, 12);
    expect(g.Kred[0][1]).toBeCloseTo(-0.5, 12);
    const fm = g.reduceForce([1, 0, 1]);
    expect(fm).toEqual([1, 1]);
    const um = solve(g.Kred, fm);
    expect(um[0]).toBeCloseTo(1, 12);
    expect(um[1]).toBeCloseTo(1, 12);
    expect(g.recoverSlaves(um)[0]).toBeCloseTo(1, 12);    // middle DOF recovered
  });

  it('reproduces a full FEM solve exactly at the master and slave DOFs', () => {
    // free elastic stiffness of a 2×1×1 grid fixed on the x=0 face.
    const E = 210000, nu = 0.3, h = 10;
    const grid = new TopologyGrid(2, 1, 1);
    const K0 = buildHex8K0(nu), kS = E * h, nDof = grid.nNodes * 3;
    const full = Array.from({ length: nDof }, () => new Array<number>(nDof).fill(0));
    const ed = new Int32Array(24);
    for (let ex = 0; ex < 2; ex++) {
      const ns = grid.elemNodes(ex, 0, 0);
      for (let i = 0; i < 8; i++) { ed[i * 3] = ns[i] * 3; ed[i * 3 + 1] = ns[i] * 3 + 1; ed[i * 3 + 2] = ns[i] * 3 + 2; }
      for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) full[ed[i]][ed[j]] += kS * K0[i * 24 + j];
    }
    const fixed = new Set<number>();
    for (let iy = 0; iy <= 1; iy++) for (let iz = 0; iz <= 1; iz++) { const n = grid.node(0, iy, iz); fixed.add(n * 3); fixed.add(n * 3 + 1); fixed.add(n * 3 + 2); }
    const free: number[] = []; for (let d = 0; d < nDof; d++) if (!fixed.has(d)) free.push(d);
    const Kf = free.map((r) => free.map((c) => full[r][c]));

    // masters = the tip-face x-DOFs; load the tip.
    const masters = [0, 1, 2, 3].map((k) => {
      const tip = [grid.node(2, 0, 0), grid.node(2, 1, 0), grid.node(2, 0, 1), grid.node(2, 1, 1)][k] * 3 + 0;
      return free.indexOf(tip);
    });
    const f = new Array<number>(free.length).fill(0);
    for (const m of masters) f[m] = 1000;

    const uFull = solve(Kf, f);
    const g = guyanReduce(Kf, masters);
    const umRed = solve(g.Kred, g.reduceForce(f));
    const uExpand = g.expand(umRed);

    let masterErr = 0, fullErr = 0;
    for (let i = 0; i < masters.length; i++) masterErr = Math.max(masterErr, Math.abs(umRed[i] - uFull[masters[i]]));
    for (let i = 0; i < free.length; i++) fullErr = Math.max(fullErr, Math.abs(uExpand[i] - uFull[i]));
    expect(masterErr).toBeLessThan(1e-9);                 // exact for statics
    expect(fullErr).toBeLessThan(1e-9);                   // slave recovery exact too
    expect(g.Kred.length).toBe(4);                        // condensed 24 → 4 DOFs
  });
});
