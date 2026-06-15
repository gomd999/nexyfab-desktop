/**
 * assemblyNewtonSolver — 6-DOF Newton / Levenberg-Marquardt mate solver (#5 inc 3).
 *
 * The default `solveAssembly` (matesSolver) is a Gauss-Seidel relaxation: it
 * satisfies one mate at a time and sweeps. That converges fast for grounded,
 * tree-shaped assemblies but stalls (or crawls) on COUPLED constraints — closed
 * loops, a body pinned by several mates at once, near-degenerate configurations
 * — because fixing mate A re-breaks mate B every sweep.
 *
 * This solver treats the whole assembly as one nonlinear least-squares problem
 *   minimise ‖r(q)‖²   over q ∈ ℝ^(6·freeBodies)
 * and takes Levenberg-Marquardt steps
 *   (JᵀJ + λI) Δq = −Jᵀr
 * adapting λ between Gauss-Newton (λ→0, quadratic convergence near the solution)
 * and gradient-descent (λ→∞, guaranteed descent far from it). The λI term also
 * regularises a RANK-DEFICIENT Jacobian (under-constrained DOF / redundant
 * mates), so degenerate assemblies converge to *a* valid pose instead of
 * producing NaNs from a singular normal-equations matrix.
 *
 * Residual vectorization + DOF parameterization are shared verbatim with the
 * rank analysis (`mateResidual`, `perturb` from assemblyRank) so the solver and
 * the over-constraint diagnostics always agree on the constraint model.
 *
 * Pure + synchronous → unit-testable without a renderer.
 */
import type { AssemblyState, AssemblyBody, Mate } from './matesSolver';
import { mateResidual, perturb, matrixRank } from './assemblyRank';

export interface NewtonSolveOptions {
  /** Max LM iterations (each may try several λ values). Default 60. */
  maxIterations?: number;
  /** Convergence threshold on ‖r‖. Default 1e-6. */
  tolerance?: number;
  /** Initial LM damping. Default 1e-3. */
  lambda0?: number;
  /** Finite-difference step for the numerical Jacobian. Default 1e-6. */
  eps?: number;
}

export interface NewtonSolveResult {
  state: AssemblyState;
  converged: boolean;
  iterations: number;
  /** Final ‖r‖. */
  residualNorm: number;
  /** True when the Jacobian was rank-deficient (assembly under-constrained or
   *  has redundant mates) — solved via LM regularization rather than failing. */
  rankDeficient: boolean;
}

function l2(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

/** Concatenated residual over every enabled, modellable mate. */
function fullResidual(bodies: AssemblyBody[], mates: Mate[]): number[] {
  const r: number[] = [];
  for (const mate of mates) {
    const rr = mateResidual(bodies, mate);
    if (rr) r.push(...rr);
  }
  return r;
}

/** Numerical Jacobian J (m residual rows × n=6·free cols) at the current state. */
function jacobian(
  bodies: AssemblyBody[],
  free: number[],
  mates: Mate[],
  base: number[],
  eps: number,
): number[][] {
  const m = base.length;
  const n = free.length * 6;
  const J: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));
  free.forEach((bodyIdx, fi) => {
    for (let dof = 0; dof < 6; dof++) {
      const col = fi * 6 + dof;
      const perturbed = bodies.slice();
      perturbed[bodyIdx] = perturb(bodies[bodyIdx], dof, eps);
      const r = fullResidual(perturbed, mates);
      for (let row = 0; row < m; row++) J[row][col] = (r[row] - base[row]) / eps;
    }
  });
  return J;
}

