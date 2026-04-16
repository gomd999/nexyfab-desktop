/**
 * Residual-based sketch constraint solver — Levenberg-Marquardt.
 *
 * Each constraint contributes one or more residual equations r_i(x) = 0 over the
 * vector x of free point coordinates. We iterate:
 *
 *   (JᵀJ + λI) Δx = -Jᵀr         (damped normal equations)
 *
 * with numerical Jacobian and adaptive damping. This replaces the prior
 * per-constraint projection loop, which oscillated on coupled systems
 * (equal + dimension + parallel, etc.) and could not handle DOF analysis.
 *
 * Public API (`solveConstraints`, `SolverResult`, `ConstraintStatus`) is
 * unchanged so the rest of the sketch tooling stays drop-in compatible.
 */

import type { SketchPoint, SketchSegment, SketchConstraint, SketchDimension } from './types';

// ─── Public types (unchanged) ───────────────────────────────────────────────

export type ConstraintStatus = 'ok' | 'over-defined' | 'under-defined' | 'inconsistent';

export interface ConstraintSolveResult {
  status: ConstraintStatus;
  conflicts?: string[];
  message?: string;
  /** Remaining degrees of freedom (≥0: well/under-defined, <0: over-defined) */
  dof?: number;
  /** Final residual norm */
  residual?: number;
}

export interface SolverResult {
  points: Map<string, SketchPoint>;
  satisfied: boolean;
  unsatisfiedConstraints: string[];
  solveResult?: ConstraintSolveResult;
}

// ─── Variable vector: maps pointId ↔ x/y index in state array ───────────────

interface VarIndex {
  /** pointId → [xIdx, yIdx] in state vector; fixed points omitted */
  idx: Map<string, [number, number]>;
  /** Concrete positions of fixed points (not part of x) */
  fixed: Map<string, SketchPoint>;
  /** Flat state vector length (= 2 * free points) */
  n: number;
}

function buildVars(
  segments: SketchSegment[],
  constraints: SketchConstraint[],
): { vars: VarIndex; x: Float64Array } {
  const ids = new Set<string>();
  for (const s of segments) {
    for (const p of s.points) if (p.id) ids.add(p.id);
  }
  // Fixed constraint removes that point from the variable set entirely.
  const fixedIds = new Set<string>();
  const fixedPts = new Map<string, SketchPoint>();
  for (const c of constraints) {
    if (c.type === 'fixed' && c.entityIds[0]) fixedIds.add(c.entityIds[0]);
  }

  const orig = new Map<string, SketchPoint>();
  for (const s of segments) {
    for (const p of s.points) {
      if (p.id && !orig.has(p.id)) orig.set(p.id, { ...p });
    }
  }
  for (const fid of fixedIds) {
    const o = orig.get(fid);
    if (o) fixedPts.set(fid, { ...o });
  }

  const idx = new Map<string, [number, number]>();
  let cursor = 0;
  for (const id of ids) {
    if (fixedIds.has(id)) continue;
    idx.set(id, [cursor, cursor + 1]);
    cursor += 2;
  }
  const x = new Float64Array(cursor);
  for (const [id, [ix, iy]] of idx) {
    const p = orig.get(id)!;
    x[ix] = p.x;
    x[iy] = p.y;
  }
  return { vars: { idx, fixed: fixedPts, n: cursor }, x };
}

/** Read x,y of a point from state x (or fixed table). Returns null if unknown. */
function readPt(
  id: string | undefined,
  x: Float64Array,
  vars: VarIndex,
): { x: number; y: number } | null {
  if (!id) return null;
  const k = vars.idx.get(id);
  if (k) return { x: x[k[0]], y: x[k[1]] };
  const f = vars.fixed.get(id);
  if (f) return { x: f.x, y: f.y };
  return null;
}

// ─── Residuals ──────────────────────────────────────────────────────────────

/**
 * A residual equation is a function (x) → number. Each constraint contributes
 * one or more residuals. We collect them into a flat array so the Jacobian can
 * be computed row-by-row with finite differences.
 */
type Residual = (x: Float64Array) => number;

