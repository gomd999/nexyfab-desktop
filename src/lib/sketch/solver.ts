/**
 * SketchSolver — typed facade over @salusoft89/planegcs.
 *
 * Phase 1.2 of NexyFab Pro own-CAD roadmap (ADR-013).
 *
 * Wraps the raw `GcsWrapper` (which speaks in JSON primitive arrays) with
 * an ergonomic, mutation-friendly API:
 *
 *   const s = await createSketchSolver();
 *   const p1 = s.addPoint(0, 0, { fixed: true });
 *   const p2 = s.addPoint(10, 3);
 *   const line = s.addLine(p1, p2);
 *   s.addHorizontal(line);
 *   const result = s.solve();
 *   s.point(p2).y === 0
 *
 * Constraint types exposed (Phase 1.2 acceptance gate — 9 types):
 *   geometric:    coincident, parallel, perpendicular, tangent, horizontal, vertical
 *   dimensional:  distance, angle, radius
 *
 * Intentionally NOT exposed (planegcs README warns these misbehave in
 * non-driving / reference mode — restrict to Phase 2+):
 *   circle_diameter, arc_diameter, arc_length
 *   (p2l_distance, c2c_distance also flagged in README — use driving only.)
 */

import { createGcsWrapper, type GcsWrapper } from './planegcs';

 
// Structural shapes for planegcs primitives. We deliberately don't import
// the real types from '@salusoft89/planegcs' here because even `import type`
// triggers webpack to trace the Emscripten WASM module (see planegcs.ts).
// Values are 1:1 with the package's interfaces; if upstream changes, the
// runtime smoke test catches the drift.
interface SketchPoint { id: string; type: 'point'; x: number; y: number; fixed: boolean }
interface SketchLine { id: string; type: 'line'; p1_id: string; p2_id: string }
interface SketchCircle { id: string; type: 'circle'; c_id: string; radius: number }
interface SketchArc {
  id: string; type: 'arc'; c_id: string; start_id: string; end_id: string;
  radius: number; start_angle: number; end_angle: number;
}

/**
 * Locally-defined enums mirroring `@salusoft89/planegcs`'s SolveStatus +
 * Algorithm. Re-defined here so this module never statically imports the
 * planegcs package (which would drag its Emscripten WASM through
 * webpack's static analyzer and break the browser build — see
 * planegcs.ts comment for the full story).
 *
 * Values are 1:1 with planegcs's enums (verified against
 * node_modules/@salusoft89/planegcs/dist/planegcs_dist/enums.js).
 * If planegcs ever renumbers them, both sides need updating — flagged
 * by the runtime smoke test which checks Success == 0.
 */
export enum SolveStatus {
  Success = 0,
  Converged = 1,
  Failed = 2,
  SuccessfulSolutionInvalid = 3,
}

export enum Algorithm {
  BFGS = 0,
  LevenbergMarquardt = 1,
  DogLeg = 2,
}

// ---------- public types ----------

export type PointId = string & { readonly __brand: 'PointId' };
export type LineId = string & { readonly __brand: 'LineId' };
export type CircleId = string & { readonly __brand: 'CircleId' };
export type ArcId = string & { readonly __brand: 'ArcId' };
export type ConstraintId = string & { readonly __brand: 'ConstraintId' };
export type EntityId = PointId | LineId | CircleId | ArcId;

export interface AddPointOptions {
  /** If true, the point's coordinates are pinned and the solver will not move it. */
  fixed?: boolean;
}

export interface SolveResult {
  status: SolveStatus;
  /** True if planegcs returned `Success` (no failure to converge). */
  success: boolean;
  /** Constraint IDs that conflict with the rest of the system (system has no solution). */
  conflicting: ConstraintId[];
  /** Constraint IDs flagged as fully redundant (always satisfied — safely droppable). */
  redundant: ConstraintId[];
  /** Constraint IDs flagged as partially redundant (overlap with others). */
  partiallyRedundant: ConstraintId[];
  /**
   * Degrees of freedom remaining in the GCS system (planegcs authoritative).
   *
   * dof === 0  → fully constrained
   * dof  >  0  → under-constrained (free to drag)
   * dof  <  0  → over-constrained (planegcs may still solve via least-squares)
   */
  dof: number;
}

