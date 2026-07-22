/**
 * ichol.ts — robust preconditioners for the sparse PCG FEM solver.
 *
 * WHY: `femSolver.ts::sparsePCG` uses a scalar Jacobi (diagonal) preconditioner.
 * That is fine for the small validation cases (A1–A4) but STOPS CONVERGING past
 * ~9k DOF, which is the hard wall preventing the fine mesh that stress-raiser
 * benchmarks (e.g. plate-hole Kt / A5) need. This module supplies two stronger,
 * fully deterministic preconditioners that plug into the SAME CG loop:
 *
 *   1. blockJacobi3x3 — invert each nodal 3x3 diagonal block (x/y/z DOFs of a
 *      node). Cheap and robust; respects the elasticity coupling that scalar
 *      Jacobi throws away. A good stepping-stone that never fails on an SPD K.
 *
 *   2. incompleteCholesky0 — IC(0): incomplete Cholesky with ZERO fill on K's
 *      existing sparsity pattern, producing a lower factor L with L*Lᵀ ≈ K.
 *      Includes a diagonal (Manteuffel) shift fallback: if a non-positive pivot
 *      appears, the factorization restarts on K + alpha*diag(K) with an
 *      increasing alpha until it is SPD-stable. This is the real enabler for
 *      fine-mesh convergence.
 *
 * Everything here is pure TypeScript over the existing CSR arrays
 * (values / colIndices / rowPtr). No three / WebGL. Deterministic and
 * unit-testable in isolation.
 *
 * NOTE: K is assumed SYMMETRIC POSITIVE-DEFINITE (true for the FEM stiffness
 * matrix after Dirichlet elimination) and stored with the FULL pattern (both
 * upper and lower entries, diagonal present) — which is how `CSRMatrix` in
 * femSolver is assembled.
 */

/** Minimal structural view of the CSR matrix we depend on. */
export interface CSRLike {
  readonly nRows: number;
  readonly nCols: number;
  values: Float64Array;
  colIndices: Int32Array;
  rowPtr: Int32Array;
}

/**
 * A preconditioner M⁻¹ presented to the CG loop.
 * `apply(r)` returns a fresh z = M⁻¹ r (convenient for tests / one-shot use).
 * `applyInto(r, z)` fills a caller-owned z in place (no allocation — used by the
 * hot CG loop).
 */
