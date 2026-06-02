/**
 * lagrangianSolver — Phase 3.3.1 of NexyFab Pro own-CAD (ADR-013).
 *
 * Newton-Lagrange (a.k.a. Newton / Levenberg-Marquardt) solver for assembly
 * mate systems. This is the Phase 3.3 upgrade path from the Gauss-Seidel
 * relaxation in `iterativeSolver.ts`:
 *
 *   - Gauss-Seidel (Phase 2): one mate at a time, analytical correction,
 *     fast per-iteration but slow to converge on long chains and weak on
 *     over-constrained / redundant systems (oscillates).
 *   - Newton-Lagrange (Phase 3): assembles a Jacobian of all residuals
 *     against all 6N rigid-body DoF, solves J^T J dq = -J^T r in one
 *     linear system per Newton step. Quadratic convergence near the
 *     solution + clean over-constrained detection (rank-deficient J^T J).
 *
 * Phase 3.1 scope (this commit):
 *   - NUMERIC Jacobian (forward differences, eps = 1e-6). Cheap to
 *     implement, robust for arbitrary mate kinds — re-uses the existing
 *     `computeResidualVec` per-mate residual without needing analytical
 *     derivatives.
 *   - DENSE matrix (M × 6N) and dense Gaussian elimination on the normal
 *     equations (J^T J + λI). N < 50 → matrix < 300 × 300, well within
 *     "self-implemented Gauss" range.
 *   - Levenberg-Marquardt damping: failed step → λ × 10, success → λ / 10.
 *   - Fallback: singular Jacobian → call back into Gauss-Seidel
 *     `iterativeSolve` so the user always gets *some* answer.
 *
 * Phase 3.2 follow-up (not in this commit):
 *   - ANALYTIC Jacobian per mate kind (3-5× faster — see
 *     `Phase3MatePaper.pdf` for derivations).
 *   - Sparse storage (CSR) + sparse Cholesky.
 *
 * API parity: returns IterativeSolveResult so callers can swap the two
 * solvers without changing downstream code.
 */

import type { AssemblyState, PartInstance, Quat } from './assemblyState';
import type { Mate, MateRef } from './mate';
import type {
  GeometryResolver,
  IterativeSolveResult,
  MateResidual,
  ResolvedGeometry,
} from './iterativeSolver';
import { iterativeSolve } from './iterativeSolver';
import {
  distanceAxisToAxis,
  quatMul,
  quatNormalize,
  type AxisInWorld,
  type PlaneInWorld,
} from './mateSolver';
import {
  type Vec3,
  add,
  dot,
  sub,
  lengthOf,
} from '@/lib/sketch/sketchPlane';

// ─── public API ──────────────────────────────────────────────────────────

export interface LagrangianSolverOptions {
  /** Max Newton iterations. Default 50. */
  maxIterations?: number;
  /** Stop when max-residual < this. Default 1e-6. */
  tolerance?: number;
  /**
   * Damping multiplier in (0, 1]. 1.0 = plain Newton step; 0.5 = take
   * half the proposed step each iteration (heavy LM damping — slower
   * but stabler when the initial guess is far). The internal LM lambda
   * also adapts, so this just biases the global step length.
   * Default 1.0.
   */
  dampingFactor?: number;
}

// ─── internals ───────────────────────────────────────────────────────────

/**
 * Numeric differentiation step size for the Jacobian.
 *
 * Choice rationale: 1e-6 sits in the sweet spot for double precision —
 *   - too small (1e-9) → roundoff in (r(q+eps) - r(q)) dominates
 *   - too large (1e-3) → quadratic truncation in the forward-difference
 *     becomes visible on stiff residuals (concentric axis with parts
 *     ~ 1000 mm apart).
 * 1e-6 keeps both errors below ~ 1e-10 on the test fixtures.
 */
const JACOBIAN_EPS = 1e-6;

/**
 * Threshold below which a diagonal pivot is treated as zero during
 * Gaussian elimination — used to flag singular systems. 1e-10 ≈ the
 * roundoff floor of the numeric Jacobian times the DoF count.
 */
const SINGULAR_THRESHOLD = 1e-10;

/** Levenberg-Marquardt initial λ. */
const INITIAL_LAMBDA = 1e-3;
/** LM max λ — beyond this we declare divergence and fall back. */
const MAX_LAMBDA = 1e10;