// ---------- Phase 1.B overlay accessor: serialized constraint snapshot ----------
//
// `SerializedConstraint` is a view-friendly projection of every constraint
// currently registered with the solver. Wrappers (e.g. SketchConstraintOverlay)
// can use this to render visual badges/dim-lines without poking at planegcs
// internals.
//
// `kind` is the same vocabulary as the facade `addX` methods (horizontal,
// vertical, parallel, perpendicular, coincident, distance, angle, tangent,
// radius). `refs` is an ordered list of entity ids — exact layout per kind:
//
//   horizontal/vertical/radius : [lineId | circleId | arcId]
//   parallel/perpendicular/    : [lineId, lineId]   (or [curveId, curveId] for tangent)
//   tangent                    : [curveAId, curveBId]
//   coincident                 : [pointId, pointId]
//   distance                   : [pointId, pointId]
//   angle                      : [lineId, lineId]
//
// `value` is set for dimensional kinds (distance, angle, radius); undefined
// for purely geometric ones.

export type SerializedConstraintKind =
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'coincident'
  | 'tangent'
  | 'distance'
  | 'angle'
  | 'radius';

export interface SerializedConstraint {
  id: ConstraintId;
  kind: SerializedConstraintKind;
  refs: ReadonlyArray<string>;
  value?: number;
}

// ---------- internal state ----------

interface PointRecord {
  id: PointId;
  fixed: boolean;
}

interface ConstraintRecord {
  id: ConstraintId;
  /** View-side projection (Phase 1.B). Mirrors the addX method that created it. */
  kind: SerializedConstraintKind;
  /** Ordered entity ids the constraint references (see SerializedConstraint comment). */
  refs: ReadonlyArray<string>;
  /** Dimensional value when applicable (distance mm / angle rad / radius). */
  value?: number;
}

// ---------- main class ----------

export class SketchSolver {
  private readonly gcs: GcsWrapper;

  private nextId = 1;
  private readonly points = new Map<PointId, PointRecord>();
  private readonly lines = new Set<LineId>();
  private readonly circles = new Set<CircleId>();
  private readonly arcs = new Set<ArcId>();
  private readonly constraints = new Map<ConstraintId, ConstraintRecord>();

  /** Last-pushed batch — primitives waiting to be sent to planegcs on next solve(). */
  private pending: unknown[] = [];

  private destroyed = false;

  constructor(gcs: GcsWrapper) {
    this.gcs = gcs;
  }

  // ----- ID generation -----

  private fresh<T extends string>(prefix: string): T {
    return `${prefix}${this.nextId++}` as T;
  }

  // ----- geometry: add -----

  addPoint(x: number, y: number, opts: AddPointOptions = {}): PointId {
    this.assertAlive();
    const id = this.fresh<PointId>('p');
    const fixed = opts.fixed === true;
    this.points.set(id, { id, fixed });
    const prim: SketchPoint = { id, type: 'point', x, y, fixed };
    this.pending.push(prim);
    return id;
  }

  addLine(p1: PointId, p2: PointId): LineId {
    this.assertAlive();
    this.assertPoint(p1);
    this.assertPoint(p2);
    const id = this.fresh<LineId>('l');
    this.lines.add(id);
    const prim: SketchLine = { id, type: 'line', p1_id: p1, p2_id: p2 };
    this.pending.push(prim);
    return id;
  }

  addCircle(center: PointId, radius: number): CircleId {
    this.assertAlive();
    this.assertPoint(center);
    const id = this.fresh<CircleId>('c');
    this.circles.add(id);
    const prim: SketchCircle = { id, type: 'circle', c_id: center, radius };
    this.pending.push(prim);
    return id;
  }

  addArc(
    center: PointId,
    start: PointId,
    end: PointId,
    radius: number,
    startAngle: number,
    endAngle: number,
  ): ArcId {
    this.assertAlive();
    this.assertPoint(center);
    this.assertPoint(start);
    this.assertPoint(end);
    const id = this.fresh<ArcId>('a');
    this.arcs.add(id);
    const prim: SketchArc = {
      id,
      type: 'arc',
      c_id: center,
      start_id: start,
      end_id: end,
      radius,
      start_angle: startAngle,
      end_angle: endAngle,
    };
    this.pending.push(prim);
    return id;
  }

