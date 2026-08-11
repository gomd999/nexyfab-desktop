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
 * Scope:
 *   - Single mate parameter sweep (linear interpolation between from/to).
 *   - Coordinated, absolute multi-hinge trajectories through governed
 *     keyframes (serial robots and other open-chain mechanisms).
 *   - N+1 frames (inclusive endpoints).
 *   - Re-uses iterativeSolve for each frame (warm-starts from prev frame's
 *     solution for faster convergence).
 *   - Interference scan per frame is the caller's responsibility (a
 *     follow-up pass can run assemblyInterferences on each frame).
 *
 * Out of scope (Phase 3.6.2+):
 *   - Cartesian path planning / inverse kinematics.
 *   - Multi-parameter exhaustive grids (coordinated keyframes are paths,
 *     not a proof over the full joint-space volume).
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

export interface HingeTrajectoryRequest {
  /** Ordered, unique hinge mate IDs. Drive order is deterministic. */
  mateIds: string[];
  /** Absolute hinge angles in degrees. Every row matches mateIds. */
  keyframes: number[][];
  /** Linear interpolation steps per keyframe segment. */
  stepsPerSegment: number;
  solverOptions?: IterativeSolverOptions;
}

export interface HingeTrajectoryFrame {
  index: number;
  segmentIndex: number;
  parameterValues: Readonly<Record<string, number>>;
  solve: IterativeSolveResult;
}

export interface HingeTrajectoryResult {
  frames: ReadonlyArray<HingeTrajectoryFrame>;
  allConverged: boolean;
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
 * Follow a coordinated path through absolute hinge-angle keyframes.
 *
 * This deliberately supports signed hinges only. Gear/rack drives are
 * incremental and cannot be mixed into an absolute joint-vector path without
 * an explicit transmission-coordinate model. Each interpolated frame applies
 * every hinge target, re-solves the assembly, and warm-starts the next frame.
 */
export function runHingeTrajectory(
  initialState: AssemblyState,
  resolve: GeometryResolver,
  request: HingeTrajectoryRequest,
): HingeTrajectoryResult {
  if (!Number.isInteger(request.stepsPerSegment) || request.stepsPerSegment < 1 || request.stepsPerSegment > 120) {
    throw new MotionStudyError(`stepsPerSegment must be an integer from 1 to 120, got ${request.stepsPerSegment}`);
  }
  if (!Array.isArray(request.mateIds) || request.mateIds.length < 2 || request.mateIds.length > 24) {
    throw new MotionStudyError('mateIds must contain 2 to 24 governed hinge IDs');
  }
  if (new Set(request.mateIds).size !== request.mateIds.length || request.mateIds.some(id => typeof id !== 'string' || !id.trim())) {
    throw new MotionStudyError('mateIds must be non-empty and unique');
  }
  if (!Array.isArray(request.keyframes) || request.keyframes.length < 2 || request.keyframes.length > 30) {
    throw new MotionStudyError('keyframes must contain 2 to 30 joint vectors');
  }
  const totalFrames = (request.keyframes.length - 1) * request.stepsPerSegment + 1;
  if (totalFrames > 360) throw new MotionStudyError(`trajectory frame budget exceeded: ${totalFrames}/360`);

  const hinges = request.mateIds.map(mateId => {
    const mate = initialState.mates.find(candidate => candidate.id === mateId);
    if (!mate) throw new MotionStudyError(`mate ${mateId} not found`);
    if (mate.kind !== 'hinge' || mate.suppressed || !mate.zeroAngleRef) {
      throw new MotionStudyError(`mate ${mateId} must be an active signed hinge with zeroAngleRef`);
    }
    return mate;
  });
  for (const [frameIndex, keyframe] of request.keyframes.entries()) {
    if (!Array.isArray(keyframe) || keyframe.length !== hinges.length) {
      throw new MotionStudyError(`keyframes[${frameIndex}] must contain ${hinges.length} angles`);
    }
    for (const [axisIndex, value] of keyframe.entries()) {
      if (!Number.isFinite(value)) throw new MotionStudyError(`keyframes[${frameIndex}][${axisIndex}] must be finite`);
      const limit = hinges[axisIndex]!.limit;
      if (limit && (value < limit.minAngleDeg || value > limit.maxAngleDeg)) {
        throw new MotionStudyError(
          `keyframes[${frameIndex}] target ${value}° is outside ${hinges[axisIndex]!.id} limit ` +
          `[${limit.minAngleDeg}°, ${limit.maxAngleDeg}°]`,
        );
      }
    }
  }

  let currentState = iterativeSolve(initialState, resolve, request.solverOptions).state;
  const frames: HingeTrajectoryFrame[] = [];
  let firstFailureFrame = -1;
  for (let segmentIndex = 0; segmentIndex < request.keyframes.length - 1; segmentIndex += 1) {
    const from = request.keyframes[segmentIndex]!;
    const to = request.keyframes[segmentIndex + 1]!;
    const firstStep = segmentIndex === 0 ? 0 : 1;
    for (let step = firstStep; step <= request.stepsPerSegment; step += 1) {
      const t = step / request.stepsPerSegment;
      const values = from.map((value, index) => value + (to[index]! - value) * t);
      const driven = applyDrives(currentState, resolve, request.mateIds.map((mateId, index) => ({
        mateId,
        angleDeg: values[index]!,
      })));
      const solve = iterativeSolve(driven.state, resolve, request.solverOptions);
      const index = frames.length;
      if (!solve.success && firstFailureFrame < 0) firstFailureFrame = index;
      frames.push({
        index,
        segmentIndex,
        parameterValues: Object.fromEntries(request.mateIds.map((mateId, axisIndex) => [mateId, values[axisIndex]!])),
        solve,
      });
      currentState = solve.state;
    }
  }
  return { frames, allConverged: firstFailureFrame < 0, firstFailureFrame };
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