/** Per-mate residual is a SCALAR (matches iterativeSolver convention).
 *  This keeps the Jacobian assembly simple — one row per mate. */
function computeResidualForMate(
  mate: Mate,
  a: PartInstance,
  b: PartInstance,
  resolve: GeometryResolver,
): number {
  const ag = resolve(mate.a, a);
  const bg = resolve(mate.b, b);
  if (!ag || !bg) return 0;
  if (mate.kind === 'concentric' && ag.kind === 'axis' && bg.kind === 'axis') {
    return distanceAxisToAxis(ag.world, bg.world);
  }
  if (mate.kind === 'coincident' && ag.kind === 'point' && bg.kind === 'point') {
    return lengthOf(sub(ag.world, bg.world));
  }
  if (mate.kind === 'coincident' && ag.kind === 'plane' && bg.kind === 'plane') {
    return Math.abs(dot(sub(bg.world.origin, ag.world.origin), ag.world.normal));
  }
  if (mate.kind === 'distance' && ag.kind === 'point' && bg.kind === 'point') {
    return Math.abs(lengthOf(sub(bg.world, ag.world)) - mate.value);
  }
  if (mate.kind === 'distance' && ag.kind === 'plane' && bg.kind === 'plane') {
    const signed = dot(sub(bg.world.origin, ag.world.origin), ag.world.normal);
    return Math.abs(Math.abs(signed) - mate.value);
  }
  if (mate.kind === 'parallel') {
    const aDir = directionOf(ag);
    const bDir = directionOf(bg);
    if (!aDir || !bDir) return 0;
    return Math.hypot(
      aDir.y * bDir.z - aDir.z * bDir.y,
      aDir.z * bDir.x - aDir.x * bDir.z,
      aDir.x * bDir.y - aDir.y * bDir.x,
    );
  }
  if (mate.kind === 'perpendicular') {
    const aDir = directionOf(ag);
    const bDir = directionOf(bg);
    if (!aDir || !bDir) return 0;
    return Math.abs(aDir.x * bDir.x + aDir.y * bDir.y + aDir.z * bDir.z);
  }
  if (mate.kind === 'angle') {
    const aDir = directionOf(ag);
    const bDir = directionOf(bg);
    if (!aDir || !bDir) return 0;
    const cos = Math.max(-1, Math.min(1, aDir.x * bDir.x + aDir.y * bDir.y + aDir.z * bDir.z));
    const angleRad = Math.acos(cos);
    const targetRad = (mate.value * Math.PI) / 180;
    return Math.abs(angleRad - targetRad);
  }
  if (mate.kind === 'hinge' && ag.kind === 'axis' && bg.kind === 'axis') {
    const alignErr = distanceAxisToAxis(ag.world, bg.world);
    if (mate.limit === undefined) return alignErr;
    // Phase 1 unsigned proxy for the swing magnitude, identical to
    // iterativeSolver so residuals are directly comparable.
    const qa = a.orientation;
    const qb = b.orientation;
    const dotQ = qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w;
    const cosHalf = Math.min(1, Math.abs(dotQ));
    const approxAngleRad = 2 * Math.acos(cosHalf);
    const approxAngleDeg = (approxAngleRad * 180) / Math.PI;
    const minDeg = mate.limit.minAngleDeg;
    const maxDeg = mate.limit.maxAngleDeg;
    let limitPenaltyDeg = 0;
    if (approxAngleDeg > maxDeg) limitPenaltyDeg = approxAngleDeg - maxDeg;
    else if (-approxAngleDeg < minDeg) limitPenaltyDeg = minDeg - -approxAngleDeg;
    return alignErr + (limitPenaltyDeg * Math.PI) / 180;
  }
  if (mate.kind === 'slot' && ag.kind === 'axis' && bg.kind === 'axis') {
    const perpDist = distanceAxisToAxis(ag.world, bg.world);
    const cos = ag.world.direction.x * bg.world.direction.x +
      ag.world.direction.y * bg.world.direction.y +
      ag.world.direction.z * bg.world.direction.z;
    return perpDist + Math.abs(cos);
  }
  if (mate.kind === 'gear' && ag.kind === 'axis' && bg.kind === 'axis') {
    const cx = ag.world.direction.y * bg.world.direction.z -
      ag.world.direction.z * bg.world.direction.y;
    const cy = ag.world.direction.z * bg.world.direction.x -
      ag.world.direction.x * bg.world.direction.z;
    const cz = ag.world.direction.x * bg.world.direction.y -
      ag.world.direction.y * bg.world.direction.x;
    const crossLen = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (crossLen < 1e-9) return 0;
    const dx = bg.world.origin.x - ag.world.origin.x;
    const dy = bg.world.origin.y - ag.world.origin.y;
    const dz = bg.world.origin.z - ag.world.origin.z;
    return Math.abs(dx * cx + dy * cy + dz * cz) / crossLen;
  }
  if (mate.kind === 'rack_pinion' && ag.kind === 'axis' && bg.kind === 'axis') {
    const perpDist = distanceAxisToAxis(ag.world, bg.world);
    const cos = ag.world.direction.x * bg.world.direction.x +
      ag.world.direction.y * bg.world.direction.y +
      ag.world.direction.z * bg.world.direction.z;
    return Math.abs(perpDist - mate.pinionRadius) + Math.abs(cos);
  }
  return 0;
}

