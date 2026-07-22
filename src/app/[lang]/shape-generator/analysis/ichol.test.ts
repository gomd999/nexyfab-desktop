/**
 * ichol.test.ts — the judge for Stage 1 (robust preconditioner).
 *
 * Covers:
 *  1. IC(0) + PCG reproduces a known solution on a small SPD system.
 *  2. block-Jacobi 3x3 apply is numerically correct (vs explicit block inverse).
 *  3. the Manteuffel diagonal-shift fallback triggers on an indefinite input and
 *     still returns a usable (SPD-stable) preconditioner.
 *  4. CONVERGENCE / SOLVABILITY: a high-DOF (~40k) ill-conditioned SPD system on
 *     which Jacobi-PCG does NOT converge within maxIter, but IC(0)-PCG DOES.
 *     Iteration counts for both are printed so the enabler claim is auditable.
 */
import { describe, it, expect } from 'vitest';
import { CSRMatrix, sparsePCG } from './femSolver';
import { blockJacobi3x3, incompleteCholesky0, applyIC0 } from './ichol';

/* ── helpers ─────────────────────────────────────────────────────────────── */

function csrFromDense(A: number[][]): CSRMatrix {
  const n = A.length;
  const entries = new Map<number, Map<number, number>>();
  for (let i = 0; i < n; i++) {
    const row = new Map<number, number>();
    for (let j = 0; j < n; j++) if (A[i][j] !== 0) row.set(j, A[i][j]);
    entries.set(i, row);
  }
  return new CSRMatrix(n, n, entries);
}

function matVec(A: number[][], x: Float64Array): Float64Array {
  const n = A.length;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += A[i][j] * x[j]; y[i] = s; }
  return y;
}

function maxAbsDiff(a: Float64Array, b: Float64Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/**
 * Anisotropic, high-contrast 7-point diffusion operator  -div(c grad u)  with
 * homogeneous Dirichlet boundaries on an N×N×N grid (x-index innermost).
 *
 * Two knobs make it a hard, fine-mesh-like PCG problem while staying SPD:
 *  - contrastExp: nodal conductivity c spans 10^contrastExp over a smooth field
 *    (harmonic-mean edge weights, finite-volume). The coefficient variation
 *    keeps the spectrum DENSE and wide.
 *  - aniso (<1): the transverse y/z edges are weakened, so the operator couples
 *    strongly along x and weakly across — a classic stretched-spectrum case.
 *
 * Scalar Jacobi only rescales the diagonal: it sees neither the coefficient
 * coupling nor the anisotropy, so its CG iteration count blows past a fine-mesh
 * iteration budget. IC(0) in the natural (x-contiguous) ordering factors the
 * strong-direction coupling on K's own pattern and converges an order of
 * magnitude sooner. SPD by construction (positive edge weights + Dirichlet
 * boundary anchoring — no constant null space).
 */
function highContrastLaplacian(N: number, contrastExp: number, aniso = 1): CSRMatrix {
  const idx = (i: number, j: number, k: number): number => i + N * (j + N * k);
  const n = N * N * N;
  // Smoothly-graded conductivity field c ∈ [1, 10^contrastExp]. A SMOOTH (not
  // binary) high-contrast field keeps the spectrum DENSE — no isolated outliers
  // for CG to deflate — so scalar Jacobi's iteration count actually blows up
  // with the contrast, which is the regime that mirrors a fine stress-raiser
  // mesh. IC(0) captures the coupling and stays cheap.
  const c = new Float64Array(n);
  for (let k = 0; k < N; k++)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const s =
          0.5 * (1 + Math.sin(0.7 * i)) *
          0.5 * (1 + Math.cos(0.5 * j)) *
          0.5 * (1 + Math.sin(0.3 * k)); // ∈ [0,1], high-frequency roughness
        c[idx(i, j, k)] = Math.pow(10, contrastExp * s);
      }

  const entries = new Map<number, Map<number, number>>();
  const add = (r: number, col: number, v: number): void => {
    let row = entries.get(r); if (!row) { row = new Map(); entries.set(r, row); }
    row.set(col, (row.get(col) ?? 0) + v);
  };
  const harm = (a: number, b: number): number => (2 * a * b) / (a + b);

  for (let k = 0; k < N; k++)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const p = idx(i, j, k);
        const cp = c[p];
        // In-domain neighbours (each undirected edge handled once, q > p side).
        const nb: Array<[boolean, number]> = [
          [i < N - 1, i < N - 1 ? idx(i + 1, j, k) : -1],
          [j < N - 1, j < N - 1 ? idx(i, j + 1, k) : -1],
          [k < N - 1, k < N - 1 ? idx(i, j, k + 1) : -1],
        ];
        for (let d = 0; d < nb.length; d++) {
          const [inDomain, q] = nb[d];
          if (!inDomain) continue;
          // d===0 is the x-edge (strong direction, factor 1); d===1,2 are the
          // transverse y/z edges, weakened by `aniso` to stretch the spectrum.
          const w = harm(cp, c[q]) * (d === 0 ? 1 : aniso);
          add(p, p, w); add(q, q, w); add(p, q, -w); add(q, p, -w);
        }
        // Dirichlet faces (neighbour outside domain): connection to fixed-0 wall
        // → conductivity added to the diagonal only. This anchors the operator SPD.
        const faces =
          (i === 0 ? 1 : 0) + (i === N - 1 ? 1 : 0) +
          (j === 0 ? 1 : 0) + (j === N - 1 ? 1 : 0) +
          (k === 0 ? 1 : 0) + (k === N - 1 ? 1 : 0);
        if (faces > 0) add(p, p, faces * cp);
      }
  return new CSRMatrix(n, n, entries);
}

