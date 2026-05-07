/**
 * Sketch constraint preflight — counts and sanity checks before invoking LM solver.
 * Does not replace `solveConstraints`; use for UX hints and telemetry.
 */

export interface SketchPointLike {
  id?: string;
}

export interface SketchConstraintLike {
  id?: string;
  type?: string;
}

export type SketchPreflightWarningCode =
  | 'points_no_constraints'
  | 'constraints_no_points'
  | 'large_constraint_set';

export interface SketchPreflightResult {
  pointCount: number;
  constraintCount: number;
  /** Stable codes — map to UI strings in the app layer (i18n). */
  warningCodes: SketchPreflightWarningCode[];
}

export function preflightSketchConstraints(
  points: SketchPointLike[],
  constraints: SketchConstraintLike[],
): SketchPreflightResult {
  const warningCodes: SketchPreflightWarningCode[] = [];
  const pc = points.length;
  const cc = constraints.length;

  if (pc >= 2 && cc === 0) {
    warningCodes.push('points_no_constraints');
  }
  if (cc > 0 && pc === 0) {
    warningCodes.push('constraints_no_points');
  }
  if (cc > 80) {
    warningCodes.push('large_constraint_set');
  }

  return {
    pointCount: pc,
    constraintCount: cc,
    warningCodes,
  };
}