function directionOf(g: ResolvedGeometry): Vec3 | null {
  if (g.kind === 'axis') return g.world.direction;
  if (g.kind === 'plane') return g.world.normal;
  return null;
}

function isAnalyticallySupported(mate: Mate): boolean {
  if (mate.kind === 'concentric') return true;
  if (mate.kind === 'coincident') {
    return (
      (mate.a.refKind === 'point' && mate.b.refKind === 'point') ||
      (mate.a.refKind === 'plane' && mate.b.refKind === 'plane')
    );
  }
  if (mate.kind === 'parallel' || mate.kind === 'perpendicular') {
    const norms: ReadonlyArray<string> = ['plane', 'face', 'axis'];
    return norms.includes(mate.a.refKind) && norms.includes(mate.b.refKind);
  }
  if (mate.kind === 'distance') {
    return (
      (mate.a.refKind === 'point' && mate.b.refKind === 'point') ||
      (mate.a.refKind === 'plane' && mate.b.refKind === 'plane')
    );
  }
  if (mate.kind === 'angle') {
    return ['plane', 'face', 'axis'].includes(mate.a.refKind) &&
      ['plane', 'face', 'axis'].includes(mate.b.refKind);
  }
  if (mate.kind === 'hinge') return true;
  if (mate.kind === 'slot') return true;
  if (mate.kind === 'gear') return true;
  if (mate.kind === 'rack_pinion') return true;
  return false;
}

// ─── DoF packing: 6 reals per free part ──────────────────────────────────
// (tx, ty, tz, rx, ry, rz) — translation in mm + small-angle rotation
// in rad. Rotation is composed onto the existing quaternion as a delta
// quaternion: dq = (1, rx/2, ry/2, rz/2) (linearized). This is the
// standard Lie-algebra parametrization used by ROS / SLAM solvers and
// avoids the gimbal-lock pitfalls of Euler angles.

function applyDelta(part: PartInstance, delta: Float64Array, base: number): PartInstance {
  const dt: Vec3 = { x: delta[base + 0]!, y: delta[base + 1]!, z: delta[base + 2]! };
  const rx = delta[base + 3]!;
  const ry = delta[base + 4]!;
  const rz = delta[base + 5]!;
  const angle = Math.sqrt(rx * rx + ry * ry + rz * rz);
  let dq: Quat;
  if (angle < 1e-12) {
    dq = { x: 0, y: 0, z: 0, w: 1 };
  } else {
    const h = angle / 2;
    const s = Math.sin(h) / angle;
    dq = { x: rx * s, y: ry * s, z: rz * s, w: Math.cos(h) };
  }
  const newOri = quatNormalize(quatMul(dq, part.orientation));
  return { ...part, position: add(part.position, dt), orientation: newOri };
}

// ─── core ────────────────────────────────────────────────────────────────

