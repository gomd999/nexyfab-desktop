/**
 * truss2D.ts — planar pin-jointed truss by the DIRECT STIFFNESS method (a genuine
 * bar-element FEM, the skeletal counterpart of the continuum solver). Each bar carries
 * only axial force; the global stiffness is assembled, supports applied, and member
 * forces recovered as (EA/L)·axial elongation (tension positive).
 *
 *   bar stiffness:  k = (EA/L)·[c²,cs,−c²,−cs; …]   (c=cosα, s=sinα)
 *   determinacy:    m + r = 2j   (members + reactions = 2·joints ⇒ statically determinate)
 *
 * Verified against the single-bar PL/EA elongation, the symmetric two-bar truss member
 * force P/(2 sinθ), the determinacy count, and joint equilibrium.
 */

export interface Node { x: number; y: number; }
export interface Member { i: number; j: number; EA: number; }

export interface TrussResult {
  displacement: number[];   // [u0,v0,u1,v1,...]
  memberForces: number[];   // tension positive
}

function solveDense(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-300; for (let k = c; k <= n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r) => r[n]);
}

/** Solve a 2-D truss. `fixed` = set of constrained DOFs (node*2+axis); `loads` = DOF→force. */
export function solveTruss(nodes: Node[], members: Member[], fixed: Set<number>, loads: Map<number, number>): TrussResult {
  const nDof = nodes.length * 2;
  const K = Array.from({ length: nDof }, () => new Array<number>(nDof).fill(0));
  const geom = members.map((m) => {
    const dx = nodes[m.j].x - nodes[m.i].x, dy = nodes[m.j].y - nodes[m.i].y;
    const L = Math.hypot(dx, dy);
    return { L, c: dx / L, s: dy / L };
  });
  members.forEach((m, e) => {
    const { L, c, s } = geom[e];
    const k = m.EA / L;
    const dof = [m.i * 2, m.i * 2 + 1, m.j * 2, m.j * 2 + 1];
    const ke = [
      [c * c, c * s, -c * c, -c * s],
      [c * s, s * s, -c * s, -s * s],
      [-c * c, -c * s, c * c, c * s],
      [-c * s, -s * s, c * s, s * s],
    ];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) K[dof[a]][dof[b]] += k * ke[a][b];
  });
  // reduce + solve
  const free: number[] = [];
  for (let d = 0; d < nDof; d++) if (!fixed.has(d)) free.push(d);
  const Kf = free.map((r) => free.map((cc) => K[r][cc]));
  const f = free.map((d) => loads.get(d) ?? 0);
  const uf = solveDense(Kf, f);
  const u = new Array<number>(nDof).fill(0);
  free.forEach((d, i) => { u[d] = uf[i]; });

  const memberForces = members.map((m, e) => {
    const { L, c, s } = geom[e];
    const elong = c * (u[m.j * 2] - u[m.i * 2]) + s * (u[m.j * 2 + 1] - u[m.i * 2 + 1]);
    return (m.EA / L) * elong;
  });
  return { displacement: u, memberForces };
}

/** Static determinacy index m + r − 2j (0 = determinate, <0 mechanism, >0 indeterminate). */
export function determinacy(nMembers: number, nReactions: number, nJoints: number): number {
  return nMembers + nReactions - 2 * nJoints;
}
