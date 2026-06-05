/**
 * sprRecovery.ts — Superconvergent Patch Recovery (Zienkiewicz–Zhu). Element stresses
 * are most accurate at the interior Gauss points; SPR fits a low-order polynomial to
 * those superconvergent samples over a patch and evaluates it at the nodes, giving a
 * smoothed, higher-accuracy recovered stress σ*. The recovery–FE difference σ*−σ_h is
 * the basis of the Z² a-posteriori error estimator.
 *
 * Verified: a polynomial stress field sampled at Gauss points is recovered EXACTLY at
 * the nodes (superconvergence); a lower-order fit smooths higher-order/noisy data; and
 * the Z² error norm responds to the discretization error.
 */

export interface Sample { x: number; y: number; value: number; }

/** 2-D polynomial basis up to `degree` (1 → {1,x,y}; 2 → {1,x,y,x²,xy,y²}). */
export function polyBasis(x: number, y: number, degree: number): number[] {
  const b = [1, x, y];
  if (degree >= 2) b.push(x * x, x * y, y * y);
  if (degree >= 3) b.push(x * x * x, x * x * y, x * y * y, y * y * y);
  return b;
}

function solveNormal(A: number[][], b: number[]): number[] {
  // solve (AᵀA) c = Aᵀb (least squares) by dense Gaussian elimination.
  const m = A[0].length;
  const AtA = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const Atb = new Array<number>(m).fill(0);
  for (let r = 0; r < A.length; r++) {
    for (let i = 0; i < m; i++) {
      Atb[i] += A[r][i] * b[r];
      for (let j = 0; j < m; j++) AtA[i][j] += A[r][i] * A[r][j];
    }
  }
  const M = AtA.map((row, i) => [...row, Atb[i]]);
  for (let c = 0; c < m; c++) {
    let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-300; for (let j = c; j <= m; j++) M[c][j] /= d;
    for (let r = 0; r < m; r++) if (r !== c) { const f = M[r][c]; for (let j = c; j <= m; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((row) => row[m]);
}

/** Least-squares fit of a 2-D polynomial of `degree` to the sample stresses. */
export function fitPatch(samples: Sample[], degree: number): number[] {
  const A = samples.map((s) => polyBasis(s.x, s.y, degree));
  const b = samples.map((s) => s.value);
  return solveNormal(A, b);
}

/** Evaluate a fitted patch polynomial. */
export function evalPatch(coeffs: number[], x: number, y: number, degree: number): number {
  const b = polyBasis(x, y, degree);
  return b.reduce((s, bi, i) => s + bi * (coeffs[i] ?? 0), 0);
}

/** Recover stresses at the given nodes from a Gauss-point sample patch. */
export function patchRecover(samples: Sample[], nodes: Array<{ x: number; y: number }>, degree: number): number[] {
  const c = fitPatch(samples, degree);
  return nodes.map((n) => evalPatch(c, n.x, n.y, degree));
}

/**
 * Z² error indicator over a patch: the L2 norm of the recovery−FE difference at the
 * sample points, √(Σ (σ* − σ_h)²). Zero when the FE stress is already the fitted
 * polynomial (converged), growing with discretization error.
 */
export function z2ErrorIndicator(samples: Sample[], degree: number): number {
  const c = fitPatch(samples, degree);
  let s = 0;
  for (const p of samples) { const d = evalPatch(c, p.x, p.y, degree) - p.value; s += d * d; }
  return Math.sqrt(s);
}