interface ResidualSet {
  residuals: Residual[];
  /** Parallel array: source constraint id per residual row (for reporting) */
  sourceIds: string[];
}

function buildResiduals(
  segments: SketchSegment[],
  constraints: SketchConstraint[],
  dimensions: SketchDimension[],
  vars: VarIndex,
): ResidualSet {
  const residuals: Residual[] = [];
  const sourceIds: string[] = [];
  const segById = new Map<string, SketchSegment>();
  for (const s of segments) if (s.id) segById.set(s.id, s);

  const add = (id: string, r: Residual) => {
    residuals.push(r);
    sourceIds.push(id);
  };

  const lineEnds = (segId: string | undefined) => {
    if (!segId) return null;
    const s = segById.get(segId);
    if (!s || s.type !== 'line' || s.points.length < 2) return null;
    const a = s.points[0].id;
    const b = s.points[1].id;
    if (!a || !b) return null;
    return { aId: a, bId: b };
  };

  const circleIds = (segId: string | undefined) => {
    if (!segId) return null;
    const s = segById.get(segId);
    if (!s || (s.type !== 'circle' && s.type !== 'arc') || s.points.length < 2) return null;
    const c = s.points[0].id;
    const e = s.points[1].id;
    if (!c || !e) return null;
    return { cId: c, eId: e };
  };

  for (const c of constraints) {
    switch (c.type) {
      case 'horizontal': {
        const e = lineEnds(c.entityIds[0]);
        if (!e) break;
        add(c.id, x => {
          const A = readPt(e.aId, x, vars);
          const B = readPt(e.bId, x, vars);
          return A && B ? B.y - A.y : 0;
        });
        break;
      }
      case 'vertical': {
        const e = lineEnds(c.entityIds[0]);
        if (!e) break;
        add(c.id, x => {
          const A = readPt(e.aId, x, vars);
          const B = readPt(e.bId, x, vars);
          return A && B ? B.x - A.x : 0;
        });
        break;
      }
      case 'coincident': {
        const [a, b] = c.entityIds;
        if (!a || !b) break;
        add(c.id, x => {
          const A = readPt(a, x, vars);
          const B = readPt(b, x, vars);
          return A && B ? B.x - A.x : 0;
        });
        add(c.id, x => {
          const A = readPt(a, x, vars);
          const B = readPt(b, x, vars);
          return A && B ? B.y - A.y : 0;
        });
        break;
      }
      case 'fixed':
        // Enforced by variable-elimination in buildVars — zero residual rows.
        break;
      case 'parallel': {
        const e1 = lineEnds(c.entityIds[0]);
        const e2 = lineEnds(c.entityIds[1]);
        if (!e1 || !e2) break;
        // r = cross(d1, d2) = dx1*dy2 - dy1*dx2
        add(c.id, x => {
          const A0 = readPt(e1.aId, x, vars);
          const A1 = readPt(e1.bId, x, vars);
          const B0 = readPt(e2.aId, x, vars);
          const B1 = readPt(e2.bId, x, vars);
          if (!A0 || !A1 || !B0 || !B1) return 0;
          const dx1 = A1.x - A0.x, dy1 = A1.y - A0.y;
          const dx2 = B1.x - B0.x, dy2 = B1.y - B0.y;
          return dx1 * dy2 - dy1 * dx2;
        });
        break;
      }
      case 'perpendicular': {
        const e1 = lineEnds(c.entityIds[0]);
        const e2 = lineEnds(c.entityIds[1]);
        if (!e1 || !e2) break;
        // r = dot(d1, d2)
        add(c.id, x => {
          const A0 = readPt(e1.aId, x, vars);
          const A1 = readPt(e1.bId, x, vars);
          const B0 = readPt(e2.aId, x, vars);
          const B1 = readPt(e2.bId, x, vars);
          if (!A0 || !A1 || !B0 || !B1) return 0;
          const dx1 = A1.x - A0.x, dy1 = A1.y - A0.y;
          const dx2 = B1.x - B0.x, dy2 = B1.y - B0.y;
          return dx1 * dx2 + dy1 * dy2;
        });
        break;
      }
      case 'equal': {
        const s1 = c.entityIds[0] ? segById.get(c.entityIds[0]) : undefined;
        const s2 = c.entityIds[1] ? segById.get(c.entityIds[1]) : undefined;
        if (!s1 || !s2) break;
        // Residual: len1² - len2² (avoids sqrt; same roots)
        add(c.id, x => {
          const l1 = squaredLen(s1, x, vars);
          const l2 = squaredLen(s2, x, vars);
          return l1 - l2;
        });
        break;
      }
      case 'tangent': {
        const s1 = c.entityIds[0] ? segById.get(c.entityIds[0]) : undefined;
        const s2 = c.entityIds[1] ? segById.get(c.entityIds[1]) : undefined;
        if (!s1 || !s2) break;
        // Case A: two circles — dist(c1,c2) = r1 + r2
        if ((s1.type === 'circle' || s1.type === 'arc') && (s2.type === 'circle' || s2.type === 'arc')) {
          const ci1 = circleIds(s1.id); const ci2 = circleIds(s2.id);
          if (!ci1 || !ci2) break;
          add(c.id, x => {
            const C1 = readPt(ci1.cId, x, vars);
            const E1 = readPt(ci1.eId, x, vars);
            const C2 = readPt(ci2.cId, x, vars);
            const E2 = readPt(ci2.eId, x, vars);
            if (!C1 || !E1 || !C2 || !E2) return 0;
            const r1 = Math.hypot(E1.x - C1.x, E1.y - C1.y);
            const r2 = Math.hypot(E2.x - C2.x, E2.y - C2.y);
            const d = Math.hypot(C2.x - C1.x, C2.y - C1.y);
            return d - (r1 + r2);
          });
        } else {
          // Case B: line + circle — perpendicular distance from center to line = radius
          const line = s1.type === 'line' ? s1 : s2;
          const arc = s1.type === 'line' ? s2 : s1;
          const le = lineEnds(line.id);
          const ca = circleIds(arc.id);
          if (!le || !ca) break;
          add(c.id, x => {
            const L0 = readPt(le.aId, x, vars);
            const L1 = readPt(le.bId, x, vars);
            const C = readPt(ca.cId, x, vars);
            const E = readPt(ca.eId, x, vars);
            if (!L0 || !L1 || !C || !E) return 0;
            const ldx = L1.x - L0.x, ldy = L1.y - L0.y;
            const llen = Math.hypot(ldx, ldy);
            if (llen < 1e-12) return 0;
            const cross = (C.x - L0.x) * ldy - (C.y - L0.y) * ldx;
            const distAbs = Math.abs(cross) / llen;
            const r = Math.hypot(E.x - C.x, E.y - C.y);
            return distAbs - r;
          });
        }
        break;
      }
      case 'concentric': {
        const s1 = c.entityIds[0] ? segById.get(c.entityIds[0]) : undefined;
        const s2 = c.entityIds[1] ? segById.get(c.entityIds[1]) : undefined;
        const ci1 = s1 ? circleIds(s1.id) : null;
        const ci2 = s2 ? circleIds(s2.id) : null;
        if (!ci1 || !ci2) break;
        add(c.id, x => {
          const A = readPt(ci1.cId, x, vars);
          const B = readPt(ci2.cId, x, vars);
          return A && B ? B.x - A.x : 0;
        });
        add(c.id, x => {
          const A = readPt(ci1.cId, x, vars);
          const B = readPt(ci2.cId, x, vars);
          return A && B ? B.y - A.y : 0;
        });
        break;
      }
      case 'symmetric': {
        const [a, b] = c.entityIds;
        if (!a || !b) break;
        const axis = c.value ?? 0; // 0 = X-axis (mirror y), 1 = Y-axis (mirror x)
        if (axis === 1) {
          add(c.id, x => {
            const A = readPt(a, x, vars); const B = readPt(b, x, vars);
            return A && B ? A.x + B.x : 0;
          });
          add(c.id, x => {
            const A = readPt(a, x, vars); const B = readPt(b, x, vars);
            return A && B ? A.y - B.y : 0;
          });
        } else {
          add(c.id, x => {
            const A = readPt(a, x, vars); const B = readPt(b, x, vars);
            return A && B ? A.y + B.y : 0;
          });
          add(c.id, x => {
            const A = readPt(a, x, vars); const B = readPt(b, x, vars);
            return A && B ? A.x - B.x : 0;
          });
        }
        break;
      }
      case 'midpoint': {
        const ptId = c.entityIds[0];
        const le = lineEnds(c.entityIds[1]);
        if (!ptId || !le) break;
        add(c.id, x => {
          const P = readPt(ptId, x, vars);
          const A = readPt(le.aId, x, vars);
          const B = readPt(le.bId, x, vars);
          return P && A && B ? P.x - (A.x + B.x) / 2 : 0;
        });
        add(c.id, x => {
          const P = readPt(ptId, x, vars);
          const A = readPt(le.aId, x, vars);
          const B = readPt(le.bId, x, vars);
          return P && A && B ? P.y - (A.y + B.y) / 2 : 0;
        });
        break;
      }
      case 'angle': {
        const e1 = lineEnds(c.entityIds[0]);
        const e2 = lineEnds(c.entityIds[1]);
        if (!e1 || !e2) break;
        const target = ((c.value ?? 90) * Math.PI) / 180;
        const cosT = Math.cos(target);
        // r = cos(current) - cos(target), computed from normalized dot product.
        add(c.id, x => {
          const A0 = readPt(e1.aId, x, vars);
          const A1 = readPt(e1.bId, x, vars);
          const B0 = readPt(e2.aId, x, vars);
          const B1 = readPt(e2.bId, x, vars);
          if (!A0 || !A1 || !B0 || !B1) return 0;
          const dx1 = A1.x - A0.x, dy1 = A1.y - A0.y;
          const dx2 = B1.x - B0.x, dy2 = B1.y - B0.y;
          const l1 = Math.hypot(dx1, dy1);
          const l2 = Math.hypot(dx2, dy2);
          if (l1 < 1e-12 || l2 < 1e-12) return 0;
          return (dx1 * dx2 + dy1 * dy2) / (l1 * l2) - cosT;
        });
        break;
      }
      default:
        break;
    }
  }

  // Driving dimensions (locked only)
  for (const d of dimensions) {
    if (!d.locked) continue;
    switch (d.type) {
      case 'linear': {
        const s = d.entityIds[0] ? segById.get(d.entityIds[0]) : undefined;
        if (!s) break;
        const target = d.value;
        add(d.id, x => {
          const len = Math.sqrt(squaredLen(s, x, vars));
          return len - target;
        });
        break;
      }
      case 'radial':
      case 'diameter': {
        const s = d.entityIds[0] ? segById.get(d.entityIds[0]) : undefined;
        const ci = s ? circleIds(s.id) : null;
        if (!ci) break;
        const target = d.type === 'diameter' ? d.value / 2 : d.value;
        add(d.id, x => {
          const C = readPt(ci.cId, x, vars);
          const E = readPt(ci.eId, x, vars);
          if (!C || !E) return 0;
          return Math.hypot(E.x - C.x, E.y - C.y) - target;
        });
        break;
      }
      default:
        break;
    }
  }

  return { residuals, sourceIds };
}

