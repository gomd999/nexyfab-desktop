/**
 * craigBampton.ts — Craig–Bampton component-mode synthesis: the DYNAMIC extension
 * of Guyan condensation. The substructure is reduced to its boundary (interface)
 * DOFs plus a few fixed-interface normal modes, so the reduced model keeps the low
 * natural frequencies accurately (Guyan keeps only statics and is poor for dynamics).
 *
 *   reduction basis  T = [ Φ_c   Φ_n ]   (constraint modes Φ_c = −K_ii⁻¹K_ib, fixed-
 *                         [  I     0 ]    interface modes Φ_n; identity on the boundary)
 *   M̃ = Tᵀ M T,  K̃ = Tᵀ K T          (reduced mass / stiffness)
 *
 * Verified: the reduced model's lowest natural frequencies converge to the full
 * model's as modes are added, and it beats Guyan (which omits Φ_n) — with the
 * interface free, the reduced eigenfrequencies match the full ones closely.
 */

/** Solve the symmetric generalized eigenproblem K φ = λ M φ (M diagonal or dense)
 *  for the lowest `count` modes, by inverse iteration with deflation. Dense, small. */
function generalizedEig(K: number[][], M: number[][], count: number): { values: number[]; vectors: number[][] } {
  const n = K.length;
  const lu = luFactor(K);
  const priors: number[][] = [];
  const values: number[] = [], vectors: number[][] = [];
  const mul = (A: number[][], x: number[]) => A.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
  const mdot = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) s += a[i] * M[i][j] * b[j]; return s; };
  for (let m = 0; m < count; m++) {
    let x = Array.from({ length: n }, (_, i) => Math.sin((i + 1) * (m + 1) * 0.7));
    let lambda = 0;
    for (let it = 0; it < 300; it++) {
      // deflate against priors (M-orthogonal)
      for (const p of priors) { const c = mdot(p, x); for (let i = 0; i < n; i++) x[i] -= c * p[i]; }
      const y = luSolve(lu, mul(M, x));
      for (const p of priors) { const c = mdot(p, y); for (let i = 0; i < n; i++) y[i] -= c * p[i]; }
      const nrm = Math.sqrt(mdot(y, y));
      if (nrm < 1e-30) break;
      for (let i = 0; i < n; i++) y[i] /= nrm;
      const newLambda = 1 / nrm;
      const conv = Math.abs(newLambda - lambda) < 1e-10 * Math.max(1, newLambda);
      lambda = newLambda; x = y;
      if (conv) break;
    }
    priors.push(x.slice());
    values.push(lambda); vectors.push(x.slice());
  }
  return { values, vectors };
}

function luFactor(A: number[][]): { LU: number[][]; piv: number[] } {
  const n = A.length, LU = A.map((r) => r.slice()), piv = Array.from({ length: n }, (_, i) => i);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(LU[r][c]) > Math.abs(LU[p][c])) p = r;
    if (p !== c) { [LU[c], LU[p]] = [LU[p], LU[c]]; [piv[c], piv[p]] = [piv[p], piv[c]]; }
    const d = LU[c][c] || 1e-300;
    for (let r = c + 1; r < n; r++) { LU[r][c] /= d; for (let j = c + 1; j < n; j++) LU[r][j] -= LU[r][c] * LU[c][j]; }
  }
  return { LU, piv };
}
function luSolve(f: { LU: number[][]; piv: number[] }, b: number[]): number[] {
  const n = f.LU.length, y = new Array<number>(n);
  for (let i = 0; i < n; i++) { let s = b[f.piv[i]]; for (let j = 0; j < i; j++) s -= f.LU[i][j] * y[j]; y[i] = s; }
  const x = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let j = i + 1; j < n; j++) s -= f.LU[i][j] * x[j]; x[i] = s / (f.LU[i][i] || 1e-300); }
  return x;
}

const sub = (A: number[][], r: number[], c: number[]) => r.map((i) => c.map((j) => A[i][j]));
const matmul = (A: number[][], B: number[][]) => A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
const transpose = (A: number[][]) => A[0].map((_, j) => A.map((row) => row[j]));

export interface CraigBamptonModel {
  /** Reduced stiffness K̃ and mass M̃ on [boundary DOFs ; nModes internal coords]. */
  Kr: number[][]; Mr: number[][];
  boundary: number[]; nModes: number;
  /** Reduction basis T (n × (nBoundary+nModes)). */
  T: number[][];
}

/**
 * Build the Craig–Bampton reduced (K̃, M̃) keeping the given boundary DOFs and the
 * lowest `nModes` fixed-interface normal modes.
 */
export function craigBampton(K: number[][], M: number[][], boundary: number[], nModes: number): CraigBamptonModel {
  const n = K.length;
  const bset = new Set(boundary);
  const interior: number[] = [];
  for (let i = 0; i < n; i++) if (!bset.has(i)) interior.push(i);
  const nb = boundary.length, ni = interior.length;

  const Kii = sub(K, interior, interior), Kib = sub(K, interior, boundary);
  // constraint modes: Φ_c = −K_ii⁻¹ K_ib  (ni × nb)
  const luii = luFactor(Kii);
  const Phic = Array.from({ length: ni }, () => new Array<number>(nb).fill(0));
  for (let j = 0; j < nb; j++) {
    const col = luSolve(luii, Kib.map((r) => r[j]));
    for (let i = 0; i < ni; i++) Phic[i][j] = -col[i];
  }
  // fixed-interface normal modes: eig of (Kii, Mii)
  const Mii = sub(M, interior, interior);
  const { vectors } = nModes > 0 ? generalizedEig(Kii, Mii, nModes) : { vectors: [] as number[][] };

  // assemble T (n × (nb+nModes)): boundary identity, interior = Φ_c·u_b + Φ_n·q
  const m = nb + nModes;
  const T = Array.from({ length: n }, () => new Array<number>(m).fill(0));
  boundary.forEach((d, j) => { T[d][j] = 1; });
  interior.forEach((d, i) => {
    for (let j = 0; j < nb; j++) T[d][j] = Phic[i][j];
    for (let k = 0; k < nModes; k++) T[d][nb + k] = vectors[k][i];
  });

  const KT = matmul(K, T), MT = matmul(M, T), Tt = transpose(T);
  return { Kr: matmul(Tt, KT), Mr: matmul(Tt, MT), boundary, nModes, T };
}

/** Lowest natural frequencies (rad/s) of a (K,M) pair — helper for verification. */
export function naturalFrequencies(K: number[][], M: number[][], count: number): number[] {
  return generalizedEig(K, M, count).values.map((l) => Math.sqrt(Math.max(0, l)));
}