/* ── 1. IC(0) + PCG reproduces a known solution ─────────────────────────── */

describe('ichol — IC(0) factorization + PCG', () => {
  it('reproduces a known solution on a small SPD system', () => {
    // A hand-built SPD (diagonally dominant, symmetric) 6x6 matrix.
    const A = [
      [ 4, -1,  0, -1,  0,  0],
      [-1,  4, -1,  0, -1,  0],
      [ 0, -1,  4,  0,  0, -1],
      [-1,  0,  0,  4, -1,  0],
      [ 0, -1,  0, -1,  4, -1],
      [ 0,  0, -1,  0, -1,  4],
    ];
    const K = csrFromDense(A);
    const xStar = Float64Array.from([1, -2, 3, 0.5, -1.5, 2.25]);
    const b = matVec(A, xStar);

    const ic = incompleteCholesky0(K);
    expect(ic.ok).toBe(true);
    expect(ic.shift).toBe(0); // SPD & diagonally dominant → no shift needed

    // IC(0) apply is a valid SPD preconditioner (z = M⁻¹ r finite).
    const z = applyIC0(ic, b);
    expect(z.every((v) => Number.isFinite(v))).toBe(true);

    // Full PCG solve with the IC(0) strategy recovers x*.
    const { x, converged, iterations, preconditioner } = sparsePCG(K, b, 200, 1e-12, 'ic0');
    expect(converged).toBe(true);
    expect(preconditioner).toContain('incomplete-cholesky-0');
    expect(maxAbsDiff(x, xStar)).toBeLessThan(1e-8);
    expect(iterations).toBeLessThanOrEqual(6); // n=6: PCG must finish within n steps
  });

  it('IC(0) forward/back solve inverts L Lᵀ on the stored pattern', () => {
    // For a matrix whose exact Cholesky has zero fill (tridiagonal), IC(0) == exact
    // Cholesky, so M⁻¹ = A⁻¹ and one PCG step is exact.
    const A = [
      [ 2, -1,  0,  0],
      [-1,  2, -1,  0],
      [ 0, -1,  2, -1],
      [ 0,  0, -1,  2],
    ];
    const K = csrFromDense(A);
    const ic = incompleteCholesky0(K);
    expect(ic.ok).toBe(true);
    const r = Float64Array.from([1, 0, 0, 0]);
    const z = applyIC0(ic, r);           // z should equal A⁻¹ r exactly
    const back = matVec(A, z);           // A z should return r
    expect(maxAbsDiff(back, r)).toBeLessThan(1e-10);
  });
});

/* ── 2. block-Jacobi 3x3 correctness ─────────────────────────────────────── */