  // ----- constraints: geometric (5 types) -----

  /** Two points share the same location. */
  addCoincident(p1: PointId, p2: PointId): ConstraintId {
    return this.pushConstraint(
      { type: 'p2p_coincident', p1_id: p1, p2_id: p2 },
      'coincident',
      [p1, p2],
    );
  }

  /** Two lines are parallel. */
  addParallel(l1: LineId, l2: LineId): ConstraintId {
    return this.pushConstraint(
      { type: 'parallel', l1_id: l1, l2_id: l2 },
      'parallel',
      [l1, l2],
    );
  }

  /** Two lines are perpendicular. */
  addPerpendicular(l1: LineId, l2: LineId): ConstraintId {
    return this.pushConstraint(
      { type: 'perpendicular_ll', l1_id: l1, l2_id: l2 },
      'perpendicular',
      [l1, l2],
    );
  }

  /**
   * Tangency between two curves. Variants auto-picked by geometry types:
   *   line/circle, line/arc, circle/circle.
   * For other combinations, extend in Phase 2 (wider geometry support).
   */
  addTangent(
    a: LineId | CircleId | ArcId,
    b: LineId | CircleId | ArcId,
  ): ConstraintId {
    const aKind = this.kindOf(a);
    const bKind = this.kindOf(b);
    if (aKind === 'line' && bKind === 'circle') {
      return this.pushConstraint({ type: 'tangent_lc', l_id: a, c_id: b }, 'tangent', [a, b]);
    }
    if (aKind === 'circle' && bKind === 'line') {
      return this.pushConstraint({ type: 'tangent_lc', l_id: b, c_id: a }, 'tangent', [a, b]);
    }
    if (aKind === 'line' && bKind === 'arc') {
      return this.pushConstraint({ type: 'tangent_la', l_id: a, a_id: b }, 'tangent', [a, b]);
    }
    if (aKind === 'arc' && bKind === 'line') {
      return this.pushConstraint({ type: 'tangent_la', l_id: b, a_id: a }, 'tangent', [a, b]);
    }
    if (aKind === 'circle' && bKind === 'circle') {
      return this.pushConstraint({ type: 'tangent_cc', c1_id: a, c2_id: b }, 'tangent', [a, b]);
    }
    throw new Error(
      `addTangent: unsupported geometry combination ${aKind}/${bKind}. ` +
        `Phase 1.2 supports line/circle, line/arc, circle/circle.`,
    );
  }

  /** Line lies parallel to the X axis. */
  addHorizontal(l: LineId): ConstraintId {
    return this.pushConstraint({ type: 'horizontal_l', l_id: l }, 'horizontal', [l]);
  }

  /** Line lies parallel to the Y axis. */
  addVertical(l: LineId): ConstraintId {
    return this.pushConstraint({ type: 'vertical_l', l_id: l }, 'vertical', [l]);
  }

  // ----- constraints: dimensional (3 types) -----

  /** Pin the distance between two points. */
  addDistance(p1: PointId, p2: PointId, distance: number): ConstraintId {
    return this.pushConstraint(
      { type: 'p2p_distance', p1_id: p1, p2_id: p2, distance },
      'distance',
      [p1, p2],
      distance,
    );
  }

  /** Pin the angle (radians) between two lines. */
  addAngle(l1: LineId, l2: LineId, angleRadians: number): ConstraintId {
    return this.pushConstraint(
      { type: 'l2l_angle_ll', l1_id: l1, l2_id: l2, angle: angleRadians },
      'angle',
      [l1, l2],
      angleRadians,
    );
  }

