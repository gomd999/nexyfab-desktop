/**
 * sketchDragSolve.ts — interactive drag-solve for the MAIN modeler sketch
 * canvas (SolidWorks feel: drag a point, the constraint solver keeps every
 * constraint satisfied while the point follows the cursor as far as the
 * remaining degrees of freedom allow).
 *
 * Approach (decision record):
 *   We compose the home-grown LM solver's exported kernels
 *   (`buildVars` / `buildResiduals` / `jacobian` / `lmStep` from
 *   constraintSolver.ts) instead of adapting to the planegcs WASM stack.
 *   The planegcs facade only models point/line/circle/arc and a subset of
 *   constraint semantics — the main sketch model also has rect / polygon /
 *   ellipse / slot / nurbs segments, axis-based `symmetric`, `midpoint`,
 *   point-to-line `distance`, and expression-driven dimensions. An adapter
 *   would silently drop those during drag AND disagree with the LM-based
 *   live status chip (sketchStatusLive). Same residual vocabulary = same
 *   truth.
 *
 * Algorithm (two-phase, per pointermove):
 *   Phase 1 — soft pin: append two weighted residual rows
 *       w·(Px − cursor.x), w·(Py − cursor.y)
 *     to the constraint residuals and run a short LM minimization of the
 *     FULL least-squares system. Where the constraint manifold permits, the
 *     point reaches the cursor; where it doesn't (e.g. a locked length),
 *     LM finds the compromise — the point slides along the manifold. This
 *     is exactly the SolidWorks "rotate the dimensioned line around" feel.
 *   Phase 2 — polish: drop the pin rows and re-converge the constraint-only
 *     system from the phase-1 state, so the geometry handed back to the
 *     canvas satisfies constraints to tolerance every frame (no drift
 *     accumulation across frames).
 *
 * Fallback rules (spec):
 *   - dragged point carries a `fixed` constraint     → no-move (blocked).
 *   - constraints cannot be re-satisfied after pinning (truly inconsistent /
 *     over-constrained system)                       → no-move (blocked);
 *     the existing red status chip already explains why.
 *   - zero constraints & no locked dimensions        → plain raw move.
 *
 * Whole-segment (edge/body) drag — `dragSolveSegment`:
 *   Same two-phase machinery, but the pin is MULTI-POINT: each "handle"
 *   defining point of the segment is soft-pinned to its translated target
 *   (current position + cursor delta), so the whole edge chases the cursor
 *   as a rigid translation where the constraint manifold allows it.
 *   Per-type pin sets (see `segmentPinIndices`):
 *     line [start,end] / rect [c1,c2] / arc [s,t,e] / nurbs ctrl-pts
 *                                  → ALL defining points pinned (rigid intent)
 *     circle / polygon [center, edge] → center pinned only; the edge point is
 *                                  warm-start translated but NOT pinned, so
 *                                  radius/orientation stays free for
 *                                  constraints (tangent, locked radial dim)
 *                                  to negotiate. An unconstrained circle
 *                                  still translates rigidly via warm start.
 *     ellipse [center, rx, ry]    → center pinned; rx/ry handles free.
 *     slot [c1, c2, radiusPt]     → both cap centers pinned; radius pt free.
 *   Fixed rules: a `fixed` constraint on the segment id, or on EVERY pinnable
 *   defining point, blocks the drag; a partially-fixed segment (e.g. a line
 *   with one fixed endpoint) still drags — the free end chases its pin, the
 *   classic rotate/stretch-around-the-anchor feel.
 *
 * Pure function: never mutates its inputs; returns fresh segment arrays.
 */

import {
  buildVars,
  buildResiduals,
  evalResiduals,
  residualNorm,
  jacobian,
  solveDense,
  readPointFromState,
  type Residual,
} from './constraintSolver';
import type { SketchSegment, SketchConstraint, SketchDimension } from './types';

export type DragSolveOutcome =
  /** No constraint system in play — raw cursor move applied. */
  | 'free'
  /** Solver-tracked move; constraints satisfied to tolerance. */
  | 'moved'
  /** Dragged point is pinned by a `fixed` constraint — geometry unchanged. */
  | 'blocked-fixed'
  /** Constraints could not be re-satisfied (over-constrained / inconsistent) — geometry unchanged. */
  | 'blocked-unsolvable';

export interface DragSolveResult {
  /** Next segments (=== input array reference when blocked). */
  segments: SketchSegment[];
  outcome: DragSolveOutcome;
  /** Constraint-only residual norm after the solve (0 for free/blocked-fixed). */
  residual: number;
}

export interface DragSolveOptions {
  /** Pin strength relative to constraint residuals (default 1). */
  pinWeight?: number;
  /** LM iterations for the pinned phase (default 30). */
  maxPinnedIterations?: number;
  /** LM iterations for the constraint-only polish phase (default 20). */
  maxPolishIterations?: number;
  /** Constraint satisfaction tolerance, mm-grade for drag (default 1e-4). */
  tolerance?: number;
}