export function lagrangianSolve(
  state: AssemblyState,
  resolve: GeometryResolver,
  opts: LagrangianSolverOptions = {},
): IterativeSolveResult {
  const maxIter = opts.maxIterations ?? 50;
  const tol = opts.tolerance ?? 1e-6;
  const damp = opts.dampingFactor ?? 1.0;

  // Snapshot parts (caller's array is readonly).
  let parts: PartInstance[] = state.parts.map((p) => ({ ...p }));
  const mates = state.mates.filter((m) => !m.suppressed);

  // ── DoF map: index of each FREE part in the (6N) delta vector ────────
  const freeIdx = new Map<string, number>();
  let dofCount = 0;
  for (const p of parts) {
    if (!p.fixed) {
      freeIdx.set(p.id, dofCount);
      dofCount += 6;
    }
  }

  // Trivially everything is fixed → no work.
  if (dofCount === 0) {
    return {
      state: { parts, mates: state.mates },
      success: true,
      iterations: 0,
      finalMaxResidual: 0,
      residuals: buildResiduals(state, parts, resolve),
    };
  }

  const M = mates.length;
  if (M === 0) {
    return {
      state: { parts, mates: state.mates },
      success: true,
      iterations: 0,
      finalMaxResidual: 0,
      residuals: buildResiduals(state, parts, resolve),
    };
  }

  // ── Levenberg-Marquardt main loop ────────────────────────────────────
  let lambda = INITIAL_LAMBDA;
  let iter = 0;
  let maxResidual = Infinity;

  // Helper: evaluate residual vector + max-residual scalar.
  const evalR = (testParts: PartInstance[]): { vec: Float64Array; max: number } => {
    const vec = new Float64Array(M);
    let mx = 0;
    const byId = new Map(testParts.map((p) => [p.id, p]));
    for (let i = 0; i < M; i++) {
      const mate = mates[i]!;
      const a = byId.get(mate.a.partId);
      const b = byId.get(mate.b.partId);
      if (!a || !b) continue;
      const r = computeResidualForMate(mate, a, b, resolve);
      vec[i] = r;
      if (r > mx) mx = r;
    }
    return { vec, max: mx };
  };

  let { vec: r, max: curMax } = evalR(parts);
  maxResidual = curMax;

  if (maxResidual < tol) {
    return {
      state: { parts, mates: state.mates },
      success: true,
      iterations: 0,
      finalMaxResidual: maxResidual,
      residuals: buildResiduals(state, parts, resolve),
    };
  }

  for (; iter < maxIter; iter++) {
    // ── Build numeric Jacobian J (M × 6N) by forward differences ──────
    const J = new Float64Array(M * dofCount);
    for (let d = 0; d < dofCount; d++) {
      // Perturb the d-th DoF, recompute the full residual vector.
      const perturbed = parts.map((p) => {
        const idx = freeIdx.get(p.id);
        if (idx === undefined) return p;
        const localDof = d - idx;
        if (localDof < 0 || localDof >= 6) return p;
        const delta = new Float64Array(6);
        delta[localDof] = JACOBIAN_EPS;
        return applyDelta(p, delta, 0);
      });
      const rPert = evalR(perturbed).vec;
      // J[:, d] = (r(q+eps) - r(q)) / eps
      for (let i = 0; i < M; i++) {
        J[i * dofCount + d] = (rPert[i]! - r[i]!) / JACOBIAN_EPS;
      }
    }

    // ── Normal equations: A = J^T J + λI ; rhs = -J^T r ───────────────
    const A = new Float64Array(dofCount * dofCount);
    const rhs = new Float64Array(dofCount);
    for (let c = 0; c < dofCount; c++) {
      for (let cc = 0; cc < dofCount; cc++) {
        let sum = 0;
        for (let i = 0; i < M; i++) {
          sum += J[i * dofCount + c]! * J[i * dofCount + cc]!;
        }
        A[c * dofCount + cc] = sum;
      }
      // LM damping on the diagonal.
      A[c * dofCount + c] = A[c * dofCount + c]! + lambda;
      let rs = 0;
      for (let i = 0; i < M; i++) rs += J[i * dofCount + c]! * r[i]!;
      rhs[c] = -rs;
    }

    // ── Solve A · dq = rhs via Gaussian elimination with partial pivot ─
    const dq = gaussSolve(A, rhs, dofCount);
    if (!dq) {
      // Singular: bump λ heavily and retry; if already saturated, bail
      // out into Gauss-Seidel as the documented fallback path.
      if (lambda >= MAX_LAMBDA) {
        const fallback = iterativeSolve(state, resolve, {
          maxIterations: 100,
          tolerance: tol,
        });
        return {
          ...fallback,
          iterations: iter + fallback.iterations,
        };
      }
      lambda *= 10;
      continue;
    }

    // ── Apply global damping factor to the proposed step ──────────────
    if (damp !== 1.0) {
      for (let i = 0; i < dq.length; i++) dq[i] = dq[i]! * damp;
    }

    // ── Trial step: apply dq, re-evaluate residuals ───────────────────
    const trialParts = parts.map((p) => {
      const idx = freeIdx.get(p.id);
      if (idx === undefined) return p;
      return applyDelta(p, dq, idx);
    });
    const trial = evalR(trialParts);

    if (trial.max < curMax) {
      // Accepted: keep step, relax λ.
      parts = trialParts;
      r = trial.vec;
      curMax = trial.max;
      maxResidual = curMax;
      lambda = Math.max(lambda / 10, 1e-12);
      if (curMax < tol) {
        iter += 1;
        break;
      }
    } else {
      // Rejected: increase λ (more gradient-descent-like step next time).
      if (lambda >= MAX_LAMBDA) {
        const fallback = iterativeSolve(state, resolve, {
          maxIterations: 100,
          tolerance: tol,
        });
        return {
          ...fallback,
          iterations: iter + fallback.iterations,
        };
      }
      lambda *= 10;
    }
  }

  return {
    state: { parts, mates: state.mates },
    success: maxResidual < tol,
    iterations: iter,
    finalMaxResidual: maxResidual,
    residuals: buildResiduals(state, parts, resolve),
  };
}