export interface Preconditioner {
  readonly name: string;
  apply(r: Float64Array): Float64Array;
  applyInto(r: Float64Array, z: Float64Array): void;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Block-Jacobi (3x3 nodal blocks)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Build a block-Jacobi preconditioner using the nodal 3x3 diagonal blocks.
 *
 * DOFs are grouped x/y/z per node: node k owns DOFs 3k, 3k+1, 3k+2. Each 3x3
 * diagonal block is inverted analytically (closed-form 3x3 inverse). If a block
 * is singular / ill-conditioned, that block falls back to scalar Jacobi on its
 * own diagonal (never crashes). Any trailing DOFs when n is not a multiple of 3
 * are handled by scalar Jacobi too.
 */
export function blockJacobi3x3(K: CSRLike): Preconditioner {
  const n = K.nRows;
  const nBlocks = Math.floor(n / 3);
  // 9 inverse entries per block, row-major: [a00,a01,a02, a10,a11,a12, a20,a21,a22]
  const inv = new Float64Array(nBlocks * 9);
  // Scalar-Jacobi fallback for singular blocks and trailing DOFs.
  const dInv = new Float64Array(n);

  const diag = getDiagonal(K);
  for (let i = 0; i < n; i++) {
    dInv[i] = Math.abs(diag[i]) > 1e-15 ? 1.0 / diag[i] : 1.0;
  }

  for (let b = 0; b < nBlocks; b++) {
    const base = 3 * b;
    // Gather the 3x3 block A = K[base..base+2, base..base+2].
    const a = readBlock3(K, base);
    const det =
      a[0] * (a[4] * a[8] - a[5] * a[7]) -
      a[1] * (a[3] * a[8] - a[5] * a[6]) +
      a[2] * (a[3] * a[7] - a[4] * a[6]);

    const o = b * 9;
    if (Math.abs(det) < 1e-300 || !Number.isFinite(det)) {
      // Singular block: store a diagonal inverse in the block slots so apply
      // stays branch-light (degenerate but always usable).
      inv[o + 0] = dInv[base]; inv[o + 1] = 0; inv[o + 2] = 0;
      inv[o + 3] = 0; inv[o + 4] = dInv[base + 1]; inv[o + 5] = 0;
      inv[o + 6] = 0; inv[o + 7] = 0; inv[o + 8] = dInv[base + 2];
      continue;
    }

    const id = 1.0 / det;
    inv[o + 0] = (a[4] * a[8] - a[5] * a[7]) * id;
    inv[o + 1] = (a[2] * a[7] - a[1] * a[8]) * id;
    inv[o + 2] = (a[1] * a[5] - a[2] * a[4]) * id;
    inv[o + 3] = (a[5] * a[6] - a[3] * a[8]) * id;
    inv[o + 4] = (a[0] * a[8] - a[2] * a[6]) * id;
    inv[o + 5] = (a[2] * a[3] - a[0] * a[5]) * id;
    inv[o + 6] = (a[3] * a[7] - a[4] * a[6]) * id;
    inv[o + 7] = (a[1] * a[6] - a[0] * a[7]) * id;
    inv[o + 8] = (a[0] * a[4] - a[1] * a[3]) * id;
  }

  const applyInto = (r: Float64Array, z: Float64Array): void => {
    for (let b = 0; b < nBlocks; b++) {
      const base = 3 * b;
      const o = b * 9;
      const r0 = r[base], r1 = r[base + 1], r2 = r[base + 2];
      z[base] = inv[o + 0] * r0 + inv[o + 1] * r1 + inv[o + 2] * r2;
      z[base + 1] = inv[o + 3] * r0 + inv[o + 4] * r1 + inv[o + 5] * r2;
      z[base + 2] = inv[o + 6] * r0 + inv[o + 7] * r1 + inv[o + 8] * r2;
    }
    // Trailing DOFs (n not divisible by 3) — scalar Jacobi.
    for (let i = 3 * nBlocks; i < n; i++) z[i] = dInv[i] * r[i];
  };

  return {
    name: 'block-jacobi-3x3',
    applyInto,
    apply(r: Float64Array): Float64Array {
      const z = new Float64Array(n);
      applyInto(r, z);
      return z;
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Incomplete Cholesky IC(0) with Manteuffel diagonal-shift fallback
 * ────────────────────────────────────────────────────────────────────────── */

export interface IC0Factor extends Preconditioner {
  /** Whether a usable factorization was produced. */
  readonly ok: boolean;
  /** Manteuffel shift actually applied (0 if none was needed). alpha in K + alpha*diag(K). */
  readonly shift: number;
  /** Number of factorization attempts (1 == no shift needed). */
  readonly attempts: number;
  /** n (matrix dimension). */
  readonly n: number;
  // Exposed lower-factor arrays (same pattern as lower triangle of K).
  readonly Lval: Float64Array;
  readonly Lcol: Int32Array;
  readonly LrowPtr: Int32Array;
  readonly Ldiag: Int32Array;
}

/**
 * IC(0): incomplete Cholesky, zero fill-in on K's existing lower-triangle
 * sparsity pattern. Produces a lower-triangular factor L (with diagonal) such
 * that L Lᵀ ≈ K on that pattern.
 *
 * Robustness: if a non-positive pivot is hit (K only PSD, indefinite, or
 * rounding pushed a pivot ≤ 0), the whole factorization is restarted on
 * K + alpha*diag(K) with an increasing Manteuffel shift alpha until every pivot
 * is strictly positive. `shift` and `attempts` report what was needed. If even
 * a large shift fails, `ok` is false and callers should fall back to
 * block-Jacobi / Jacobi.
 */
export function incompleteCholesky0(K: CSRLike): IC0Factor {
  const n = K.nRows;

  // --- Extract lower triangle (col <= row) pattern + values, sorted by column. ---
  // CSRMatrix stores each row's columns already sorted ascending, so the lower
  // part of a row is a contiguous prefix up to and including the diagonal.
  let lnnz = 0;
  for (let i = 0; i < n; i++) {
    for (let p = K.rowPtr[i]; p < K.rowPtr[i + 1]; p++) {
      if (K.colIndices[p] <= i) lnnz++;
    }
  }
  const Lval = new Float64Array(lnnz);
  const Lcol = new Int32Array(lnnz);
  const LrowPtr = new Int32Array(n + 1);
  const Ldiag = new Int32Array(n).fill(-1);
  const A0 = new Float64Array(lnnz);     // pristine lower values of K (for shifted restarts)
  const origDiag = new Float64Array(n);  // original diagonal of K (shift basis)

  {
    let ptr = 0;
    for (let i = 0; i < n; i++) {
      LrowPtr[i] = ptr;
      for (let p = K.rowPtr[i]; p < K.rowPtr[i + 1]; p++) {
        const c = K.colIndices[p];
        if (c <= i) {
          Lcol[ptr] = c;
          A0[ptr] = K.values[p];
          if (c === i) { Ldiag[i] = ptr; origDiag[i] = K.values[p]; }
          ptr++;
        }
      }
    }
    LrowPtr[n] = ptr;
  }

  // Guard: every row must carry its diagonal, else IC(0) is undefined.
  for (let i = 0; i < n; i++) {
    if (Ldiag[i] < 0) return failedFactor(n, Lval, Lcol, LrowPtr, Ldiag);
  }

  // Workspace: colPos[c] = position in the CURRENT row i for column c, else -1.
  const colPos = new Int32Array(n).fill(-1);

  /**
   * Run IC(0) into Lval given a diagonal shift alpha (factor K + alpha*diag).
   * Returns true on success (all pivots > 0), false on a non-positive pivot.
   */
  const factorize = (alpha: number): boolean => {
    // Seed Lval with the pristine lower values, applying the shift on the diagonal.
    Lval.set(A0);
    if (alpha !== 0) {
      for (let i = 0; i < n; i++) Lval[Ldiag[i]] += alpha * origDiag[i];
    }

    for (let i = 0; i < n; i++) {
      const rs = LrowPtr[i], re = LrowPtr[i + 1];
      for (let p = rs; p < re; p++) colPos[Lcol[p]] = p;

      for (let p = rs; p < re; p++) {
        const j = Lcol[p];
        let sum = Lval[p];
        // subtract sum_{k < j, k ∈ row i ∩ row j} L[i][k] * L[j][k]
        const je = Ldiag[j];
        for (let pj = LrowPtr[j]; pj < je; pj++) {
          const pik = colPos[Lcol[pj]];
          if (pik >= 0) sum -= Lval[pik] * Lval[pj];
        }
        if (j < i) {
          Lval[p] = sum / Lval[Ldiag[j]];
        } else {
          // diagonal pivot
          if (!(sum > 0) || !Number.isFinite(sum)) {
            for (let q = rs; q < re; q++) colPos[Lcol[q]] = -1;
            return false;
          }
          Lval[p] = Math.sqrt(sum);
        }
      }

      for (let p = rs; p < re; p++) colPos[Lcol[p]] = -1;
    }
    return true;
  };

  // --- Attempt with increasing Manteuffel shift until SPD-stable. ---
  let alpha = 0;
  let attempts = 0;
  let ok = false;
  const maxAttempts = 30;
  for (attempts = 1; attempts <= maxAttempts; attempts++) {
    ok = factorize(alpha);
    if (ok) break;
    alpha = alpha === 0 ? 1e-4 : alpha * 4;
  }

  const applyInto = (r: Float64Array, z: Float64Array): void => {
    // Forward solve  L y = r   (write y into z, then overwrite in the back-solve).
    for (let i = 0; i < n; i++) {
      let sum = r[i];
      const di = Ldiag[i];
      for (let p = LrowPtr[i]; p < di; p++) sum -= Lval[p] * z[Lcol[p]];
      z[i] = sum / Lval[di];
    }
    // Back solve  Lᵀ z = y   (in place on z).
    for (let i = n - 1; i >= 0; i--) {
      const di = Ldiag[i];
      const zi = z[i] / Lval[di];
      z[i] = zi;
      for (let p = LrowPtr[i]; p < di; p++) z[Lcol[p]] -= Lval[p] * zi;
    }
  };

  return {
    name: 'incomplete-cholesky-0',
    ok,
    shift: ok ? alpha : Infinity,
    attempts,
    n,
    Lval, Lcol, LrowPtr, Ldiag,
    applyInto: ok
      ? applyInto
      : (r: Float64Array, z: Float64Array): void => { z.set(r); },
    apply(r: Float64Array): Float64Array {
      const z = new Float64Array(n);
      this.applyInto(r, z);
      return z;
    },
  };
}

/**
 * Forward + back triangular solve z = (L Lᵀ)⁻¹ r for an IC(0) factor.
 * Standalone helper mirroring the object's `applyInto`.
 */
export function applyIC0(L: IC0Factor, r: Float64Array): Float64Array {
  const z = new Float64Array(L.n);
  L.applyInto(r, z);
  return z;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * helpers
 * ────────────────────────────────────────────────────────────────────────── */

function getDiagonal(K: CSRLike): Float64Array {
  const n = K.nRows;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let p = K.rowPtr[i]; p < K.rowPtr[i + 1]; p++) {
      if (K.colIndices[p] === i) { d[i] = K.values[p]; break; }
    }
  }
  return d;
}

/** Read the 3x3 block K[base..base+2, base..base+2] into a row-major length-9 array. */
function readBlock3(K: CSRLike, base: number): Float64Array {
  const a = new Float64Array(9); // absent entries default to 0
  for (let rr = 0; rr < 3; rr++) {
    const row = base + rr;
    for (let p = K.rowPtr[row]; p < K.rowPtr[row + 1]; p++) {
      const cc = K.colIndices[p] - base;
      if (cc >= 0 && cc < 3) a[rr * 3 + cc] = K.values[p];
    }
  }
  return a;
}

function failedFactor(
  n: number, Lval: Float64Array, Lcol: Int32Array, LrowPtr: Int32Array, Ldiag: Int32Array,
): IC0Factor {
  return {
    name: 'incomplete-cholesky-0',
    ok: false,
    shift: Infinity,
    attempts: 0,
    n,
    Lval, Lcol, LrowPtr, Ldiag,
    applyInto: (r: Float64Array, z: Float64Array): void => { z.set(r); },
    apply(r: Float64Array): Float64Array { return new Float64Array(r); },
  };
}
