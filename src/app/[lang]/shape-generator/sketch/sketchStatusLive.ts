/**
 * sketchStatusLive.ts — read-only constraint-status diagnostics for the
 * MAIN modeler sketch flow (SolidWorks-style live feedback).
 *
 * The LM solver (`constraintSolver.solveConstraints`) only ran when the
 * user pressed "Solve" or enabled auto-solve, so the status pill / DOF
 * readout in the shell chrome showed a stale (or default-green) state.
 * This module runs the SAME solver but discards the solved point
 * positions — geometry never moves, we only harvest the diagnostics
 * (status / DOF / redundant / unsatisfied / solve time).
 *
 * Honesty guards:
 *   - Empty sketch → status `null` (not "fully constrained · DOF 0").
 *   - Points without ids can't be solver variables (buildVars skips
 *     them), which made `vars.n === 0` report a fake `ok`. We count
 *     those points as 2 free DOF each and force `under-defined`.
 */

import { solveConstraints, type ConstraintStatus } from './constraintSolver';
import type { SketchSegment, SketchConstraint, SketchDimension } from './types';

export interface SketchLiveStatus {
  /** null = empty sketch (nothing to report). */
  status: ConstraintStatus | null;
  /** Remaining degrees of freedom; null when sketch is empty. */
  dof: number | null;
  /** Constraint ids whose removal would not change the solution rank. */
  redundantIds: string[];
  /** Constraint ids the solver could not satisfy. */
  unsatisfiedIds: string[];
  /** Wall-clock solve time in ms; null when no solve ran. */
  solveMs: number | null;
  /** Solver's human-readable diagnostic, when present. */
  message?: string;
}

export const EMPTY_SKETCH_STATUS: SketchLiveStatus = {
  status: null,
  dof: null,
  redundantIds: [],
  unsatisfiedIds: [],
  solveMs: null,
};

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Run a read-only diagnostic solve. Never mutates `segments` /
 * `constraints` / `dimensions`; solved point positions are discarded.
 */
export function computeSketchLiveStatus(
  segments: SketchSegment[],
  constraints: SketchConstraint[],
  dimensions: SketchDimension[],
): SketchLiveStatus {
  if (segments.length === 0) return EMPTY_SKETCH_STATUS;

  // Points without ids are invisible to the solver — count them as free.
  let anonymousPoints = 0;
  for (const s of segments) {
    for (const p of s.points) if (!p.id) anonymousPoints++;
  }

  const t0 = nowMs();
  const result = solveConstraints(segments, constraints, dimensions);
  const solveMs = nowMs() - t0;

  const solverDof = result.solveResult?.dof ?? 0;
  const dof = solverDof + anonymousPoints * 2;
  let status: ConstraintStatus = result.solveResult?.status ?? (result.satisfied ? 'ok' : 'over-defined');
  // The solver reported `ok` only because un-id'd points fell out of the
  // variable set — those points are actually unconstrained.
  if (status === 'ok' && dof > 0) status = 'under-defined';

  return {
    status,
    dof,
    redundantIds: result.solveResult?.redundant ?? [],
    unsatisfiedIds: result.unsatisfiedConstraints,
    solveMs,
    message: result.solveResult?.message,
  };
}

// ─── UI tone mapping ─────────────────────────────────────────────────────────

/** SolidWorks-style traffic light: under-constrained (default/blue),
 *  fully constrained (green), over-defined / conflicting (red). */
export type SketchStatusTone = 'none' | 'ok' | 'under' | 'over' | 'conflict';

export function getSketchStatusTone(status: ConstraintStatus | null): SketchStatusTone {
  switch (status) {
    case null: return 'none';
    case 'ok': return 'ok';
    case 'under-defined': return 'under';
    case 'over-defined': return 'over';
    case 'inconsistent': return 'conflict';
  }
}