function squaredLen(seg: SketchSegment, x: Float64Array, vars: VarIndex): number {
  if (seg.points.length < 2) return 0;
  const a = readPt(seg.points[0].id, x, vars);
  const b = readPt(seg.points[1].id, x, vars);
  if (!a || !b) return 0;
  const dx = b.x - a.x, dy = b.y - a.y;
  return dx * dx + dy * dy;
}

// ─── Levenberg-Marquardt core ───────────────────────────────────────────────

const JAC_EPS = 1e-6;

function evalResiduals(rs: Residual[], x: Float64Array): Float64Array {
  const out = new Float64Array(rs.length);
  for (let i = 0; i < rs.length; i++) out[i] = rs[i](x);
  return out;
}

function residualNorm(r: Float64Array): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) s += r[i] * r[i];
  return Math.sqrt(s);
}

/** Numerical Jacobian via forward differences. J is stored row-major (m × n). */
function jacobian(rs: Residual[], x: Float64Array, r0: Float64Array): Float64Array {
  const m = rs.length;
  const n = x.length;
  const J = new Float64Array(m * n);
  for (let j = 0; j < n; j++) {
    const save = x[j];
    const h = JAC_EPS * Math.max(1, Math.abs(save));
    x[j] = save + h;
    for (let i = 0; i < m; i++) J[i * n + j] = (rs[i](x) - r0[i]) / h;
    x[j] = save;
  }
  return J;
}