  /** Pin a circle's or arc's radius. */
  addRadius(geometry: CircleId | ArcId, radius: number): ConstraintId {
    const kind = this.kindOf(geometry);
    if (kind === 'circle') {
      return this.pushConstraint(
        { type: 'circle_radius', c_id: geometry, radius },
        'radius',
        [geometry],
        radius,
      );
    }
    if (kind === 'arc') {
      return this.pushConstraint(
        { type: 'arc_radius', a_id: geometry, radius },
        'radius',
        [geometry],
        radius,
      );
    }
    throw new Error(`addRadius: ${geometry} is neither circle nor arc`);
  }

  // ----- solve + read -----

  solve(algorithm: Algorithm = Algorithm.DogLeg): SolveResult {
    this.assertAlive();
    if (this.pending.length > 0) {
      this.gcs.push_primitives_and_params(this.pending as never);
      this.pending = [];
    }
    const status = this.gcs.solve(algorithm);
    if (status === SolveStatus.Success) {
      this.gcs.apply_solution();
    }
    const conflicting = this.gcs.get_gcs_conflicting_constraints() as ConstraintId[];
    const redundant = this.gcs.get_gcs_redundant_constraints() as ConstraintId[];
    const partial = this.gcs.get_gcs_partially_redundant_constraints() as ConstraintId[];
    return {
      status,
      success: status === SolveStatus.Success,
      conflicting,
      redundant,
      partiallyRedundant: partial,
      dof: this.gcs.gcs.dof(),
    };
  }

  point(id: PointId): { x: number; y: number; fixed: boolean } {
    this.assertPoint(id);
    const p = this.gcs.sketch_index.get_primitive_or_fail(id) as SketchPoint;
    return { x: p.x, y: p.y, fixed: p.fixed };
  }

  /** Read-only structural lookup of a line (returns its endpoint point IDs). */
  line(id: LineId): { p1: PointId; p2: PointId } {
    if (!this.lines.has(id)) throw new Error(`Expected line id, got: ${id}`);
    const l = this.gcs.sketch_index.get_primitive_or_fail(id) as SketchLine;
    return { p1: l.p1_id as PointId, p2: l.p2_id as PointId };
  }

  /** Read-only structural lookup of a circle. */
  circle(id: CircleId): { center: PointId; radius: number } {
    if (!this.circles.has(id)) throw new Error(`Expected circle id, got: ${id}`);
    const c = this.gcs.sketch_index.get_primitive_or_fail(id) as SketchCircle;
    return { center: c.c_id as PointId, radius: c.radius };
  }

  /** Read-only structural lookup of an arc. */
  arc(id: ArcId): {
    center: PointId; start: PointId; end: PointId;
    radius: number; startAngle: number; endAngle: number;
  } {
    if (!this.arcs.has(id)) throw new Error(`Expected arc id, got: ${id}`);
    const a = this.gcs.sketch_index.get_primitive_or_fail(id) as SketchArc;
    return {
      center: a.c_id as PointId,
      start: a.start_id as PointId,
      end: a.end_id as PointId,
      radius: a.radius,
      startAngle: a.start_angle,
      endAngle: a.end_angle,
    };
  }

  // ----- mutation (for drag UX in Phase 1.3) -----

  /**
   * Move an unfixed point. Caller is expected to call solve() afterwards.
   * Throws if the point is fixed.
   *
   * Writes to planegcs's internal params (not the JS-side sketch_index
   * primitive — that gets refreshed by `apply_solution` after the next solve).
   */
  movePoint(id: PointId, x: number, y: number): void {
    this.assertPoint(id);
    const rec = this.points.get(id);
    if (rec?.fixed) {
      throw new Error(`movePoint: ${id} is fixed`);
    }
    if (this.pending.length > 0) {
      // Sketch_index/p_param_index only populates after push. Flush first.
      this.gcs.push_primitives_and_params(this.pending as never);
      this.pending = [];
    }
    const pos = this.gcs.p_param_index.get(id);
    if (pos === undefined) {
      throw new Error(`movePoint: ${id} has no allocated params`);
    }
    this.gcs.gcs.set_p_param(pos, x, false);
    this.gcs.gcs.set_p_param(pos + 1, y, false);
  }

  // ----- single-field setters (Phase 1.B property panel) -----