const LAMBDA_INIT = 1e-3;
const LAMBDA_MIN = 1e-12;
const LAMBDA_MAX = 1e8;
/** Relative improvement under which the LM loop is considered stalled. */
const STALL_REL = 1e-9;

/**
 * LM step with UNIFORM (Levenberg) damping:  (JᵀJ + λ·s·I) Δ = −Jᵀr,
 * where s = 1 + mean(diag(JᵀJ)) keeps λ scale-free.
 *
 * Drag-solve deliberately does NOT reuse `lmStep` from constraintSolver:
 * its Marquardt damping scales the diagonal per-entry (λ·(1+|Aᵢᵢ|)), which
 * on under-determined systems (almost every drag — DOF > 0) skews the step
 * direction toward D⁻¹·Jᵀr instead of the minimum-norm pseudo-inverse
 * direction. Visually that's lateral drift: polishing a length-locked point
 * back onto its circle would also ROTATE it. Uniform damping keeps every
 * step in the row space of J (minimum-norm), so the geometry moves as
 * little as possible — the SolidWorks drag feel.
 */
function lmStepUniform(
  J: Float64Array,
  r: Float64Array,
  m: number,
  n: number,
  lambda: number,
): Float64Array | null {
  if (n === 0) return new Float64Array(0);
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
  let diagMean = 0;
  for (let i = 0; i < n; i++) diagMean += A[i * n + i];
  diagMean /= n;
  const damp = lambda * (1 + diagMean);
  for (let i = 0; i < n; i++) A[i * n + i] += damp;
  return solveDense(A, b, n);
}

/**
 * Minimal LM loop over `rs`, mutating `x` in place. Unlike
 * `solveConstraints`, it terminates on stall as well as on `tol` — required
 * for the pinned phase, where the pin rows generally cannot reach zero.
 * Returns the final residual norm of `rs`.
 */
function runLm(rs: Residual[], x: Float64Array, maxIter: number, tol: number): number {
  const m = rs.length;
  const n = x.length;
  if (m === 0 || n === 0) return m === 0 ? 0 : residualNorm(evalResiduals(rs, x));

  let lambda = LAMBDA_INIT;
  let r = evalResiduals(rs, x);
  let err = residualNorm(r);
  let iter = 0;

  while (err > tol && iter < maxIter) {
    iter++;
    const J = jacobian(rs, x, r);
    const delta = lmStepUniform(J, r, m, n, lambda);
    if (!delta) {
      lambda = Math.min(LAMBDA_MAX, lambda * 10);
      if (lambda >= LAMBDA_MAX) break;
      continue;
    }
    const xTrial = new Float64Array(n);
    for (let i = 0; i < n; i++) xTrial[i] = x[i] + delta[i];
    const rTrial = evalResiduals(rs, xTrial);
    const errTrial = residualNorm(rTrial);

    if (errTrial < err) {
      const improvement = err - errTrial;
      x.set(xTrial);
      r = rTrial;
      err = errTrial;
      lambda = Math.max(LAMBDA_MIN, lambda / 3);
      // Stalled at a least-squares optimum (pin can't be satisfied further).
      if (improvement < STALL_REL * Math.max(1, err)) break;
    } else {
      lambda = Math.min(LAMBDA_MAX, lambda * 5);
      if (lambda >= LAMBDA_MAX) break;
    }
  }
  return err;
}

/** Raw (unconstrained) move: every point carrying `pointId` goes to `target`. */
function movePointRaw(
  segments: SketchSegment[],
  pointId: string,
  target: { x: number; y: number },
): SketchSegment[] {
  return segments.map(seg =>
    seg.points.some(p => p.id === pointId)
      ? {
          ...seg,
          points: seg.points.map(p =>
            p.id === pointId ? { ...p, x: target.x, y: target.y } : p,
          ),
        }
      : seg,
  );
}

/**
 * Drag-solve: move the point with id `pointId` toward `target` while keeping
 * all constraints + locked dimensions satisfied. See module doc for rules.
 */
