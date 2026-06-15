/**
 * motionStudy — Phase 3.6 of NexyFab Pro own-CAD (ADR-013).
 *
 * Parameter sweep over a single mate's value (distance or angle), re-solving
 * the assembly at each step. Returns a frame-by-frame sequence of part
 * placements + per-mate residuals, suitable for kinematic analysis or
 * direct playback in a 3D viewport.
 *
 * Use cases:
 *   - Drive a crank's input angle to animate a 4-bar linkage
 *   - Sweep a distance mate to verify clearance through travel
 *   - Animate an exploded view by sweeping a synthetic distance
 *
 * Scope (Phase 3.6 minimal):
 *   - Single mate parameter sweep (linear interpolation between from/to).
 *   - N+1 frames (inclusive endpoints).
 *   - Re-uses iterativeSolve for each frame (warm-starts from prev frame's
 *     solution for faster convergence).
 *   - Interference scan per frame is the caller's responsibility (a
 *     follow-up pass can run assemblyInterferences on each frame).
 *
 * Out of scope (Phase 3.6.2+):
 *   - Multi-parameter studies (sweep 2+ params on a grid)
 *   - Time-based animation (constant velocity vs ease-in/out)
 *   - Failure-frame detection (which frame first violates a constraint)
 *   - Export to video / GIF
 */

import type { AssemblyState } from './assemblyState';
import type { Mate } from './mate';
import {
  iterativeSolve,
  type GeometryResolver,
  type IterativeSolverOptions,
  type IterativeSolveResult,
} from './iterativeSolver';

export interface MotionSweepRequest {
  /** Mate to drive. Must have a numeric `value` field (distance or angle). */
  mateId: string;
  fromValue: number;
  toValue: number;
  /** Number of steps. Total frames = steps + 1 (inclusive endpoints). */
  steps: number;
  /** Solver options reused for each frame. */
  solverOptions?: IterativeSolverOptions;
}

export interface MotionFrame {
  /** Frame index, 0-based. */
  index: number;
  /** Parameter value used for this frame. */
  parameterValue: number;
  /** Solver result for this frame (includes the resolved AssemblyState). */
  solve: IterativeSolveResult;
}

export interface MotionStudyResult {
  frames: ReadonlyArray<MotionFrame>;
  /** True if every frame converged within tolerance. */
  allConverged: boolean;
  /** Index of first frame that failed to converge, or -1 if all succeeded. */
  firstFailureFrame: number;
}

export class MotionStudyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MotionStudyError';
  }
}

/**
 * Run a parameter sweep on a mate's `value` field. Returns one frame per
 * step including both endpoints. Each frame's solve warm-starts from the
 * previous frame's converged state, which dramatically reduces iteration
 * count for smooth sweeps.
 *
 * Throws `MotionStudyError` if:
 *   - the named mate doesn't exist in the state
 *   - the mate kind doesn't carry a `value` (only 'distance' and 'angle' do)
 *   - steps < 1
 */
export function runMotionSweep(
  initialState: AssemblyState,
  resolve: GeometryResolver,
  request: MotionSweepRequest,
): MotionStudyResult {
  if (request.steps < 1 || !Number.isInteger(request.steps)) {
    throw new MotionStudyError(`steps must be a positive integer, got ${request.steps}`);
  }
  const mate = initialState.mates.find((m) => m.id === request.mateId);
  if (!mate) {
    throw new MotionStudyError(`mate ${request.mateId} not found`);
  }
  if (mate.kind !== 'distance' && mate.kind !== 'angle') {
    throw new MotionStudyError(
      `mate ${request.mateId} kind '${mate.kind}' has no numeric parameter to sweep`,
    );
  }

  const frames: MotionFrame[] = [];
  let currentState = initialState;
  let firstFailure = -1;
  const totalFrames = request.steps + 1;

  for (let i = 0; i < totalFrames; i++) {
    const t = request.steps === 0 ? 0 : i / request.steps;
    const value = request.fromValue + (request.toValue - request.fromValue) * t;
    const stateWithValue = updateMateValue(currentState, request.mateId, value);
    const solve = iterativeSolve(stateWithValue, resolve, request.solverOptions);
    if (!solve.success && firstFailure < 0) firstFailure = i;
    frames.push({ index: i, parameterValue: value, solve });
    // Warm-start: use this frame's solution as the next frame's input.
    currentState = solve.state;
  }

  return {
    frames,
    allConverged: firstFailure < 0,
    firstFailureFrame: firstFailure,
  };
}

/**
 * Return a new AssemblyState with the named mate's value updated.
 * Only distance and angle mates carry a value — caller has already
 * validated this via runMotionSweep.
 */
function updateMateValue(
  state: AssemblyState,
  mateId: string,
  value: number,
): AssemblyState {
  const idx = state.mates.findIndex((m) => m.id === mateId);
  if (idx < 0) return state;
  const orig = state.mates[idx]!;
  let next: Mate;
  switch (orig.kind) {
    case 'distance':
      next = { ...orig, value };
      break;
    case 'angle':
      next = { ...orig, value };
      break;
    default:
      return state;
  }
  const mates = state.mates.slice();
  mates[idx] = next;
  return { ...state, mates };
}