/** Solve A x = b (A is n×n, symmetric-PD here) via Gaussian elimination with
 *  partial pivoting + back-substitution. Returns null if singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  // Augmented copy.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array<number>(n);
  for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
  return x;
}

/** LM step: solve (JᵀJ + λI) Δq = −Jᵀr. */
function lmStep(J: number[][], r: number[], lambda: number): number[] | null {
  const m = r.length;
  const n = J[0]?.length ?? 0;
  if (n === 0) return null;
  // Normal equations.
  const JtJ: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const Jtr = new Array<number>(n).fill(0);
  for (let k = 0; k < m; k++) {
    const row = J[k];
    const rk = r[k];
    for (let i = 0; i < n; i++) {
      const jik = row[i];
      if (jik === 0) continue;
      Jtr[i] += jik * rk;
      for (let j = i; j < n; j++) JtJ[i][j] += jik * row[j];
    }
  }
  // Symmetrize + LM damping on the diagonal.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) JtJ[j][i] = JtJ[i][j];
    JtJ[i][i] += lambda;
  }
  const rhs = Jtr.map(v => -v);
  return solveLinear(JtJ, rhs);
}

/** Apply a full Δq to the free bodies (translation additive, rotation composed). */
function applyDelta(bodies: AssemblyBody[], free: number[], dq: number[]): AssemblyBody[] {
  const out = bodies.slice();
  free.forEach((bodyIdx, fi) => {
    let b = out[bodyIdx];
    for (let dof = 0; dof < 6; dof++) {
      const step = dq[fi * 6 + dof];
      if (step !== 0) b = perturb(b, dof, step);
    }
    out[bodyIdx] = b;
  });
  return out;
}

/**
 * Solve the assembly with Levenberg-Marquardt. Returns the updated state plus
 * convergence diagnostics. Bodies with `fixed: true` are held; mates that the
 * residual model doesn't cover are ignored (same set as the rank analysis).
 */
export function solveAssemblyNewton(
  state: AssemblyState,
  options: NewtonSolveOptions = {},
): NewtonSolveResult {
  const maxIterations = options.maxIterations ?? 60;
  const tolerance = options.tolerance ?? 1e-6;
  const eps = options.eps ?? 1e-6;
  let lambda = options.lambda0 ?? 1e-3;

  const free: number[] = [];
  state.bodies.forEach((b, i) => { if (!b.fixed) free.push(i); });
  const mates = state.mates.filter(m => m.enabled);

  let bodies = state.bodies.map(b => ({ ...b, position: b.position.clone(), rotation: b.rotation.clone() }));
  let r = fullResidual(bodies, mates);
  let rNorm = l2(r);

  const n = free.length * 6;
  if (n === 0 || r.length === 0 || rNorm < tolerance) {
    return { state: { ...state, bodies }, converged: rNorm < tolerance, iterations: 0, residualNorm: rNorm, rankDeficient: false };
  }

  let iterations = 0;
  let rankDeficient = false;
  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;
    if (rNorm < tolerance) break;

    const J = jacobian(bodies, free, mates, r, eps);
    // Rank-deficient ⇔ fewer independent constraints than free DOF (under-
    // constrained) or redundant mates. Detected from J directly — LM's λI keeps
    // the normal equations solvable, so a solve failure can't reveal it.
    if (matrixRank(J) < n) rankDeficient = true;

    // Adapt λ until a step decreases ‖r‖ (LM trust-region heuristic).
    let accepted = false;
    for (let tries = 0; tries < 12; tries++) {
      const dq = lmStep(J, r, lambda);
      if (!dq) { rankDeficient = true; lambda = Math.min(lambda * 4, 1e12); continue; }
      const trialBodies = applyDelta(bodies, free, dq);
      const trialR = fullResidual(trialBodies, mates);
      const trialNorm = l2(trialR);
      if (Number.isFinite(trialNorm) && trialNorm < rNorm) {
        bodies = trialBodies;
        r = trialR;
        rNorm = trialNorm;
        lambda = Math.max(lambda / 3, 1e-12);
        accepted = true;
        break;
      }
      lambda = Math.min(lambda * 4, 1e12);
    }
    // A step that never improved means we're at a (possibly under-constrained)
    // stationary point — for a rank-deficient system that's the expected "a
    // valid pose, residual minimized" outcome, not a failure.
    if (!accepted) { rankDeficient = true; break; }
  }

  return {
    state: { ...state, bodies },
    converged: rNorm < tolerance,
    iterations,
    residualNorm: rNorm,
    rankDeficient,
  };
}