describe('ichol — block-Jacobi 3x3', () => {
  it('apply equals the explicit nodal 3x3 block inverse times r', () => {
    // Two nodes (6 DOF). Each nodal 3x3 diagonal block is SPD; off-block coupling
    // is present but block-Jacobi must use ONLY the diagonal blocks.
    const A = [
      [ 8,  1,  0,  2,  0,  0],
      [ 1,  6,  1,  0,  1,  0],
      [ 0,  1,  7,  0,  0,  3],
      [ 2,  0,  0,  9,  2,  1],
      [ 0,  1,  0,  2,  5,  1],
      [ 0,  0,  3,  1,  1,  6],
    ];
    const K = csrFromDense(A);
    const pre = blockJacobi3x3(K);
    const r = Float64Array.from([1, 2, 3, 4, 5, 6]);
    const z = pre.apply(r);

    // Reference: invert each 3x3 diagonal block independently.
    const inv3 = (m: number[][]): number[][] => {
      const d =
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
        m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
        m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      return [
        [(m[1][1] * m[2][2] - m[1][2] * m[2][1]) / d, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / d, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / d],
        [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) / d, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / d, (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / d],
        [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) / d, (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / d, (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / d],
      ];
    };
    const B0 = inv3([[8, 1, 0], [1, 6, 1], [0, 1, 7]]);
    const B1 = inv3([[9, 2, 1], [2, 5, 1], [1, 1, 6]]);
    const ref = new Float64Array(6);
    for (let i = 0; i < 3; i++) ref[i] = B0[i][0] * r[0] + B0[i][1] * r[1] + B0[i][2] * r[2];
    for (let i = 0; i < 3; i++) ref[3 + i] = B1[i][0] * r[3] + B1[i][1] * r[4] + B1[i][2] * r[5];

    expect(maxAbsDiff(z, ref)).toBeLessThan(1e-12);
  });

  it('drives PCG to the exact solution on a block-diagonal SPD system', () => {
    // Purely block-diagonal → block-Jacobi is the exact inverse → 1 PCG step.
    const A = [
      [ 8,  1,  0,  0,  0,  0],
      [ 1,  6,  1,  0,  0,  0],
      [ 0,  1,  7,  0,  0,  0],
      [ 0,  0,  0,  9,  2,  1],
      [ 0,  0,  0,  2,  5,  1],
      [ 0,  0,  0,  1,  1,  6],
    ];
    const K = csrFromDense(A);
    const xStar = Float64Array.from([1, 2, 3, 4, 5, 6]);
    const b = matVec(A, xStar);
    const { x, converged, iterations, preconditioner } = sparsePCG(K, b, 50, 1e-12, 'block');
    expect(converged).toBe(true);
    expect(preconditioner).toBe('block-jacobi-3x3');
    expect(iterations).toBeLessThanOrEqual(2);
    expect(maxAbsDiff(x, xStar)).toBeLessThan(1e-9);
  });
});

/* ── 3. Manteuffel diagonal-shift fallback ──────────────────────────────── */

describe('ichol — diagonal-shift (Manteuffel) fallback', () => {
  it('triggers on an indefinite input and returns a usable preconditioner', () => {
    // [[1,2],[2,1]] has eigenvalues 3 and -1 → INDEFINITE. Raw IC(0) hits a
    // negative pivot (1 - 2²/1 = -3). Shifting the diagonal restores SPD-stability.
    const K = csrFromDense([[1, 2], [2, 1]]);
    const ic = incompleteCholesky0(K);
    expect(ic.ok).toBe(true);          // recovered via shift
    expect(ic.attempts).toBeGreaterThan(1);
    expect(ic.shift).toBeGreaterThan(0);
    // The resulting preconditioner is finite and usable.
    const z = applyIC0(ic, Float64Array.from([1, 1]));
    expect(z.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('needs no shift on a clean SPD matrix', () => {
    const ic = incompleteCholesky0(csrFromDense([[4, 1], [1, 3]]));
    expect(ic.ok).toBe(true);
    expect(ic.attempts).toBe(1);
    expect(ic.shift).toBe(0);
  });
});

/* ── 4. Convergence / solvability at high DOF (the headline claim) ───────── */

describe('ichol — high-DOF solvability: Jacobi stalls, IC(0) converges', () => {
  it('IC(0)-PCG converges on a ~40k-DOF ill-conditioned system where Jacobi-PCG does not', () => {
    const N = 34;                       // 34³ = 39,304 DOF (target 30–60k)
    // contrast 1e5 + strong x/transverse anisotropy → Jacobi-PCG needs ~1024
    // iterations, IC(0)-PCG ~51. Measured with a large budget; see console below.
    const K = highContrastLaplacian(N, 5, 0.001);
    const n = K.nRows;
    expect(n).toBe(39304);

    // RHS from a known solution so "converged" means the residual is genuinely small.
    const xStar = new Float64Array(n);
    for (let i = 0; i < n; i++) xStar[i] = Math.sin(0.01 * i) + ((i % 7) - 3) * 0.1;
    const b = K.multiply(xStar);

    const tol = 1e-8;

    // (a) MEASUREMENT run with a generous budget — reveals the TRUE iteration
    //     counts each preconditioner needs to reach `tol`.
    const measureIter = 4000;
    const jacTrue = sparsePCG(K, b, measureIter, tol, 'jacobi');
    const ic0True = sparsePCG(K, b, measureIter, tol, 'ic0');

    // eslint-disable-next-line no-console
    console.log(
      `[Stage1 convergence] N=${N} DOF=${n} tol=${tol}\n` +
      `  true iters to reach tol (budget ${measureIter}):\n` +
      `    Jacobi : converged=${jacTrue.converged} iters=${jacTrue.iterations} pre=${jacTrue.preconditioner}\n` +
      `    IC(0)  : converged=${ic0True.converged} iters=${ic0True.iterations} pre=${ic0True.preconditioner}\n` +
      `  speedup (Jacobi/IC0 iters) = ${(jacTrue.iterations / ic0True.iterations).toFixed(1)}x`,
    );

    // Both eventually converge; IC(0) needs FAR fewer iterations (the enabler).
    expect(ic0True.converged).toBe(true);
    expect(jacTrue.converged).toBe(true);
    expect(ic0True.iterations * 5).toBeLessThan(jacTrue.iterations); // >5x fewer

    // (b) BUDGET run at a fine-mesh iteration cap. Jacobi cannot reach `tol`
    //     inside the budget; IC(0) does, comfortably. THIS is "solvable vs not"
    //     at the resolution a stress-raiser mesh needs.
    const maxIter = 800;
    const jac = sparsePCG(K, b, maxIter, tol, 'jacobi');
    const ic0 = sparsePCG(K, b, maxIter, tol, 'ic0');
    expect(jac.converged).toBe(false);   // ~1024 iters needed > 800 budget
    expect(ic0.converged).toBe(true);    // ~51 iters, huge headroom
    expect(ic0.iterations).toBeLessThan(maxIter);
  }, 120_000);
});
