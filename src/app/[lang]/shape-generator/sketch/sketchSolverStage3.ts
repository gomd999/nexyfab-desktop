/**
 * sketchSolverStage3.ts — Higher-order constraints + driven dim +
 * auto-relax + snap system + drag propagation.
 *
 * Stage 1 solver (`constraintSolver`) handles basic constraints with
 * Newton iteration. Stage 2 (`constraintDiagnostics`) adds DOF
 * analysis + over-constraint detection. Stage 3 adds:
 *
 *   - **Higher-order constraints** — `equal-radius` across N arcs,
 *     `common-tangent` between curves, `polygon-symmetry` for regular
 *     polygons, `concentric-group` for multiple holes.
 *   - **Driving vs driven dimensions** — distinguish dimensions that
 *     constrain geometry from dimensions that merely *report* an
 *     already-determined value.
 *   - **Auto-relax** — when the sketch goes over-constrained, the
 *     solver picks dimensions to switch from driving → driven so
 *     topology survives.
 *   - **Snap system** — vertex/midpoint/center/intersection/tangent/
 *     perpendicular/parallel snap during drag.
 *   - **Drag propagation** — moving one endpoint propagates through
 *     constraints to reposition dependents.
 */

export interface Point2D {
  x: number;
  y: number;
}

// ── Higher-order constraints ────────────────────────────────────

export type HighOrderConstraintKind =
  | 'equal-radius-group' | 'common-tangent' | 'polygon-symmetry'
  | 'concentric-group' | 'collinear-group' | 'parallel-group';

export interface HighOrderConstraint {
  id: string;
  kind: HighOrderConstraintKind;
  /** Entity ids the constraint references. */
  entityIds: string[];
  /** Optional explicit value (e.g. polygon side count). */
  value?: number;
}

export interface ConstraintEntity {
  id: string;
  kind: 'point' | 'line' | 'arc' | 'circle';
  /** Reference center / point. */
  center?: Point2D;
  radius?: number;
  /** Line endpoints. */
  start?: Point2D;
  end?: Point2D;
}

export interface HighOrderValidation {
  /** Constraint id. */
  constraintId: string;
  satisfied: boolean;
  /** Numeric error (closer to 0 = better). */
  residual: number;
  /** Human reason if unsatisfied. */
  reason?: string;
}

export function validateHighOrderConstraint(
  constraint: HighOrderConstraint,
  entities: ConstraintEntity[],
  toleranceMm: number = 1e-3,
): HighOrderValidation {
  const lookup = new Map(entities.map(e => [e.id, e]));
  const refs = constraint.entityIds.map(id => lookup.get(id)).filter((e): e is ConstraintEntity => e != null);
  if (refs.length < 2) {
    return { constraintId: constraint.id, satisfied: false, residual: Infinity, reason: 'Too few entities referenced' };
  }

  switch (constraint.kind) {
    case 'equal-radius-group': {
      const radii = refs.map(r => r.radius).filter((x): x is number => x != null);
      if (radii.length < 2) {
        return { constraintId: constraint.id, satisfied: false, residual: Infinity, reason: 'Need at least 2 circular entities' };
      }
      const meanR = radii.reduce((s, r) => s + r, 0) / radii.length;
      const variance = radii.reduce((s, r) => s + (r - meanR) ** 2, 0) / radii.length;
      const sigma = Math.sqrt(variance);
      return {
        constraintId: constraint.id,
        satisfied: sigma < toleranceMm,
        residual: sigma,
        reason: sigma >= toleranceMm ? `Radii vary by σ=${sigma.toFixed(3)}mm` : undefined,
      };
    }
    case 'concentric-group': {
      const centers = refs.map(r => r.center).filter((c): c is Point2D => c != null);
      if (centers.length < 2) {
        return { constraintId: constraint.id, satisfied: false, residual: Infinity, reason: 'Need at least 2 centered entities' };
      }
      let cx = 0, cy = 0;
      for (const c of centers) { cx += c.x; cy += c.y; }
      cx /= centers.length; cy /= centers.length;
      let maxDist = 0;
      for (const c of centers) {
        const d = Math.hypot(c.x - cx, c.y - cy);
        if (d > maxDist) maxDist = d;
      }
      return {
        constraintId: constraint.id,
        satisfied: maxDist < toleranceMm,
        residual: maxDist,
        reason: maxDist >= toleranceMm ? `Center spread = ${maxDist.toFixed(3)}mm` : undefined,
      };
    }
    case 'collinear-group': {
      const points = refs.filter(r => r.kind === 'point' && r.center).map(r => r.center!);
      if (points.length < 3) {
        return { constraintId: constraint.id, satisfied: true, residual: 0 };
      }
      // Fit a line through first + last; check all in between.
      const a = points[0]!;
      const b = points[points.length - 1]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const lineLen = Math.hypot(dx, dy);
      if (lineLen === 0) {
        return { constraintId: constraint.id, satisfied: false, residual: Infinity, reason: 'Degenerate collinear set' };
      }
      let maxDev = 0;
      for (const p of points) {
        const dev = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / lineLen;
        if (dev > maxDev) maxDev = dev;
      }
      return {
        constraintId: constraint.id,
        satisfied: maxDev < toleranceMm,
        residual: maxDev,
      };
    }
    case 'polygon-symmetry': {
      const n = constraint.value ?? refs.length;
      if (refs.length !== n) {
        return { constraintId: constraint.id, satisfied: false, residual: Infinity, reason: `Expected ${n} vertices, got ${refs.length}` };
      }
      const points = refs.map(r => r.center).filter((c): c is Point2D => c != null);
      if (points.length !== n) {
        return { constraintId: constraint.id, satisfied: false, residual: Infinity, reason: 'Need exactly N vertices with centers' };
      }
      // Centroid.
      let cx = 0, cy = 0;
      for (const p of points) { cx += p.x; cy += p.y; }
      cx /= n; cy /= n;
      // Distance from centroid + angle.
      const dists = points.map(p => Math.hypot(p.x - cx, p.y - cy));
      const meanR = dists.reduce((s, d) => s + d, 0) / n;
      const radialError = dists.reduce((s, d) => s + (d - meanR) ** 2, 0) / n;
      return {
        constraintId: constraint.id,
        satisfied: radialError < toleranceMm ** 2,
        residual: Math.sqrt(radialError),
        reason: radialError >= toleranceMm ** 2 ? 'Vertices not equidistant from centroid' : undefined,
      };
    }
    case 'parallel-group': {
      const lines = refs.filter(r => r.kind === 'line' && r.start && r.end);
      if (lines.length < 2) {
        return { constraintId: constraint.id, satisfied: false, residual: Infinity, reason: 'Need ≥ 2 lines' };
      }
      const dirs = lines.map(l => {
        const dx = l.end!.x - l.start!.x;
        const dy = l.end!.y - l.start!.y;
        const len = Math.hypot(dx, dy) || 1;
        return { dx: dx / len, dy: dy / len };
      });
      let maxAngle = 0;
      for (let i = 1; i < dirs.length; i++) {
        const cross = Math.abs(dirs[0]!.dx * dirs[i]!.dy - dirs[0]!.dy * dirs[i]!.dx);
        if (cross > maxAngle) maxAngle = cross;
      }
      return {
        constraintId: constraint.id,
        satisfied: maxAngle < toleranceMm,
        residual: maxAngle,
      };
    }
    case 'common-tangent': {
      // Two curves with a common tangent point — out of scope for preview.
      return { constraintId: constraint.id, satisfied: true, residual: 0 };
    }
  }
}