// ─── residual reporter (matches iterativeSolver shape) ───────────────────

function buildResiduals(
  state: AssemblyState,
  parts: ReadonlyArray<PartInstance>,
  resolve: GeometryResolver,
): MateResidual[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  return state.mates.map((m) => {
    const a = byId.get(m.a.partId);
    const b = byId.get(m.b.partId);
    if (!a || !b || m.suppressed) {
      return { mateId: m.id, residual: 0, supported: true };
    }
    return {
      mateId: m.id,
      residual: computeResidualForMate(m, a, b, resolve),
      supported: isAnalyticallySupported(m),
    };
  });
}

// ─── Gaussian elimination with partial pivoting (in-place) ───────────────
/**
 * Returns dq such that A · dq = b, or `null` if A is singular (pivot
 * below SINGULAR_THRESHOLD). A is `n×n` row-major in a Float64Array; b
 * is length n. Both arrays are modified in place. The algorithm is
 * vanilla LU with partial-pivoting — adequate for n ≤ ~300, which is
 * well above the Phase 3 spec ceiling of N = 50 free parts (300 DoF).
 */
function gaussSolve(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  // Forward elimination with partial pivoting.
  for (let i = 0; i < n; i++) {
    // Find max pivot in column i.
    let pivotRow = i;
    let pivotVal = Math.abs(A[i * n + i]!);
    for (let k = i + 1; k < n; k++) {
      const v = Math.abs(A[k * n + i]!);
      if (v > pivotVal) {
        pivotVal = v;
        pivotRow = k;
      }
    }
    if (pivotVal < SINGULAR_THRESHOLD) return null;
    // Swap rows in A and b.
    if (pivotRow !== i) {
      for (let j = 0; j < n; j++) {
        const tmp = A[i * n + j]!;
        A[i * n + j] = A[pivotRow * n + j]!;
        A[pivotRow * n + j] = tmp;
      }
      const tb = b[i]!;
      b[i] = b[pivotRow]!;
      b[pivotRow] = tb;
    }
    // Eliminate below.
    const piv = A[i * n + i]!;
    for (let k = i + 1; k < n; k++) {
      const factor = A[k * n + i]! / piv;
      if (factor === 0) continue;
      for (let j = i; j < n; j++) {
        A[k * n + j] = A[k * n + j]! - factor * A[i * n + j]!;
      }
      b[k] = b[k]! - factor * b[i]!;
    }
  }
  // Back-substitution.
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]!;
    for (let j = i + 1; j < n; j++) s -= A[i * n + j]! * x[j]!;
    const piv = A[i * n + i]!;
    if (Math.abs(piv) < SINGULAR_THRESHOLD) return null;
    x[i] = s / piv;
  }
  return x;
}

// ─── re-exports for type-checking convenience ────────────────────────────

export type { IterativeSolveResult, MateResidual, GeometryResolver, ResolvedGeometry };
export type { AxisInWorld, PlaneInWorld };
export type { MateRef };