  /**
   * Set just the X coord of a point. Equivalent to movePoint(id, x, currentY).
   * Same fixed-point semantics as movePoint.
   */
  setPointX(id: PointId, x: number): void {
    this.assertPoint(id);
    const cur = this.point(id);
    this.movePoint(id, x, cur.y);
  }

  /** Set just the Y coord of a point. Mirror of setPointX. */
  setPointY(id: PointId, y: number): void {
    this.assertPoint(id);
    const cur = this.point(id);
    this.movePoint(id, cur.x, y);
  }

  /**
   * Toggle the "fixed" flag on a point. Mutates both the JS-side record AND
   * the planegcs primitive so a subsequent solve respects the new state.
   *
   * Note: planegcs uses the `fixed` flag at primitive-push time to decide
   * whether to allocate driving params. Toggling after push is a soft
   * update — the next solve still runs against the original param layout,
   * but movePoint() will refuse if rec.fixed=true. For a hard-fix that the
   * solver itself enforces, callers should additionally pin the point
   * (e.g. via two dimension constraints) — Phase 2.
   */
  setPointFixed(id: PointId, fixed: boolean): void {
    this.assertPoint(id);
    const rec = this.points.get(id);
    if (rec) rec.fixed = fixed;
    // Best-effort: also update the primitive's `fixed` flag if pushed already.
    try {
      const p = this.gcs.sketch_index.get_primitive_or_fail(id) as SketchPoint;
      p.fixed = fixed;
    } catch {
      // Not yet pushed — find it in pending and update there.
      for (const prim of this.pending) {
        const pp = prim as SketchPoint;
        if (pp.id === id && pp.type === 'point') {
          pp.fixed = fixed;
          break;
        }
      }
    }
  }

  /**
   * Update the numeric value of an existing dimensional constraint
   * (distance / angle / radius). Mutates both the JS-side `ConstraintRecord`
   * (so the overlay snapshot sees the new value) AND the primitive that
   * was pushed to planegcs (so the next solve reconciles geometry against
   * the new target). Other kinds are silent no-ops — geometric constraints
   * (horizontal/vertical/parallel/perpendicular/coincident/tangent) have
   * no editable value.
   *
   * Phase 1.B inline-edit hook: SketchConstraintOverlay double-clicks a
   * distance/angle label, prompts the user for a new number, and routes
   * the result here. The editor then calls solve() to refresh point
   * positions + dof + status.
   *
   * Validation policy: rejects non-finite values and (for distance/radius)
   * non-positive values. Throws on invalid input rather than silently
   * ignoring — caller can catch + re-display the prompt.
   *
   * Returns `true` if a record/primitive was updated, `false` if the id
   * was unknown OR refers to a non-dimensional constraint.
   */
  setConstraintValue(id: ConstraintId, value: number): boolean {
    this.assertAlive();
    const rec = this.constraints.get(id);
    if (!rec) return false;
    // Only dimensional kinds have editable values.
    if (rec.kind !== 'distance' && rec.kind !== 'angle' && rec.kind !== 'radius') {
      return false;
    }
    if (!Number.isFinite(value)) {
      throw new Error(`setConstraintValue: value must be finite, got ${value}`);
    }
    if ((rec.kind === 'distance' || rec.kind === 'radius') && value <= 0) {
      throw new Error(`setConstraintValue: ${rec.kind} must be > 0, got ${value}`);
    }
    // Update tracking record first so getConstraints() snapshot reflects
    // the new value even if the primitive update below skips (e.g.
    // primitive not yet flushed).
    rec.value = value;
    // Update the primitive's value field so re-pushes / snapshots stay
    // consistent. Field name depends on kind:
    //   distance → 'distance'
    //   angle    → 'angle'
    //   radius   → 'radius'
    const field =
      rec.kind === 'distance' ? 'distance' : rec.kind === 'angle' ? 'angle' : 'radius';
    let primFound = false;
    try {
      const prim = this.gcs.sketch_index.get_primitive_or_fail(id) as Record<string, unknown>;
      prim[field] = value;
      primFound = true;
    } catch {
      // Not yet flushed — find in pending queue.
      for (const p of this.pending) {
        const pp = p as Record<string, unknown>;
        if (pp.id === id) {
          pp[field] = value;
          primFound = true;
          break;
        }
      }
    }
    void primFound;
    // If the constraint has already been pushed to planegcs, its numeric
    // value lives as a (driving=true → fixed) p-param indexed by the
    // constraint id. Mutating the JS-side primitive alone is NOT enough —
    // planegcs's C++ GCS holds the value in its params vector and consults
    // that on every solve. We must write the new value through the param
    // index so the next solve sees the new target.
    //
    // For Phase 1.2 driving constraints (distance/angle/radius), exactly
    // one numeric value is pushed per constraint, at the address returned
    // by `p_param_index.get(c.id)`. We use the GcsSystem's set_p_param
    // (same path movePoint uses). When the index lacks the id (constraint
    // not yet flushed), we skip — the next solve flushes the updated
    // primitive from this.pending and the new value lands then.
    const addr = this.gcs.p_param_index.get(id);
    if (addr !== undefined) {
      // `set_p_param(addr, value, fixed)` — keep fixed=true so the solver
      // treats the value as a hard target (same as initial push).
      this.gcs.gcs.set_p_param(addr, value, true);
    }
    return true;
  }

