/**
 * constraintDiagnostics.ts — DOF analysis + conflict diagnosis +
 * auto-constraint suggestions for the sketch solver.
 *
 * Stage 1 (`constraintSolver.ts`) solves a constraint system + reports
 * status (ok/over-defined/under-defined/inconsistent). Stage 2 (here)
 * answers the *why*: which entities are under-determined, which
 * constraint over-constrains, and what additional constraints would
 * naturally apply based on the user's draft geometry.
 *
 * Three diagnostic surfaces:
 *
 *   1. **DOF table** — per-entity remaining degrees of freedom.
 *      Points have 2 DOF (x, y), lines have 4 DOF (two endpoints),
 *      circles have 3 DOF (center.x, center.y, radius). Each
 *      constraint subtracts DOF.
 *
 *   2. **Conflict detector** — runs the dimension-target system
 *      one constraint at a time and reports which addition first
 *      makes the system over-determined. Useful for "this last
 *      dimension was redundant" warnings.
 *
 *   3. **Auto-constraint suggestions** — given a new entity the
 *      user just drew, suggest constraints to nearby entities
 *      (snap-to-horizontal if angle < 5°, parallel if close to
 *      existing line angle, coincident if endpoint near another).
 */

import type { ConstraintType } from './types';

export interface SketchEntity {
  id: string;
  kind: 'point' | 'line' | 'circle' | 'arc';
  /** Free-form params used only for DOF math here. */
  params?: Record<string, number>;
}

export interface ConstraintRef {
  id: string;
  type: ConstraintType;
  entityIds: string[];
}

const DOF_PER_ENTITY: Record<SketchEntity['kind'], number> = {
  point: 2,
  line: 4,
  circle: 3,
  arc: 5, // center + radius + start + end angle
};

const DOF_REDUCTION: Record<ConstraintType, number> = {
  horizontal: 1,
  vertical: 1,
  perpendicular: 1,
  parallel: 1,
  tangent: 1,
  coincident: 2,
  concentric: 2,
  equal: 1,
  symmetric: 1,
  midpoint: 1,
  angle: 1,
  distance: 1,
  fixed: 2,
};

// ── DOF Analysis ─────────────────────────────────────────────────

export interface DofRow {
  entityId: string;
  kind: SketchEntity['kind'];
  intrinsicDof: number;
  constrained: number;
  remaining: number;
  /** Constraint IDs that touch this entity. */
  constraintsApplied: string[];
}

export interface DofReport {
  rows: DofRow[];
  /** Total DOF after constraints. */
  totalRemainingDof: number;
  /** Total DOF before constraints. */
  totalIntrinsicDof: number;
  /** True when totalRemaining = 0. */
  fullyDetermined: boolean;
  /** True when totalRemaining < 0 (over-constrained). */
  overDetermined: boolean;
}

export function analyzeDof(
  entities: SketchEntity[],
  constraints: ConstraintRef[],
): DofReport {
  const constraintsByEntity = new Map<string, string[]>();
  const dofReductionByEntity = new Map<string, number>();

  for (const c of constraints) {
    const reduction = DOF_REDUCTION[c.type];
    // Constraint shared across N entities — reduction is divided.
    const share = reduction / Math.max(1, c.entityIds.length);
    for (const eid of c.entityIds) {
      if (!constraintsByEntity.has(eid)) constraintsByEntity.set(eid, []);
      constraintsByEntity.get(eid)!.push(c.id);
      dofReductionByEntity.set(eid, (dofReductionByEntity.get(eid) ?? 0) + share);
    }
  }

  const rows: DofRow[] = entities.map(e => {
    const intrinsic = DOF_PER_ENTITY[e.kind];
    const constrained = dofReductionByEntity.get(e.id) ?? 0;
    return {
      entityId: e.id,
      kind: e.kind,
      intrinsicDof: intrinsic,
      constrained,
      remaining: intrinsic - constrained,
      constraintsApplied: constraintsByEntity.get(e.id) ?? [],
    };
  });

  const totalIntrinsic = rows.reduce((s, r) => s + r.intrinsicDof, 0);
  const totalRemaining = rows.reduce((s, r) => s + r.remaining, 0);

  return {
    rows,
    totalRemainingDof: totalRemaining,
    totalIntrinsicDof: totalIntrinsic,
    fullyDetermined: totalRemaining === 0,
    overDetermined: totalRemaining < 0,
  };
}

// ── Conflict Detector ────────────────────────────────────────────

export interface ConflictReport {
  /** Sequence position of the first constraint that flipped the
   *  system into over-determined. Null = no conflict. */
  firstConflictAt: number | null;
  /** Constraint id that triggered the conflict (when reported). */
  conflictingConstraintId: string | null;
}

/** Replay constraints in order; report when the cumulative DOF goes
 *  negative. Useful for "you can drop this dimension — it's implied". */