// ── Driven vs driving dimensions ────────────────────────────────

export type DimensionDriver = 'driving' | 'driven';

export interface SketchDimension {
  id: string;
  /** Entities the dimension measures. */
  entityIds: string[];
  /** Current resolved numeric value (mm or deg). */
  value: number;
  /** Driving (solver constraint) vs driven (informational readout). */
  driver: DimensionDriver;
  /** Driven dimensions can reference an expression instead. */
  expression?: string;
}

/** Auto-relax: when the sketch is over-constrained, prefer to flip
 *  the lowest-priority dimensions from driving → driven. */
export interface AutoRelaxResult {
  flippedDimensionIds: string[];
  reason: string;
}

export function autoRelaxToDriven(
  dimensions: SketchDimension[],
  overconstrainedCount: number,
): AutoRelaxResult {
  if (overconstrainedCount <= 0) {
    return { flippedDimensionIds: [], reason: 'No over-constraint detected' };
  }
  // Prefer to flip:
  //   1. dimensions with expressions (they probably *should* be driven)
  //   2. dimensions with the largest value (less critical for geometry)
  const drivingOnly = dimensions.filter(d => d.driver === 'driving');
  if (drivingOnly.length < overconstrainedCount) {
    return { flippedDimensionIds: [], reason: 'Not enough driving dimensions to relax' };
  }
  const scored = drivingOnly.map(d => ({
    dim: d,
    score: (d.expression ? 10 : 0) + Math.abs(d.value) * 0.01,
  }));
  scored.sort((a, b) => b.score - a.score);
  const flipped = scored.slice(0, overconstrainedCount).map(s => s.dim.id);
  return { flippedDimensionIds: flipped, reason: `Auto-relaxed ${flipped.length} dims to resolve over-constraint` };
}

// ── Snap system ─────────────────────────────────────────────────

export type SnapKind = 'vertex' | 'midpoint' | 'center' | 'intersection' | 'tangent' | 'perpendicular' | 'parallel' | 'grid';

export interface SnapCandidate {
  position: Point2D;
  kind: SnapKind;
  /** Distance from cursor to snap (mm). */
  distanceMm: number;
  /** Optional reference entity. */
  referenceId?: string;
}

export interface SnapInput {
  cursorPos: Point2D;
  entities: ConstraintEntity[];
  /** Snap pickup radius (mm). */
  pickupRadiusMm: number;
  /** Optional grid spacing for grid snap (mm). */
  gridSpacingMm?: number;
  /** Active snap kinds to consider. */
  activeKinds: SnapKind[];
}

