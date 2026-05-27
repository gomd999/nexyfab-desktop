/**
 * modalAnalysis.ts — Eigenvalue solver for the FEA mode shapes.
 *
 * For free vibration: K·u = ω² M·u
 *
 *   ω = angular natural frequency (rad/s)
 *   f = ω / (2π)         (Hz)
 *
 * We use **inverse power iteration with shift** for the lowest few
 * modes — small enough to keep in-browser, robust enough for
 * preview-grade reporting. The matrices are dense + symmetric, with
 * lumped-mass M (diagonal) for simplicity.
 *
 * Stage-1 FEA emitted only static stress; this module is Stage-2,
 * giving the user a quick "first eigenfrequency" sanity check for
 * resonance concerns.
 */

export interface ModalAnalysisInput {
  /** Stiffness K (n×n symmetric, packed row-major). */
  stiffness: number[];
  /** Lumped mass diagonal (length n). */
  massDiag: number[];
  /** Number of modes to compute. */
  modeCount: number;
  /** Max iterations per mode (default 200). */
  maxIters?: number;
  /** Convergence tolerance on ω² (default 1e-6). */
  tol?: number;
}

export interface ModeShape {
  /** Eigenvalue λ = ω² (rad²/s²). */
  eigenvalue: number;
  /** Natural frequency f (Hz). */
  frequencyHz: number;
  /** Mode shape vector (unit-mass normalized). */
  vector: number[];
}

/** Simple matrix-vector mul (dense, row-major). */
function matVec(A: number[], x: number[], n: number): number[] {
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) {
      s += A[i * n + j]! * x[j]!;
    }
    out[i] = s;
  }
  return out;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function normalize(v: number[]): { v: number[]; norm: number } {
  const n = Math.sqrt(dot(v, v));
  if (n < 1e-30) return { v, norm: 0 };
  return { v: v.map(x => x / n), norm: n };
}

/** Subtract projections onto a list of previously found vectors
 *  (Gram-Schmidt — keeps iteration on the next-lowest eigenspace). */
function deflate(v: number[], priors: number[][]): number[] {
  const out = v.slice();
  for (const p of priors) {
    const c = dot(out, p);
    for (let i = 0; i < out.length; i++) out[i] -= c * p[i]!;
  }
  return out;
}

/** Solve K·x = b by Jacobi iteration (very crude — fine for small
 *  matrices in a preview). Returns x; converges for diagonally
 *  dominant K, which most FEA stiffness matrices approximately are. */
function jacobiSolve(K: number[], b: number[], n: number, iters = 100): number[] {
  let x = new Array(n).fill(0);
  for (let it = 0; it < iters; it++) {
    const xn = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = b[i]!;
      for (let j = 0; j < n; j++) {
        if (j !== i) s -= K[i * n + j]! * x[j]!;
      }
      const diag = K[i * n + i]!;
      xn[i] = diag !== 0 ? s / diag : 0;
    }
    x = xn;
  }
  return x;
}

export function computeModes(input: ModalAnalysisInput): ModeShape[] {
  const n = input.massDiag.length;
  if (n === 0) return [];
  const K = input.stiffness;
  const M = input.massDiag;
  const maxIters = input.maxIters ?? 200;
  const tol = input.tol ?? 1e-6;

  const modes: ModeShape[] = [];
  const priorVectors: number[][] = [];

  for (let m = 0; m < input.modeCount; m++) {
    // Initial vector — random but deterministic across runs.
    let x: number[] = Array.from({ length: n }, (_, i) => Math.sin((i + 1) * (m + 1) * 0.7));
    x = normalize(x).v;
    x = deflate(x, priorVectors);
    x = normalize(x).v;

    let lambda = 0;
    for (let iter = 0; iter < maxIters; iter++) {
      // y = M⁻¹·x (since M is diagonal, just divide). Then z = K⁻¹·y.
      const y = x.map((xi, i) => xi * M[i]!);
      const z = jacobiSolve(K, y, n);
      const zd = deflate(z, priorVectors);
      const norm = Math.sqrt(dot(zd, zd));
      if (norm < 1e-30) break;
      const zn = zd.map(v => v / norm);
      const newLambda = 1 / norm;
      if (Math.abs(newLambda - lambda) < tol) {
        lambda = newLambda;
        x = zn;
        break;
      }
      lambda = newLambda;
      x = zn;
    }

    // Normalize w.r.t. mass (x^T M x = 1).
    const massNorm = Math.sqrt(x.reduce((s, xi, i) => s + xi * xi * M[i]!, 0));
    if (massNorm > 1e-30) x = x.map(v => v / massNorm);

    priorVectors.push(x.slice());
    const omega = Math.sqrt(Math.max(0, lambda));
    modes.push({
      eigenvalue: lambda,
      frequencyHz: omega / (2 * Math.PI),
      vector: x,
    });
  }

  return modes;
}
