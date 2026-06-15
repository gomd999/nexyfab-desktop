/**
 * guyan.ts — Guyan / static condensation (substructuring). Eliminates the "slave"
 * DOFs of a stiffness matrix, keeping only the retained "master" DOFs:
 *
 *   u_s = −K_ss⁻¹ K_sm u_m          (slaves slaved to masters, no slave load)
 *   K_red = K_mm − K_ms K_ss⁻¹ K_sm  (condensed stiffness)
 *   f_red = f_m − K_ms K_ss⁻¹ f_s     (condensed force)
 *
 * For STATICS this is EXACT — the reduced model reproduces the full master-DOF
 * displacements (and the recovered slave displacements) to machine precision.
 * Verified against a hand-checkable spring chain and a full FEM solve.
 */

/** Dense Gaussian elimination solve A X = B (B may have multiple columns). */
function solveMulti(A: number[][], B: number[][]): number[][] {
  const n = A.length, m = B[0]?.length ?? 0;
  const M = A.map((row, i) => [...row, ...B[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-300;
    for (let j = c; j < n + m; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f !== 0) for (let j = c; j < n + m; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((row) => row.slice(n));
}

export interface GuyanModel {
  masters: number[];
  slaves: number[];
  /** Condensed stiffness on the master DOFs (m×m). */
  Kred: number[][];
  /** Recover slave displacements from the master solution: u_s = −K_ss⁻¹ K_sm u_m. */
  recoverSlaves(um: number[]): number[];
  /** Condense a full force vector to the master DOFs. */
  reduceForce(f: number[]): number[];
  /** Expand a master displacement vector to the full DOF set. */
  expand(um: number[]): number[];
}

/** Statically condense `K` onto the master DOFs (Guyan reduction). */
export function guyanReduce(K: number[][], masters: number[]): GuyanModel {
  const n = K.length;
  const mset = new Set(masters);
  const slaves: number[] = [];
  for (let i = 0; i < n; i++) if (!mset.has(i)) slaves.push(i);
  const m = masters.length, s = slaves.length;

  const sub = (rows: number[], cols: number[]) => rows.map((r) => cols.map((c) => K[r][c]));
  const Kmm = sub(masters, masters), Kms = sub(masters, slaves), Ksm = sub(slaves, masters), Kss = sub(slaves, slaves);

  // X = K_ss⁻¹ K_sm  (s×m)
  const X = s > 0 ? solveMulti(Kss, Ksm) : [];
  // K_red = K_mm − K_ms·X
  const Kred = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => {
    let v = Kmm[i][j];
    for (let k = 0; k < s; k++) v -= Kms[i][k] * X[k][j];
    return v;
  }));

  const recoverSlaves = (um: number[]): number[] => {
    const us = new Array<number>(s).fill(0);
    for (let k = 0; k < s; k++) { let v = 0; for (let j = 0; j < m; j++) v += X[k][j] * um[j]; us[k] = -v; }
    return us;
  };
  const reduceForce = (f: number[]): number[] => {
    const fm = masters.map((d) => f[d]);
    if (s === 0) return fm;
    const fs = slaves.map((d) => f[d]);
    // K_ms·K_ss⁻¹·f_s = K_ms·solve(K_ss, f_s)
    const y = solveMulti(Kss, fs.map((v) => [v])).map((r) => r[0]);
    for (let i = 0; i < m; i++) { let v = 0; for (let k = 0; k < s; k++) v += Kms[i][k] * y[k]; fm[i] -= v; }
    return fm;
  };
  const expand = (um: number[]): number[] => {
    const u = new Array<number>(n).fill(0);
    masters.forEach((d, i) => { u[d] = um[i]; });
    const us = recoverSlaves(um);
    slaves.forEach((d, k) => { u[d] = us[k]; });
    return u;
  };

  return { masters, slaves, Kred, recoverSlaves, reduceForce, expand };
}