/** Solve (A + λ·diag(A)) Δ = b  where A = JᵀJ, b = -Jᵀr.  Returns Δ or null. */
function lmStep(J: Float64Array, r: Float64Array, m: number, n: number, lambda: number): Float64Array | null {
  if (n === 0) return new Float64Array(0);
  // A = JᵀJ  (n × n), b = -Jᵀr (n)
  const A = new Float64Array(n * n);
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let bi = 0;
    for (let k = 0; k < m; k++) bi -= J[k * n + i] * r[k];
    b[i] = bi;
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let k = 0; k < m; k++) s += J[k * n + i] * J[k * n + j];
      A[i * n + j] = s;
      A[j * n + i] = s;
    }
  }
  // Apply Marquardt damping on the diagonal (scaled).
  for (let i = 0; i < n; i++) A[i * n + i] += lambda * (1 + Math.abs(A[i * n + i]));

  return solveDense(A, b, n);
}

/** In-place Gaussian elimination with partial pivoting. */
function solveDense(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const M = new Float64Array(A);
  const y = new Float64Array(b);
  for (let k = 0; k < n; k++) {
    // Partial pivot
    let piv = k, max = Math.abs(M[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i * n + k]);
      if (v > max) { max = v; piv = i; }
    }
    if (max < 1e-14) return null; // singular
    if (piv !== k) {
      for (let j = k; j < n; j++) {
        const t = M[k * n + j]; M[k * n + j] = M[piv * n + j]; M[piv * n + j] = t;
      }
      const t = y[k]; y[k] = y[piv]; y[piv] = t;
    }
    const pivVal = M[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = M[i * n + k] / pivVal;
      if (f === 0) continue;
      for (let j = k; j < n; j++) M[i * n + j] -= f * M[k * n + j];
      y[i] -= f * y[k];
    }
  }
  // Back-substitution
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let j = i + 1; j < n; j++) s -= M[i * n + j] * x[j];
    x[i] = s / M[i * n + i];
  }
  return x;
}