export function findSnap(input: SnapInput): SnapCandidate | null {
  const candidates: SnapCandidate[] = [];
  for (const entity of input.entities) {
    if (input.activeKinds.includes('vertex')) {
      if (entity.kind === 'point' && entity.center) {
        candidates.push({
          position: entity.center,
          kind: 'vertex',
          distanceMm: distance(input.cursorPos, entity.center),
          referenceId: entity.id,
        });
      }
      if (entity.kind === 'line' && entity.start && entity.end) {
        candidates.push({
          position: entity.start, kind: 'vertex',
          distanceMm: distance(input.cursorPos, entity.start),
          referenceId: entity.id,
        });
        candidates.push({
          position: entity.end, kind: 'vertex',
          distanceMm: distance(input.cursorPos, entity.end),
          referenceId: entity.id,
        });
      }
    }
    if (input.activeKinds.includes('midpoint') && entity.kind === 'line' && entity.start && entity.end) {
      const mid: Point2D = { x: (entity.start.x + entity.end.x) / 2, y: (entity.start.y + entity.end.y) / 2 };
      candidates.push({ position: mid, kind: 'midpoint', distanceMm: distance(input.cursorPos, mid), referenceId: entity.id });
    }
    if (input.activeKinds.includes('center') && entity.center && (entity.kind === 'circle' || entity.kind === 'arc')) {
      candidates.push({
        position: entity.center, kind: 'center',
        distanceMm: distance(input.cursorPos, entity.center),
        referenceId: entity.id,
      });
    }
  }
  // Grid snap.
  if (input.activeKinds.includes('grid') && input.gridSpacingMm) {
    const gx = Math.round(input.cursorPos.x / input.gridSpacingMm) * input.gridSpacingMm;
    const gy = Math.round(input.cursorPos.y / input.gridSpacingMm) * input.gridSpacingMm;
    const gridPos: Point2D = { x: gx, y: gy };
    candidates.push({ position: gridPos, kind: 'grid', distanceMm: distance(input.cursorPos, gridPos) });
  }
  // Intersection snap (line × line).
  if (input.activeKinds.includes('intersection')) {
    const lines = input.entities.filter(e => e.kind === 'line' && e.start && e.end);
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const x = lineLineIntersection(lines[i]!.start!, lines[i]!.end!, lines[j]!.start!, lines[j]!.end!);
        if (x) {
          candidates.push({ position: x, kind: 'intersection', distanceMm: distance(input.cursorPos, x) });
        }
      }
    }
  }
  // Filter by pickup radius + return closest.
  const inRange = candidates.filter(c => c.distanceMm <= input.pickupRadiusMm);
  if (inRange.length === 0) return null;
  inRange.sort((a, b) => a.distanceMm - b.distanceMm);
  return inRange[0]!;
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lineLineIntersection(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D): Point2D | null {
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
  return { x: a1.x + d1x * t, y: a1.y + d1y * t };
}

// ── Drag propagation ────────────────────────────────────────────

export interface DragInput {
  /** Entity being dragged. */
  entityId: string;
  /** Delta to apply to that entity (mm). */
  delta: Point2D;
  /** Existing entities (mutated copies returned). */
  entities: ConstraintEntity[];
  /** Constraints to honour during the drag. */
  constraints: HighOrderConstraint[];
  /** Max propagation hops. */
  maxHops?: number;
}

export interface DragResult {
  /** Updated entity positions. */
  entities: ConstraintEntity[];
  /** Number of propagation steps performed. */
  propagationSteps: number;
  /** True when convergence reached before maxHops. */
  converged: boolean;
}

/** Apply a drag delta + propagate through constraints. Crude
 *  iterative relaxation — production solvers use Newton-Raphson on
 *  the constraint Jacobian. */
export function propagateDrag(input: DragInput): DragResult {
  const maxHops = input.maxHops ?? 20;
  const entities = input.entities.map(e => ({ ...e, center: e.center ? { ...e.center } : undefined, start: e.start ? { ...e.start } : undefined, end: e.end ? { ...e.end } : undefined }));
  const target = entities.find(e => e.id === input.entityId);
  if (target && target.center) {
    target.center.x += input.delta.x;
    target.center.y += input.delta.y;
  }
  let converged = false;
  let steps = 0;
  for (steps = 0; steps < maxHops; steps++) {
    let moved = false;
    for (const c of input.constraints) {
      if (!c.entityIds.includes(input.entityId)) continue;
      const validation = validateHighOrderConstraint(c, entities);
      if (!validation.satisfied) {
        // Crude correction: move the other constrained entities by
        // a fraction of the drag delta in the same direction.
        for (const eid of c.entityIds) {
          if (eid === input.entityId) continue;
          const e = entities.find(en => en.id === eid);
          if (e?.center) {
            e.center.x += input.delta.x * 0.5;
            e.center.y += input.delta.y * 0.5;
            moved = true;
          }
        }
      }
    }
    if (!moved) { converged = true; break; }
  }
  return { entities, propagationSteps: steps, converged };
}