export function dragSolve(
  segments: SketchSegment[],
  constraints: SketchConstraint[],
  dimensions: SketchDimension[],
  pointId: string,
  target: { x: number; y: number },
  opts: DragSolveOptions = {},
): DragSolveResult {
  const hasLockedDims = dimensions.some(d => d.locked);

  // Plain drag when there is no constraint system at all (current behavior).
  if (constraints.length === 0 && !hasLockedDims) {
    return { segments: movePointRaw(segments, pointId, target), outcome: 'free', residual: 0 };
  }

  // A `fixed` point is never draggable.
  if (constraints.some(c => c.type === 'fixed' && c.entityIds[0] === pointId)) {
    return { segments, outcome: 'blocked-fixed', residual: 0 };
  }

  const { vars, x } = buildVars(segments, constraints);
  const k = vars.idx.get(pointId);
  if (!k) {
    // Point unknown to the solver (shouldn't happen for id'd, unfixed points)
    // — constraints cannot reference it, so a raw move is safe.
    return { segments: movePointRaw(segments, pointId, target), outcome: 'free', residual: 0 };
  }

  const { residuals } = buildResiduals(segments, constraints, dimensions, vars);
  if (residuals.length === 0) {
    // Constraints exist but none produce residual rows (dangling references).
    return { segments: movePointRaw(segments, pointId, target), outcome: 'free', residual: 0 };
  }

  const w = opts.pinWeight ?? 1;
  const tol = opts.tolerance ?? 1e-4;
  const [ix, iy] = k;

  // W3-E: a coupled circle rim's slots store the centre-relative OFFSET, so
  // the cursor pin must target the same parameter space. Express the target
  // relative to the centre's position at gesture time — the pin then drives
  // only the offset (radius/angle), and the centre does not drift toward the
  // cursor, preserving the pre-W3-E rim-drag feel.
  let tx = target.x;
  let ty = target.y;
  const rimCenterId = vars.rimOf.get(pointId);
  if (rimCenterId !== undefined) {
    const c = readPointFromState(rimCenterId, x, vars);
    if (c) { tx -= c.x; ty -= c.y; }
  }

  // Phase 1 — constraints + soft cursor pin.
  const pinnedRs: Residual[] = [
    ...residuals,
    xv => w * (xv[ix] - tx),
    xv => w * (xv[iy] - ty),
  ];
  runLm(pinnedRs, x, opts.maxPinnedIterations ?? 30, tol);

  // Phase 2 — polish constraints exactly (pin removed).
  const cErr = runLm(residuals, x, opts.maxPolishIterations ?? 20, tol);

  if (cErr > Math.max(tol, 1e-3)) {
    // Constraints can't be re-satisfied → refuse the move; the live status
    // chip (sketchStatusLive) reports the over-constrained state.
    return { segments, outcome: 'blocked-unsolvable', residual: cErr };
  }

  // Write the solved coordinates back into fresh segment objects.
  // readPointFromState (not raw slots): coupled rims store offsets.
  const next = segments.map(seg => ({
    ...seg,
    points: seg.points.map(p => {
      if (!p.id || !vars.idx.has(p.id)) return p; // fixed or unknown — untouched
      const abs = readPointFromState(p.id, x, vars)!;
      return { ...p, x: abs.x, y: abs.y };
    }),
  }));
  return { segments: next, outcome: 'moved', residual: cErr };
}

// ─── Whole-segment (edge/body) drag-solve ───────────────────────────────────

/** Defining-point indices that receive a cursor pin during a body drag.
 *  Non-listed points are warm-start translated but left unpinned so the
 *  solver can trade them freely (e.g. a circle's radius under tangency).
 *  See module doc, "Whole-segment drag". */
function segmentPinIndices(seg: SketchSegment): number[] {
  switch (seg.type) {
    case 'circle':
    case 'polygon':
    case 'ellipse':
      return [0]; // [center, ...handles] — pin the center only
    case 'slot':
      return [0, 1]; // [center1, center2, radiusPt] — pin both cap centers
    default:
      // line / rect / arc / nurbs — rigid-translation intent: pin everything.
      return seg.points.map((_, i) => i);
  }
}

/** Raw rigid translation of a segment: every defining point moves by `delta`,
 *  and points elsewhere that SHARE an id with them (polyline joints) follow,
 *  mirroring `movePointRaw` semantics so connected geometry never tears. */
function translateSegmentRaw(
  segments: SketchSegment[],
  seg: SketchSegment,
  delta: { x: number; y: number },
): SketchSegment[] {
  const ids = new Set<string>();
  for (const p of seg.points) if (p.id) ids.add(p.id);
  return segments.map(s => {
    const own = s === seg;
    if (!own && !s.points.some(p => p.id !== undefined && ids.has(p.id))) return s;
    return {
      ...s,
      points: s.points.map(p =>
        own || (p.id !== undefined && ids.has(p.id))
          ? { ...p, x: p.x + delta.x, y: p.y + delta.y }
          : p,
      ),
    };
  });
}

/**
 * Drag-solve for a whole segment body (edge drag): translate the segment with
 * id `segmentId` by `delta` while keeping all constraints + locked dimensions
 * satisfied. `delta` is measured against the geometry in `segments` — callers
 * implementing a gesture should pass the GESTURE-START segments together with
 * the cumulative cursor delta each frame (absolute targets, no drift).
 *
 * Outcomes mirror `dragSolve` (free / moved / blocked-fixed /
 * blocked-unsolvable); an unknown `segmentId` reports blocked-unsolvable.
 */