/** Estimate numerical rank of J via diagonal of Jᵀ J with column-scaled tolerance. */
function estimateRank(J: Float64Array, m: number, n: number): number {
  if (m === 0 || n === 0) return 0;
  // Gram matrix diagonals as column norms, then Gram-Schmidt-ish reduction.
  const M = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let k = 0; k < m; k++) s += J[k * n + i] * J[k * n + j];
      M[i * n + j] = s;
      M[j * n + i] = s;
    }
  }
  // Cholesky-like with threshold
  const tol = 1e-9;
  let rank = 0;
  for (let k = 0; k < n; k++) {
    let piv = k, max = Math.abs(M[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i * n + i]);
      if (v > max) { max = v; piv = i; }
    }
    if (max < tol) break;
    if (piv !== k) {
      for (let j = 0; j < n; j++) {
        const t = M[k * n + j]; M[k * n + j] = M[piv * n + j]; M[piv * n + j] = t;
      }
      for (let j = 0; j < n; j++) {
        const t = M[j * n + k]; M[j * n + k] = M[j * n + piv]; M[j * n + piv] = t;
      }
    }
    rank++;
    const pivVal = M[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = M[i * n + k] / pivVal;
      for (let j = k + 1; j < n; j++) M[i * n + j] -= f * M[k * n + j];
    }
  }
  return rank;
}

// ─── Main solver ────────────────────────────────────────────────────────────

