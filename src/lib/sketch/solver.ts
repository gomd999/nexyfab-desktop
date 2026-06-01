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

// ---------- internal state ----------

interface PointRecord {
  id: PointId;
  fixed: boolean;
}

interface ConstraintRecord {
  id: ConstraintId;
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
    return this.pushConstraint({ type: 'p2p_coincident', p1_id: p1, p2_id: p2 });
  }

  /** Two lines are parallel. */
  addParallel(l1: LineId, l2: LineId): ConstraintId {
    return this.pushConstraint({ type: 'parallel', l1_id: l1, l2_id: l2 });
  }

  /** Two lines are perpendicular. */
  addPerpendicular(l1: LineId, l2: LineId): ConstraintId {
    return this.pushConstraint({ type: 'perpendicular_ll', l1_id: l1, l2_id: l2 });
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
      return this.pushConstraint({ type: 'tangent_lc', l_id: a, c_id: b });
    }
    if (aKind === 'circle' && bKind === 'line') {
      return this.pushConstraint({ type: 'tangent_lc', l_id: b, c_id: a });
    }
    if (aKind === 'line' && bKind === 'arc') {
      return this.pushConstraint({ type: 'tangent_la', l_id: a, a_id: b });
    }
    if (aKind === 'arc' && bKind === 'line') {
      return this.pushConstraint({ type: 'tangent_la', l_id: b, a_id: a });
    }
    if (aKind === 'circle' && bKind === 'circle') {
      return this.pushConstraint({ type: 'tangent_cc', c1_id: a, c2_id: b });
    }
    throw new Error(
      `addTangent: unsupported geometry combination ${aKind}/${bKind}. ` +
        `Phase 1.2 supports line/circle, line/arc, circle/circle.`,
    );
  }

  /** Line lies parallel to the X axis. */
  addHorizontal(l: LineId): ConstraintId {
    return this.pushConstraint({ type: 'horizontal_l', l_id: l });
  }

  /** Line lies parallel to the Y axis. */
  addVertical(l: LineId): ConstraintId {
    return this.pushConstraint({ type: 'vertical_l', l_id: l });
  }

  // ----- constraints: dimensional (3 types) -----

  /** Pin the distance between two points. */
  addDistance(p1: PointId, p2: PointId, distance: number): ConstraintId {
    return this.pushConstraint({ type: 'p2p_distance', p1_id: p1, p2_id: p2, distance });
  }

  /** Pin the angle (radians) between two lines. */
  addAngle(l1: LineId, l2: LineId, angleRadians: number): ConstraintId {
    return this.pushConstraint({ type: 'l2l_angle_ll', l1_id: l1, l2_id: l2, angle: angleRadians });
  }

  /** Pin a circle's or arc's radius. */
  addRadius(geometry: CircleId | ArcId, radius: number): ConstraintId {
    const kind = this.kindOf(geometry);
    if (kind === 'circle') {
      return this.pushConstraint({ type: 'circle_radius', c_id: geometry, radius });
    }
    if (kind === 'arc') {
      return this.pushConstraint({ type: 'arc_radius', a_id: geometry, radius });
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

  // ----- lifecycle -----

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gcs.destroy_gcs_module();
  }

  // ----- internals -----

  private pushConstraint(body: Record<string, unknown>): ConstraintId {
    this.assertAlive();
    const id = this.fresh<ConstraintId>('k');
    this.constraints.set(id, { id });
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