  /**
   * Set a circle's radius. Mutates the primitive's stored radius so renders
   * pick up the change immediately. If the circle has been pinned via
   * addRadius() the next solve will reconcile (existing pin wins unless
   * the caller separately removes/updates it).
   *
   * Phase 1.B limitation: doesn't add or replace a radius constraint. Use
   * addRadius() if you want the solver to enforce the new value across
   * subsequent re-solves involving constraints that depend on it.
   */
  setCircleRadius(id: CircleId, radius: number): void {
    if (!this.circles.has(id)) throw new Error(`Expected circle id, got: ${id}`);
    if (!Number.isFinite(radius) || radius <= 0) {
      throw new Error(`setCircleRadius: radius must be > 0, got ${radius}`);
    }
    try {
      const c = this.gcs.sketch_index.get_primitive_or_fail(id) as SketchCircle;
      c.radius = radius;
    } catch {
      for (const prim of this.pending) {
        const pp = prim as SketchCircle;
        if (pp.id === id && pp.type === 'circle') {
          pp.radius = radius;
          break;
        }
      }
    }
  }

  /**
   * Set a line's two endpoints in one call by movePoint-ing each endpoint.
   * Each endpoint's fixed-ness is respected (fixed endpoints are left alone).
   */
  setLineEndpoints(
    id: LineId,
    x1: number, y1: number,
    x2: number, y2: number,
  ): void {
    const { p1, p2 } = this.line(id);
    const rec1 = this.points.get(p1);
    const rec2 = this.points.get(p2);
    if (!rec1?.fixed) this.movePoint(p1, x1, y1);
    if (!rec2?.fixed) this.movePoint(p2, x2, y2);
  }

  /**
   * Mutate one or more fields of an arc. Each field is optional. Center
   * coords route through movePoint (respecting fixed); radius/angles are
   * direct primitive mutations (see setCircleRadius caveat).
   */
  setArc(
    id: ArcId,
    fields: Partial<{
      cx: number; cy: number;
      radius: number;
      startAngle: number; endAngle: number;
    }>,
  ): void {
    const cur = this.arc(id);
    if (fields.cx !== undefined || fields.cy !== undefined) {
      const cx = fields.cx ?? this.point(cur.center).x;
      const cy = fields.cy ?? this.point(cur.center).y;
      const rec = this.points.get(cur.center);
      if (!rec?.fixed) this.movePoint(cur.center, cx, cy);
    }
    if (fields.radius !== undefined) {
      if (!Number.isFinite(fields.radius) || fields.radius <= 0) {
        throw new Error(`setArc: radius must be > 0, got ${fields.radius}`);
      }
    }
    try {
      const a = this.gcs.sketch_index.get_primitive_or_fail(id) as SketchArc;
      if (fields.radius !== undefined) a.radius = fields.radius;
      if (fields.startAngle !== undefined) a.start_angle = fields.startAngle;
      if (fields.endAngle !== undefined) a.end_angle = fields.endAngle;
    } catch {
      for (const prim of this.pending) {
        const pp = prim as SketchArc;
        if (pp.id === id && pp.type === 'arc') {
          if (fields.radius !== undefined) pp.radius = fields.radius;
          if (fields.startAngle !== undefined) pp.start_angle = fields.startAngle;
          if (fields.endAngle !== undefined) pp.end_angle = fields.endAngle;
          break;
        }
      }
    }
  }