const MAX_ITERATIONS_DEFAULT = 50;
const LAMBDA_INIT = 1e-3;
const LAMBDA_MIN = 1e-12;
const LAMBDA_MAX = 1e8;

export function solveConstraints(
  segments: SketchSegment[],
  constraints: SketchConstraint[],
  dimensions: SketchDimension[],
  maxIterations: number = MAX_ITERATIONS_DEFAULT,
  tolerance: number = 1e-6,
): SolverResult {
  const { vars, x } = buildVars(segments, constraints);
  const { residuals: rs, sourceIds } = buildResiduals(segments, constraints, dimensions, vars);

  const ptsOut = () => {
    const out = new Map<string, SketchPoint>();
    for (const [id, [ix, iy]] of vars.idx) out.set(id, { id, x: x[ix], y: x[iy] });
    for (const [id, p] of vars.fixed) out.set(id, { id, x: p.x, y: p.y });
    return out;
  };

  if (rs.length === 0) {
    return {
      points: ptsOut(),
      satisfied: true,
      unsatisfiedConstraints: [],
      solveResult: {
        status: vars.n === 0 ? 'ok' : 'under-defined',
        dof: vars.n,
        residual: 0,
      },
    };
  }

  // Levenberg-Marquardt loop.
  let lambda = LAMBDA_INIT;
  let r = evalResiduals(rs, x);
  let err = residualNorm(r);
  let iter = 0;
  const m = rs.length;
  const n = x.length;

  let lastJ: Float64Array | null = null;

  while (err > tolerance && iter < maxIterations) {
    iter++;
    const J = jacobian(rs, x, r);
    lastJ = J;
    const delta = lmStep(J, r, m, n, lambda);
    if (!delta) {
      lambda = Math.min(LAMBDA_MAX, lambda * 10);
      if (lambda >= LAMBDA_MAX) break;
      continue;
    }
    // Trial step
    const xTrial = new Float64Array(n);
    for (let i = 0; i < n; i++) xTrial[i] = x[i] + delta[i];
    const rTrial = evalResiduals(rs, xTrial);
    const errTrial = residualNorm(rTrial);

    if (errTrial < err) {
      // Accept
      for (let i = 0; i < n; i++) x[i] = xTrial[i];
      r = rTrial;
      err = errTrial;
      lambda = Math.max(LAMBDA_MIN, lambda / 3);
    } else {
      lambda = Math.min(LAMBDA_MAX, lambda * 5);
      if (lambda >= LAMBDA_MAX) break;
    }
  }

  // Collect unsatisfied (residual > tolerance) and map back to constraint ids.
  const unsatisfiedSet = new Set<string>();
  for (let i = 0; i < r.length; i++) {
    if (Math.abs(r[i]) > Math.max(tolerance, 1e-3)) unsatisfiedSet.add(sourceIds[i]);
  }
  const unsatisfied = Array.from(unsatisfiedSet);

  // DOF analysis via rank estimate of the last Jacobian.
  let dof = n;
  if (lastJ && n > 0) {
    const rank = estimateRank(lastJ, m, n);
    dof = n - rank;
  }

  let status: ConstraintStatus;
  let message: string | undefined;
  if (err <= tolerance && unsatisfied.length === 0) {
    status = dof > 0 ? 'under-defined' : 'ok';
    if (status === 'under-defined') message = `Sketch has ${dof} remaining degree(s) of freedom`;
  } else if (iter >= maxIterations) {
    status = 'inconsistent';
    message = `Solver did not converge after ${iter} iterations (residual ${err.toExponential(2)})`;
  } else {
    status = 'over-defined';
    message = `${unsatisfied.length} constraint(s) cannot be simultaneously satisfied`;
  }

  return {
    points: ptsOut(),
    satisfied: unsatisfied.length === 0 && err <= tolerance,
    unsatisfiedConstraints: unsatisfied,
    solveResult: {
      status,
      message,
      dof,
      residual: err,
      conflicts: status === 'over-defined' ? unsatisfied.map(id => `constraint ${id}`) : undefined,
    },
  };
}
