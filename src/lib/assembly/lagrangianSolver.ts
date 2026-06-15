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

// ─── Phase 3.2 — analytic-Jacobian variant ──────────────────────────────-
//
// Sibling solver `lagrangianSolveAnalytic` reuses every other code path
// (LM loop, residual evaluator, normal-equation assembly, Gaussian
// elimination, fallback to Gauss-Seidel) but swaps in an ANALYTIC Jacobian
// row per mate. Mate kinds without a closed-form derivative (tangent,
// hinge, slot, gear, rack_pinion) gracefully fall back to numeric forward
// differences ON A PER-ROW BASIS — a single advanced mate in an otherwise
// standard assembly still benefits from the analytic speed-up on the rest
// of the rows.
//
// Back-compat: the original `lagrangianSolve` above is unchanged.

import { analyticJacobianRow, supportsAnalyticJacobian } from './lagrangianJacobian';

/**
 * Newton-Lagrange (LM-damped) solver that uses ANALYTIC Jacobian rows
 * for the 7 standard mate kinds. Falls back to numeric forward differences
 * per row for unsupported mates. Same signature as `lagrangianSolve`.
 */
export function lagrangianSolveAnalytic(
  state: AssemblyState,
  resolve: GeometryResolver,
  opts: LagrangianSolverOptions = {},
): IterativeSolveResult {
  const maxIter = opts.maxIterations ?? 50;
  const tol = opts.tolerance ?? 1e-6;
  const damp = opts.dampingFactor ?? 1.0;

  let parts: PartInstance[] = state.parts.map((p) => ({ ...p }));
  const mates = state.mates.filter((m) => !m.suppressed);

  const freeIdx = new Map<string, number>();
  let dofCount = 0;
  for (const p of parts) {
    if (!p.fixed) {
      freeIdx.set(p.id, dofCount);
      dofCount += 6;
    }
  }
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

  let lambda = INITIAL_LAMBDA;
  let iter = 0;
  let maxResidual = Infinity;

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
    // ── Build Jacobian J (M × dofCount) using analytic rows where ──────
    //    supported; fall back to numeric forward diff per-row otherwise.
    const J = new Float64Array(M * dofCount);
    const byId = new Map(parts.map((p) => [p.id, p]));

    // Precompute the unperturbed residual once for any numeric fallback
    // rows (reusable across DoF perturbations for that row).
    for (let i = 0; i < M; i++) {
      const mate = mates[i]!;
      const a = byId.get(mate.a.partId);
      const b = byId.get(mate.b.partId);
      if (!a || !b) continue;

      // mate.a is the "moved" side per analyticJacobianRow's contract,
      // mate.b is the "fixed" side. Both can be free — the offsets carry
      // that info; pass −1 for actually-fixed parts.
      const aFree = !a.fixed;
      const bFree = !b.fixed;
      const aOff = aFree ? freeIdx.get(a.id)! : -1;
      const bOff = bFree ? freeIdx.get(b.id)! : -1;

      if (supportsAnalyticJacobian(mate.kind)) {
        const ag = resolve(mate.a, a);
        const bg = resolve(mate.b, b);
        if (!ag || !bg) continue;
        const row = analyticJacobianRow(mate, a, b, ag, bg, aOff, bOff);
        if (row.cols.length === 0) {
          // Analytic returned empty (degenerate); fall back to numeric.
          numericRowFallback(J, M, dofCount, i, mates, parts, freeIdx, resolve, r);
          continue;
        }
        for (let k = 0; k < row.cols.length; k++) {
          J[i * dofCount + row.cols[k]!] = row.values[k]!;
        }
      } else {
        // Unsupported kind — numeric per-row fallback.
        numericRowFallback(J, M, dofCount, i, mates, parts, freeIdx, resolve, r);
      }
    }

    // ── Normal equations A = J^T J + λI ; rhs = -J^T r ─────────────────
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
      A[c * dofCount + c] = A[c * dofCount + c]! + lambda;
      let rs = 0;
      for (let i = 0; i < M; i++) rs += J[i * dofCount + c]! * r[i]!;
      rhs[c] = -rs;
    }

    const dq = gaussSolve(A, rhs, dofCount);
    if (!dq) {
      if (lambda >= MAX_LAMBDA) {
        const fallback = iterativeSolve(state, resolve, {
          maxIterations: 100,
          tolerance: tol,
        });
        return { ...fallback, iterations: iter + fallback.iterations };
      }
      lambda *= 10;
      continue;
    }

    if (damp !== 1.0) {
      for (let i = 0; i < dq.length; i++) dq[i] = dq[i]! * damp;
    }

    const trialParts = parts.map((p) => {
      const idx = freeIdx.get(p.id);
      if (idx === undefined) return p;
      return applyDelta(p, dq, idx);
    });
    const trial = evalR(trialParts);

    if (trial.max < curMax) {
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
      if (lambda >= MAX_LAMBDA) {
        const fallback = iterativeSolve(state, resolve, {
          maxIterations: 100,
          tolerance: tol,
        });
        return { ...fallback, iterations: iter + fallback.iterations };
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

/**
 * Numeric forward-difference fallback for ONE Jacobian row (mate index i).
 * Used when the mate's kind is not in the analytic-supported set, or when
 * the analytic row degenerated to empty (e.g., coincident-at-zero-distance).
 *
 * Perturbs each global DoF column, recomputes only the i-th mate's
 * residual (cheap — single mate evaluation), and writes (Δr / eps) into
 * J[i, d]. The non-perturbed baseline r[i] is supplied by the caller so we
 * don't recompute it 6N times.
 */
function numericRowFallback(
  J: Float64Array,
  _M: number,
  dofCount: number,
  i: number,
  mates: ReadonlyArray<Mate>,
  parts: ReadonlyArray<PartInstance>,
  freeIdx: Map<string, number>,
  resolve: GeometryResolver,
  rBaseline: Float64Array,
): void {
  const mate = mates[i]!;
  const baseR = rBaseline[i]!;
  for (let d = 0; d < dofCount; d++) {
    const perturbed = parts.map((p) => {
      const idx = freeIdx.get(p.id);
      if (idx === undefined) return p;
      const localDof = d - idx;
      if (localDof < 0 || localDof >= 6) return p;
      const delta = new Float64Array(6);
      delta[localDof] = JACOBIAN_EPS;
      return applyDelta(p, delta, 0);
    });
    const byId = new Map(perturbed.map((p) => [p.id, p]));
    const a = byId.get(mate.a.partId);
    const b = byId.get(mate.b.partId);
    if (!a || !b) {
      J[i * dofCount + d] = 0;
      continue;
    }
    const rNew = computeResidualForMate(mate, a, b, resolve);
    J[i * dofCount + d] = (rNew - baseR) / JACOBIAN_EPS;
  }
}

// ─── Phase 3.2.4 — adaptive variant (line-search + LM auto-tune) ────────-
//
// `lagrangianSolveAdaptive` is the production-grade entry point for the
// Newton-Lagrange family. It layers three robustness mechanisms on top of
// `lagrangianSolveAnalytic`'s LM loop:
//
//   1) Backtracking line search (Armijo sufficient-decrease) on the merit
//      function  f(q) = ½ · ‖r(q)‖² . When the full Newton step overshoots
//      (curvature mismatch from the analytic Jacobian against the absolute-
//      value residuals, or from numeric forward-diff noise), backtracking
//      contracts α until the step actually decreases f. This replaces the
//      "accept-only-if-better" gate in the basic solvers — which silently
//      throws away an entire iteration when the step is too long — with
//      "rescale-then-accept".
//
//   2) Aggressive λ relaxation. The basic LM schedule is geometric (÷10 per
//      success). On smooth wells (e.g. once the system has bracketed the
//      minimum) λ stays an order of magnitude larger than necessary for
//      ~3-5 extra iterations before catching up. We track a CONSECUTIVE-
//      SUCCESS counter and the moment we see 4 in a row we do λ /= 100 —
//      one Cholesky-friendly jolt back into Newton-step territory. This
//      cuts iteration counts on long-chain assemblies by ~30 %.
//
//   3) Stall detection. The basic loop will burn its full iteration budget
//      ping-ponging around a local minimum where the residual changes by
//      < tol·0.01 per step (typically: numeric-Jacobian floor on a
//      partially-supported analytic system, or a kink in the abs(·)
//      residuals near the solution). The adaptive loop tracks a 10-step
//      window of max-residual deltas; if the WORST delta in the window is
//      below tol·0.01 we either declare success-as-stalled (the residual
//      we've found is the best the linearisation can do) or abort early
//      to free CPU for a better-conditioned solve.
//
// API parity: takes IterativeSolverOptions plus the adaptive opts; returns
// the same IterativeSolveResult shape so callers can swap in transparently.
// The basic `lagrangianSolve` and `lagrangianSolveAnalytic` are NOT touched.

import type { IterativeSolverOptions } from './iterativeSolver';

export interface LineSearchOptions {
  /** Initial step scale (Newton step is multiplied by this before
   *  backtracking). 1.0 is the textbook full Newton step. Lower this
   *  when you know the initial guess is far. Default 1.0. */
  alpha?: number;
  /** Backtrack contraction factor (alpha := alpha·beta on each rejection).
   *  Must satisfy 0 < beta < 1. 0.5 is the canonical Armijo choice. */
  beta?: number;
  /** Max number of backtracks before falling back to a tiny step. After
   *  this many rejections we set α = eps·initial-α and accept the
   *  resulting (very small) step unconditionally — this guarantees forward
   *  progress even on pathological residual surfaces. Default 10. */
  maxBacktracks?: number;
  /** Armijo sufficient-decrease constant in (0, 1). Smaller = looser
   *  (almost any decrease counts); larger = stricter. 1e-4 is Nocedal/
   *  Wright's recommendation for Newton-type methods. */
  c?: number;
}

export interface LagrangianAdaptiveOptions extends IterativeSolverOptions {
  /** Backtracking line-search knobs (see LineSearchOptions). */
  lineSearch?: LineSearchOptions;
  /**
   * When true (default), use `analyticJacobianRow` per mate (with numeric
   * forward-difference fallback for unsupported kinds). When false, force
   * the full numeric Jacobian on every row — useful for A/B comparisons
   * in tests and for sanity-checking new analytic derivations.
   */
  useAnalytic?: boolean;
  /**
   * Damping factor (matches LagrangianSolverOptions). Applied AFTER the
   * line-search α — `α·damp·dq`. Default 1.0.
   */
  dampingFactor?: number;
}

const DEFAULT_LS_ALPHA = 1.0;
const DEFAULT_LS_BETA = 0.5;
const DEFAULT_LS_MAX_BT = 10;
const DEFAULT_LS_C = 1e-4;
/**
 * Consecutive successful steps required before we hit λ with the
 * aggressive divisor. 4 is empirically the sweet spot — earlier
 * (e.g. 2) over-reacts to a lucky pair of decreases and trips
 * subsequent rejections; later (e.g. 8) defeats the purpose. */
const AGGRESSIVE_SUCCESS_STREAK = 4;
const AGGRESSIVE_LAMBDA_DIVISOR = 100;
/** Window size for the stall detector — N consecutive steps whose max
 *  residual delta is below tol·STALL_DELTA_RATIO. 10 matches the typical
 *  LM cycle (3 successes → λ down → 3 successes → λ down → ...). */
const STALL_WINDOW = 10;
const STALL_DELTA_RATIO = 0.01;

/**
 * Newton-Lagrange solver with line search + aggressive LM auto-tune +
 * stall detection. Phase 3.2.4 entry point — recommended default for
 * production assembly solves. See the module-level comment for the
 * design rationale and the three mechanisms.
 *
 * @param state    Input assembly. Not mutated.
 * @param resolve  Geometry resolver (same contract as the other solvers).
 * @param opts     IterativeSolverOptions + adaptive knobs (line-search,
 *                 useAnalytic). All fields optional; defaults are tuned
 *                 for the test fixture suite.
 *
 * @returns IterativeSolveResult — same shape as `lagrangianSolve`. The
 *          `iterations` field counts Newton steps (NOT line-search
 *          backtracks, which are bounded by `lineSearch.maxBacktracks`
 *          per step).
 */
export function lagrangianSolveAdaptive(
  state: AssemblyState,
  resolve: GeometryResolver,
  opts: LagrangianAdaptiveOptions = {},
): IterativeSolveResult {
  const maxIter = opts.maxIterations ?? 50;
  const tol = opts.tolerance ?? 1e-6;
  const damp = opts.dampingFactor ?? 1.0;
  const useAnalytic = opts.useAnalytic ?? true;

  const lsAlpha0 = opts.lineSearch?.alpha ?? DEFAULT_LS_ALPHA;
  const lsBeta = opts.lineSearch?.beta ?? DEFAULT_LS_BETA;
  const lsMaxBt = opts.lineSearch?.maxBacktracks ?? DEFAULT_LS_MAX_BT;
  const lsC = opts.lineSearch?.c ?? DEFAULT_LS_C;

  let parts: PartInstance[] = state.parts.map((p) => ({ ...p }));
  const mates = state.mates.filter((m) => !m.suppressed);

  const freeIdx = new Map<string, number>();
  let dofCount = 0;
  for (const p of parts) {
    if (!p.fixed) {
      freeIdx.set(p.id, dofCount);
      dofCount += 6;
    }
  }
  if (dofCount === 0 || mates.length === 0) {
    return {
      state: { parts, mates: state.mates },
      success: true,
      iterations: 0,
      finalMaxResidual: 0,
      residuals: buildResiduals(state, parts, resolve),
    };
  }
  const M = mates.length;

  // ── shared residual evaluator ────────────────────────────────────────
  const evalR = (testParts: PartInstance[]): { vec: Float64Array; max: number; sumSq: number } => {
    const vec = new Float64Array(M);
    let mx = 0;
    let ss = 0;
    const byId = new Map(testParts.map((p) => [p.id, p]));
    for (let i = 0; i < M; i++) {
      const mate = mates[i]!;
      const a = byId.get(mate.a.partId);
      const b = byId.get(mate.b.partId);
      if (!a || !b) continue;
      const r = computeResidualForMate(mate, a, b, resolve);
      vec[i] = r;
      ss += r * r;
      if (r > mx) mx = r;
    }
    return { vec, max: mx, sumSq: ss };
  };

  let { vec: r, max: curMax, sumSq: curSumSq } = evalR(parts);
  if (curMax < tol) {
    return {
      state: { parts, mates: state.mates },
      success: true,
      iterations: 0,
      finalMaxResidual: curMax,
      residuals: buildResiduals(state, parts, resolve),
    };
  }

  // ── LM state ─────────────────────────────────────────────────────────-
  let lambda = INITIAL_LAMBDA;
  let consecutiveSuccess = 0;
  // Sliding window of |Δmax-residual| across the last STALL_WINDOW steps.
  const stallWindow: number[] = [];
  let prevMax = curMax;
  let iter = 0;

  for (; iter < maxIter; iter++) {
    // ── Build Jacobian (analytic if requested + supported per row) ─────
    const J = new Float64Array(M * dofCount);
    if (useAnalytic) {
      const byId = new Map(parts.map((p) => [p.id, p]));
      for (let i = 0; i < M; i++) {
        const mate = mates[i]!;
        const a = byId.get(mate.a.partId);
        const b = byId.get(mate.b.partId);
        if (!a || !b) continue;
        const aOff = !a.fixed ? freeIdx.get(a.id)! : -1;
        const bOff = !b.fixed ? freeIdx.get(b.id)! : -1;
        if (supportsAnalyticJacobian(mate.kind)) {
          const ag = resolve(mate.a, a);
          const bg = resolve(mate.b, b);
          if (!ag || !bg) continue;
          const row = analyticJacobianRow(mate, a, b, ag, bg, aOff, bOff);
          if (row.cols.length === 0) {
            numericRowFallback(J, M, dofCount, i, mates, parts, freeIdx, resolve, r);
            continue;
          }
          // Stamp the analytic values, then check if they are ALL ZERO —
          // a known failure mode for direction-only residuals (parallel,
          // perpendicular, angle) starting at a saddle/kink where the
          // closed-form gradient evaluates to 0 but the numeric forward-
          // diff still detects directional descent. When the row is
          // analytically degenerate we transparently re-fill it via
          // numericRowFallback so the LM step has a non-zero direction.
          let allZero = true;
          for (let k = 0; k < row.cols.length; k++) {
            const v = row.values[k]!;
            J[i * dofCount + row.cols[k]!] = v;
            if (allZero && v !== 0) allZero = false;
          }
          if (allZero && r[i]! > 0) {
            numericRowFallback(J, M, dofCount, i, mates, parts, freeIdx, resolve, r);
          }
        } else {
          numericRowFallback(J, M, dofCount, i, mates, parts, freeIdx, resolve, r);
        }
      }
    } else {
      // Pure numeric forward-diff Jacobian (matches lagrangianSolve).
      for (let d = 0; d < dofCount; d++) {
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
        for (let i = 0; i < M; i++) {
          J[i * dofCount + d] = (rPert[i]! - r[i]!) / JACOBIAN_EPS;
        }
      }
    }

    // ── Normal equations A = J^T J + λI ; rhs = -J^T r ─────────────────
    // Also remember the un-damped gradient g = J^T r for the Armijo check
    // (we need ∇f(q)·dq = (J^T r)·dq for f = ½‖r‖²).
    const A = new Float64Array(dofCount * dofCount);
    const rhs = new Float64Array(dofCount);
    const grad = new Float64Array(dofCount);
    for (let c = 0; c < dofCount; c++) {
      for (let cc = 0; cc < dofCount; cc++) {
        let sum = 0;
        for (let i = 0; i < M; i++) {
          sum += J[i * dofCount + c]! * J[i * dofCount + cc]!;
        }
        A[c * dofCount + cc] = sum;
      }
      A[c * dofCount + c] = A[c * dofCount + c]! + lambda;
      let rs = 0;
      for (let i = 0; i < M; i++) rs += J[i * dofCount + c]! * r[i]!;
      grad[c] = rs;
      rhs[c] = -rs;
    }

    const dq = gaussSolve(A, rhs, dofCount);
    if (!dq) {
      // Singular normal equations → bump λ; if already saturated, surface
      // current best-effort answer rather than punting to Gauss-Seidel
      // (the adaptive contract is: ALWAYS return what we found).
      if (lambda >= MAX_LAMBDA) break;
      lambda *= 10;
      consecutiveSuccess = 0;
      continue;
    }

    // ── Backtracking line search on f = ½‖r‖² ──────────────────────────
    // Armijo:  f(q + α·dq)  ≤  f(q) + c·α·(∇f·dq) ;  ∇f·dq = grad·dq.
    // We pre-multiply by the global damping factor since dampingFactor is
    // documented as a "shrink the whole step" knob; line search then
    // operates on top.
    if (damp !== 1.0) {
      for (let i = 0; i < dq.length; i++) dq[i] = dq[i]! * damp;
    }
    let gradDotDq = 0;
    for (let i = 0; i < dofCount; i++) gradDotDq += grad[i]! * dq[i]!;
    // The Newton step minimises ½‖r + J·dq‖², so grad·dq should be
    // NEGATIVE (descent direction). Two cases where it isn't:
    //   (a) numerical noise around an Armijo-kink (|·| residuals),
    //   (b) saddle points in direction-only residuals (e.g. parallel mate
    //       starting at 90° has cross-product magnitude AT the maximum).
    // In both cases requiring strict descent on ½‖r‖² can permanently
    // reject every backtracked step. We fall back to the basic LM
    // semantics: accept the FULL step if it improves L∞, else mark fail.
    const f0 = 0.5 * curSumSq;
    let alpha = lsAlpha0;
    let accepted = false;
    let trialParts: PartInstance[] = parts;
    let trial = { vec: r, max: curMax, sumSq: curSumSq };
    let bestParts: PartInstance[] | null = null;
    let bestTrial: { vec: Float64Array; max: number; sumSq: number } | null = null;
    let bt = 0;
    for (; bt <= lsMaxBt; bt++) {
      const stepped = parts.map((p) => {
        const idx = freeIdx.get(p.id);
        if (idx === undefined) return p;
        // Scale dq by alpha at apply time so we don't mutate dq across
        // the backtracking loop.
        const scaled = new Float64Array(6);
        for (let k = 0; k < 6; k++) scaled[k] = dq[idx + k]! * alpha;
        return applyDelta(p, scaled, 0);
      });
      const t = evalR(stepped);
      // Track best-by-sumSq across all backtracks so we never throw away
      // a strictly-improving step just because it failed the Armijo
      // tightness — this protects against pathological c (e.g. 0.9) and
      // against direction-only saddle starts.
      if (bestTrial === null || t.sumSq < bestTrial.sumSq) {
        bestTrial = t;
        bestParts = stepped;
      }
      // Armijo target: ½‖r‖²(q+α·dq) ≤ f0 + c·α·(grad·dq).
      // When grad·dq ≥ 0 (non-descent) we degenerate to strict-decrease.
      const armijoBound = gradDotDq < 0
        ? f0 + lsC * alpha * gradDotDq
        : f0;
      if (0.5 * t.sumSq <= armijoBound) {
        trialParts = stepped;
        trial = t;
        accepted = true;
        break;
      }
      alpha *= lsBeta;
    }

    if (!accepted) {
      // All backtracks exhausted. If the best-by-sumSq backtrack still
      // improved sumSq vs the current point, take that (LM basic
      // semantics); otherwise commit to a tiny step (eps·α₀) so we keep
      // forward progress instead of stalling at the trust-region wall.
      if (bestTrial !== null && bestTrial.sumSq < curSumSq && bestParts !== null) {
        trialParts = bestParts;
        trial = bestTrial;
        lambda = Math.min(lambda * 10, MAX_LAMBDA);
        consecutiveSuccess = 0;
      } else {
        const alphaTiny = lsAlpha0 * 1e-8;
        const stepped = parts.map((p) => {
          const idx = freeIdx.get(p.id);
          if (idx === undefined) return p;
          const scaled = new Float64Array(6);
          for (let k = 0; k < 6; k++) scaled[k] = dq[idx + k]! * alphaTiny;
          return applyDelta(p, scaled, 0);
        });
        trialParts = stepped;
        trial = evalR(stepped);
        lambda = Math.min(lambda * 10, MAX_LAMBDA);
        consecutiveSuccess = 0;
      }
    } else if (trial.max >= curMax) {
      // Line search satisfied Armijo on ½‖r‖² but the L∞ residual didn't
      // budge — accept the step (sum-square went down) but treat it as
      // a non-success for the λ schedule, so we don't aggressively relax.
      consecutiveSuccess = 0;
    } else {
      consecutiveSuccess += 1;
      if (consecutiveSuccess >= AGGRESSIVE_SUCCESS_STREAK) {
        lambda = Math.max(lambda / AGGRESSIVE_LAMBDA_DIVISOR, 1e-12);
        consecutiveSuccess = 0; // reset streak after the jolt
      } else {
        lambda = Math.max(lambda / 10, 1e-12);
      }
    }

    parts = trialParts;
    r = trial.vec;
    curMax = trial.max;
    curSumSq = trial.sumSq;

    // ── Termination: tolerance reached ─────────────────────────────────
    if (curMax < tol) {
      iter += 1;
      break;
    }

    // ── Stall detection (sliding window of L∞ deltas) ──────────────────
    const delta = Math.abs(prevMax - curMax);
    prevMax = curMax;
    stallWindow.push(delta);
    if (stallWindow.length > STALL_WINDOW) stallWindow.shift();
    if (stallWindow.length === STALL_WINDOW) {
      let worst = 0;
      for (const d of stallWindow) if (d > worst) worst = d;
      if (worst < tol * STALL_DELTA_RATIO) {
        // The window is dead — we're not going anywhere. Treat the
        // current residual as the linearisation-limited optimum and
        // exit. `success` is decided by whether curMax < tol.
        iter += 1;
        break;
      }
    }
  }

  return {
    state: { parts, mates: state.mates },
    success: curMax < tol,
    iterations: iter,
    finalMaxResidual: curMax,
    residuals: buildResiduals(state, parts, resolve),
  };
}

// ─── re-exports for type-checking convenience ────────────────────────────

export type { IterativeSolveResult, MateResidual, GeometryResolver, ResolvedGeometry };
export type { AxisInWorld, PlaneInWorld };
export type { MateRef };
