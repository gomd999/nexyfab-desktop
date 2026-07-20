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
import { applyDrives } from './kinematics';

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
 *   - the mate kind is not sweepable — 'distance'/'angle' (value sweep) or
 *     'gear'/'rack_pinion'/'hinge' (W5-F 2차 drive sweep; hinge requires
 *     zeroAngleRef)
 *   - steps < 1
 * `KinematicsError` from the drive layer (e.g. hinge limit exceeded mid-
 * sweep, fixed part in the transmission chain) propagates unchanged.
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
  const isValueSweep = mate.kind === 'distance' || mate.kind === 'angle';
  const isDriveSweep =
    mate.kind === 'gear' || mate.kind === 'rack_pinion' || mate.kind === 'hinge';
  if (!isValueSweep && !isDriveSweep) {
    throw new MotionStudyError(
      `mate ${request.mateId} kind '${mate.kind}' has no numeric parameter to sweep`,
    );
  }
  if (mate.kind === 'hinge' && mate.zeroAngleRef === undefined) {
    throw new MotionStudyError(
      `mate ${request.mateId}: hinge sweep requires zeroAngleRef (Phase 2 signed swing)`,
    );
  }

  const frames: MotionFrame[] = [];
  let currentState = initialState;
  let firstFailure = -1;
  const totalFrames = request.steps + 1;

  // ── W5-F 2차: DRIVE sweep (gear / rack_pinion / hinge) ────────────────
  // parameterValue = drive angle in degrees.
  //   - gear / rack_pinion: cumulative angle measured from the INITIAL
  //     configuration; per frame the incremental delta (v_i − v_{i−1},
  //     with v_{−1} = 0) is applied via applyDrives.
  //   - hinge: absolute target swing per frame (applyDrives semantics).
  // Statics are pre-solved once so the drive layer sees aligned axes,
  // then each frame is drive → re-solve (the re-solve result is the
  // frame's `solve`, so residuals reflect the driven pose).
  if (isDriveSweep) {
    const preSolve = iterativeSolve(currentState, resolve, request.solverOptions);
    currentState = preSolve.state;
    let prevValue = 0;
    for (let i = 0; i < totalFrames; i++) {
      const t = request.steps === 0 ? 0 : i / request.steps;
      const value = request.fromValue + (request.toValue - request.fromValue) * t;
      const driveAngle = mate.kind === 'hinge' ? value : value - prevValue;
      // applyDrives throws KinematicsError (with the reason) on refusal
      // — e.g. a hinge sweep beyond its limit. Deliberately propagated.
      const driven = applyDrives(currentState, resolve, [
        { mateId: request.mateId, angleDeg: driveAngle },
      ]);
      const solve = iterativeSolve(driven.state, resolve, request.solverOptions);
      if (!solve.success && firstFailure < 0) firstFailure = i;
      frames.push({ index: i, parameterValue: value, solve });
      currentState = solve.state;
      prevValue = value;
    }
    return {
      frames,
      allConverged: firstFailure < 0,
      firstFailureFrame: firstFailure,
    };
  }

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
