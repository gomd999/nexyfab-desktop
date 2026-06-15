/**
 * mpc.ts — multipoint constraints (MPC / RBE2 rigid links) by the master–slave
 * TRANSFORMATION method. Each slave DOF is a linear combination of master DOFs:
 *
 *   u_s = Σ c_i · u_{m,i}        ⇒    u = T q   (q = independent DOFs)
 *   K_red = Tᵀ K T,   f_red = Tᵀ f         (force at a slave is carried to its masters)
 *
 * A force applied at a slave DOF is transmitted to the masters through Tᵀ — for a
 * rigid link this turns an offset force into a force + moment at the base, exactly.
 * Verified against the rigid-arm compliance v = F/k_v + F L²/k_θ.
 */

export interface MPC {
  /** Dependent (slave) DOF index. */
  slave: number;
  /** u_slave = Σ coeff · u_master. */
  terms: Array<{ master: number; coeff: number }>;
}

function solveDense(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-300; for (let j = c; j <= n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f !== 0) for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((r) => r[n]);
}

export interface MPCResult {
  /** Full DOF solution (independents solved, slaves recovered). */
  u: number[];
  /** Independent (retained) DOF indices. */
  independent: number[];
  /** The transformation matrix T (n × nIndependent), u = T q. */
  T: number[][];
}

/**
 * Solve K u = f subject to the multipoint constraints, by building the constraint
 * transformation T (u = T q), reducing K_red = Tᵀ K T and f_red = Tᵀ f, solving the
 * independent DOFs and recovering the full field.
 */
export function solveWithMPC(K: number[][], f: number[], constraints: MPC[]): MPCResult {
  const n = K.length;
  const slaveOf = new Map<number, MPC>();
  for (const c of constraints) slaveOf.set(c.slave, c);
  const independent: number[] = [];
  for (let d = 0; d < n; d++) if (!slaveOf.has(d)) independent.push(d);
  const indIndex = new Map<number, number>(independent.map((d, i) => [d, i]));
  const m = independent.length;

  // T (n × m): u = T q.
  const T = Array.from({ length: n }, () => new Array<number>(m).fill(0));
  for (const d of independent) T[d][indIndex.get(d)!] = 1;
  for (const c of constraints) {
    for (const t of c.terms) {
      const col = indIndex.get(t.master);
      if (col === undefined) throw new Error('MPC master must be an independent DOF (no chained constraints)');
      T[c.slave][col] += t.coeff;
    }
  }

  // K_red = Tᵀ K T, f_red = Tᵀ f
  const KT = Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => {
    let v = 0; for (let k = 0; k < n; k++) v += K[i][k] * T[k][j]; return v;
  }));
  const Kred = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => {
    let v = 0; for (let k = 0; k < n; k++) v += T[k][i] * KT[k][j]; return v;
  }));
  const fred = Array.from({ length: m }, (_, i) => { let v = 0; for (let k = 0; k < n; k++) v += T[k][i] * f[k]; return v; });

  const q = solveDense(Kred, fred);
  const u = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) { let v = 0; for (let j = 0; j < m; j++) v += T[i][j] * q[j]; u[i] = v; }
  return { u, independent, T };
}

/**
 * Build a 2D RBE2 rigid-link constraint set tying a slave node (DOFs su,sv,sθ) to a
 * master node (mu,mv,mθ) located at offset (rx,ry) = slave − master:
 *   u_s = u_m − ry·θ_m,  v_s = v_m + rx·θ_m,  θ_s = θ_m.
 */
export function rigidLink2D(master: [number, number, number], slave: [number, number, number], rx: number, ry: number): MPC[] {
  const [mu, mv, mt] = master, [su, sv, st] = slave;
  return [
    { slave: su, terms: [{ master: mu, coeff: 1 }, { master: mt, coeff: -ry }] },
    { slave: sv, terms: [{ master: mv, coeff: 1 }, { master: mt, coeff: rx }] },
    { slave: st, terms: [{ master: mt, coeff: 1 }] },
  ];
}