export function detectConflicts(
  entities: SketchEntity[],
  constraints: ConstraintRef[],
): ConflictReport {
  for (let i = 0; i < constraints.length; i++) {
    const partial = constraints.slice(0, i + 1);
    const dof = analyzeDof(entities, partial);
    if (dof.overDetermined) {
      return { firstConflictAt: i, conflictingConstraintId: constraints[i]!.id };
    }
  }
  return { firstConflictAt: null, conflictingConstraintId: null };
}

// ── Auto-suggestion ──────────────────────────────────────────────

export interface DraftLine {
  id: string;
  x1: number; y1: number; x2: number; y2: number;
}

export interface DraftPoint {
  id: string;
  x: number; y: number;
}

export interface AutoSuggestion {
  type: ConstraintType;
  targetEntityIds: string[];
  /** Confidence 0..1 — higher = stronger snap signal. */
  confidence: number;
  reason: string;
}

const HORIZONTAL_VERTICAL_DEG_TOL = 5;
const PARALLEL_DEG_TOL = 3;
const PERPENDICULAR_DEG_TOL = 3;
const COINCIDENT_DIST_MM = 2;

function lineAngleDeg(l: DraftLine): number {
  return Math.atan2(l.y2 - l.y1, l.x2 - l.x1) * 180 / Math.PI;
}

function angleDiff(a: number, b: number): number {
  let d = ((a - b) % 180 + 180) % 180;
  if (d > 90) d = 180 - d;
  return d;
}

/** Inspect a newly drawn line and suggest constraints relative to
 *  existing entities. */
export function suggestLineConstraints(
  newLine: DraftLine,
  existingLines: DraftLine[],
  existingPoints: DraftPoint[],
): AutoSuggestion[] {
  const out: AutoSuggestion[] = [];
  const angle = lineAngleDeg(newLine);

  // Horizontal / vertical snap.
  const fromHorizontal = angleDiff(angle, 0);
  const fromVertical = angleDiff(angle, 90);
  if (fromHorizontal < HORIZONTAL_VERTICAL_DEG_TOL) {
    out.push({
      type: 'horizontal',
      targetEntityIds: [newLine.id],
      confidence: 1 - fromHorizontal / HORIZONTAL_VERTICAL_DEG_TOL,
      reason: `within ${fromHorizontal.toFixed(1)}° of horizontal`,
    });
  } else if (fromVertical < HORIZONTAL_VERTICAL_DEG_TOL) {
    out.push({
      type: 'vertical',
      targetEntityIds: [newLine.id],
      confidence: 1 - fromVertical / HORIZONTAL_VERTICAL_DEG_TOL,
      reason: `within ${fromVertical.toFixed(1)}° of vertical`,
    });
  }

  // Parallel / perpendicular to existing lines.
  for (const other of existingLines) {
    const otherAngle = lineAngleDeg(other);
    const parDelta = angleDiff(angle, otherAngle);
    if (parDelta < PARALLEL_DEG_TOL && parDelta > 0.01) {
      out.push({
        type: 'parallel',
        targetEntityIds: [newLine.id, other.id],
        confidence: 1 - parDelta / PARALLEL_DEG_TOL,
        reason: `${parDelta.toFixed(1)}° from parallel with ${other.id}`,
      });
    } else if (Math.abs(parDelta - 90) < PERPENDICULAR_DEG_TOL) {
      out.push({
        type: 'perpendicular',
        targetEntityIds: [newLine.id, other.id],
        confidence: 1 - Math.abs(parDelta - 90) / PERPENDICULAR_DEG_TOL,
        reason: `${Math.abs(parDelta - 90).toFixed(1)}° from perpendicular with ${other.id}`,
      });
    }
  }

  // Coincident to existing points.
  for (const ep of [{ x: newLine.x1, y: newLine.y1, label: 'start' }, { x: newLine.x2, y: newLine.y2, label: 'end' }]) {
    for (const pt of existingPoints) {
      const d = Math.hypot(ep.x - pt.x, ep.y - pt.y);
      if (d < COINCIDENT_DIST_MM) {
        out.push({
          type: 'coincident',
          targetEntityIds: [newLine.id, pt.id],
          confidence: 1 - d / COINCIDENT_DIST_MM,
          reason: `${ep.label} ${d.toFixed(2)}mm from ${pt.id}`,
        });
      }
    }
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

/** Quick health check for a sketch — combines DOF analysis +
 *  conflict detection. */
export interface SketchHealthReport {
  dof: DofReport;
  conflict: ConflictReport;
  status: 'fully-determined' | 'under-determined' | 'over-determined';
  underDeterminedEntityIds: string[];
}

export function checkSketchHealth(
  entities: SketchEntity[],
  constraints: ConstraintRef[],
): SketchHealthReport {
  const dof = analyzeDof(entities, constraints);
  const conflict = detectConflicts(entities, constraints);
  const status = dof.overDetermined
    ? 'over-determined'
    : dof.fullyDetermined
      ? 'fully-determined'
      : 'under-determined';
  const underIds = dof.rows.filter(r => r.remaining > 0).map(r => r.entityId);
  return { dof, conflict, status, underDeterminedEntityIds: underIds };
}