export function dragSolveSegment(
  segments: SketchSegment[],
  constraints: SketchConstraint[],
  dimensions: SketchDimension[],
  segmentId: string,
  delta: { x: number; y: number },
  opts: DragSolveOptions = {},
): DragSolveResult {
  const seg = segments.find(s => s.id === segmentId);
  if (!seg || seg.points.length === 0) {
    return { segments, outcome: 'blocked-unsolvable', residual: Number.POSITIVE_INFINITY };
  }

  const hasLockedDims = dimensions.some(d => d.locked);

  // Plain drag when there is no constraint system at all (existing behavior
  // for zero-constraint sketches: rigid raw translation).
  if (constraints.length === 0 && !hasLockedDims) {
    return { segments: translateSegmentRaw(segments, seg, delta), outcome: 'free', residual: 0 };
  }

  // A `fixed` constraint can target the segment id itself (single-entity
  // constraint UI) — the whole body is anchored.
  if (constraints.some(c => c.type === 'fixed' && c.entityIds[0] === segmentId)) {
    return { segments, outcome: 'blocked-fixed', residual: 0 };
  }

  const { vars, x } = buildVars(segments, constraints);

  // Collect the pin rows: each pinnable defining point targets its current
  // position + delta. Fixed points are excluded from the variable set by
  // buildVars, so they simply contribute no pin.
  const pins: { ix: number; iy: number; tx: number; ty: number }[] = [];
  let pinnableIds = 0;
  for (const i of segmentPinIndices(seg)) {
    const p = seg.points[i];
    if (!p?.id) continue;
    pinnableIds++;
    const k = vars.idx.get(p.id);
    if (!k) continue; // fixed — immovable, no pin row
    pins.push({ ix: k[0], iy: k[1], tx: p.x + delta.x, ty: p.y + delta.y });
  }

  if (pinnableIds === 0) {
    // No id'd defining points → invisible to the solver; raw translate is safe.
    return { segments: translateSegmentRaw(segments, seg, delta), outcome: 'free', residual: 0 };
  }
  if (pins.length === 0) {
    // Every pinnable defining point carries `fixed` — body cannot be dragged.
    return { segments, outcome: 'blocked-fixed', residual: 0 };
  }

  const { residuals } = buildResiduals(segments, constraints, dimensions, vars);

  // Warm start: translate ALL of the segment's free points by delta so the
  // unpinned handles (circle edge, ellipse rx/ry, slot radius pt) ride along
  // rigidly unless a constraint pulls them elsewhere. With zero residual
  // rows (e.g. only `fixed` constraints, which are enforced by variable
  // elimination) this warm start IS the whole move — free points translate,
  // fixed points stay anchored.
  for (const p of seg.points) {
    if (!p.id) continue;
    // W3-E: a coupled circle rim's slots store the centre-relative offset,
    // which is translation-invariant — the rim rides along automatically
    // once its centre slot is translated. Overwriting the offset with an
    // absolute position would corrupt the radius.
    if (vars.rimOf.has(p.id)) continue;
    const k = vars.idx.get(p.id);
    if (!k) continue;
    x[k[0]] = p.x + delta.x;
    x[k[1]] = p.y + delta.y;
  }

  let cErr = 0;
  if (residuals.length > 0) {
    const w = opts.pinWeight ?? 1;
    const tol = opts.tolerance ?? 1e-4;

    // Phase 1 — constraints + multi-point soft cursor pin.
    const pinnedRs: Residual[] = [...residuals];
    for (const pin of pins) {
      pinnedRs.push(xv => w * (xv[pin.ix] - pin.tx));
      pinnedRs.push(xv => w * (xv[pin.iy] - pin.ty));
    }
    runLm(pinnedRs, x, opts.maxPinnedIterations ?? 30, tol);

    // Phase 2 — polish constraints exactly (pins removed).
    cErr = runLm(residuals, x, opts.maxPolishIterations ?? 20, tol);

    if (cErr > Math.max(tol, 1e-3)) {
      return { segments, outcome: 'blocked-unsolvable', residual: cErr };
    }
  }

  // Write back: solved coordinates for id'd points; anonymous points of the
  // dragged segment translate raw (the solver can't see them).
  // readPointFromState (not raw slots): coupled rims store offsets.
  const next = segments.map(sg => ({
    ...sg,
    points: sg.points.map(p => {
      if (!p.id) {
        return sg === seg ? { ...p, x: p.x + delta.x, y: p.y + delta.y } : p;
      }
      if (!vars.idx.has(p.id)) return p; // fixed or unknown — untouched
      const abs = readPointFromState(p.id, x, vars)!;
      return { ...p, x: abs.x, y: abs.y };
    }),
  }));
  return { segments: next, outcome: 'moved', residual: cErr };
}