  // ----- view-side removal (Phase 1.B property panel delete) -----
  //
  // planegcs has no public delete-primitive API exposed by the GcsWrapper
  // we use, so these methods only drop the entity from our internal
  // tracking sets — the underlying primitive becomes orphaned in
  // sketch_index but no constraint or render references it anymore. This
  // matches the existing trim behavior. Hard delete is Phase 2.

  removePoint(id: PointId): void {
    this.points.delete(id);
  }

  removeLine(id: LineId): void {
    this.lines.delete(id);
  }

  removeCircle(id: CircleId): void {
    this.circles.delete(id);
  }

  removeArc(id: ArcId): void {
    this.arcs.delete(id);
  }

  // ----- constraint accessors (Phase 1.B overlay) -----

  /**
   * Snapshot of every constraint currently registered, in the order they
   * were added. Pure read; safe to call from a React render loop.
   *
   * Wrappers use this to drive the visual overlay (SketchConstraintOverlay)
   * without poking at planegcs internals or maintaining a parallel ledger.
   */
  getConstraints(): ReadonlyArray<SerializedConstraint> {
    return Array.from(this.constraints.values(), (rec) => ({
      id: rec.id,
      kind: rec.kind,
      refs: rec.refs,
      value: rec.value,
    }));
  }

  /**
   * Drop a constraint from the JS-side tracking ledger.
   *
   * Phase 1.B caveat: planegcs (the underlying solver) has no public
   * delete-constraint API exposed by GcsWrapper — once a primitive has
   * been pushed via `push_primitives_and_params`, it lives on the C++
   * side until the GCS instance is destroyed. This method therefore
   * only un-registers the constraint from our tracking Map (so it no
   * longer shows up in `getConstraints()` and the next-time-pushed
   * `pending` array stays clean) — the constraint may still affect the
   * very next solve() if it was already flushed.
   *
   * Returns `true` if a record was removed, `false` if `id` was unknown.
   * Callers (e.g. SolverSketchEditor) should `solve()` after to refresh
   * DoF + conflicting/redundant lists.
   */
  removeConstraint(id: ConstraintId): boolean {
    const had = this.constraints.delete(id);
    // Also strip from the pending batch in case the constraint hasn't
    // been flushed to planegcs yet (otherwise we'd push a deleted one).
    if (this.pending.length > 0) {
      this.pending = this.pending.filter((p) => {
        const rec = p as { id?: string };
        return rec.id !== id;
      });
    }
    return had;
  }

  // ----- lifecycle -----

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gcs.destroy_gcs_module();
  }

  // ----- internals -----

  private pushConstraint(
    body: Record<string, unknown>,
    kind: SerializedConstraintKind,
    refs: ReadonlyArray<string>,
    value?: number,
  ): ConstraintId {
    this.assertAlive();
    const id = this.fresh<ConstraintId>('k');
    this.constraints.set(id, { id, kind, refs: [...refs], value });
    this.pending.push({ id, ...body });
    return id;
  }

  private kindOf(id: EntityId): 'point' | 'line' | 'circle' | 'arc' {
    if (this.points.has(id as PointId)) return 'point';
    if (this.lines.has(id as LineId)) return 'line';
    if (this.circles.has(id as CircleId)) return 'circle';
    if (this.arcs.has(id as ArcId)) return 'arc';
    throw new Error(`Unknown entity id: ${id}`);
  }

  private assertPoint(id: PointId): void {
    if (!this.points.has(id)) {
      throw new Error(`Expected point id, got: ${id}`);
    }
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error('SketchSolver has been destroyed');
    }
  }

}

export async function createSketchSolver(): Promise<SketchSolver> {
  const gcs = await createGcsWrapper();
  return new SketchSolver(gcs);
}
