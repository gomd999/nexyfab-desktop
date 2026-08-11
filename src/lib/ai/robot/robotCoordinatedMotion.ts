import type { HingeTrajectoryRequest } from '@/lib/assembly/motionStudy';
import type { HingeMate } from '@/lib/assembly/mate';

export const ROBOT_COORDINATED_MOTION_STRATEGY = 'coordinated-six-axis-keyframes-v1';
export const ROBOT_COORDINATED_MOTION_STEPS = 12;
export const ROBOT_COORDINATED_MOTION_FRAMES = 49;

const NORMALIZED_KEYFRAMES = [
  [0, 0, 0, 0, 0, 0],
  [0.45, -0.35, 0.35, -0.3, 0.25, -0.2],
  [-0.4, 0.35, -0.4, 0.3, -0.3, 0.25],
  [0.25, 0.45, -0.3, 0.4, 0.35, -0.35],
  [0, 0, 0, 0, 0, 0],
] as const;

/** A deterministic joint-space stress path, not an exhaustive workspace proof. */
export function buildRobotCoordinatedMotionTrajectory(
  hinges: readonly HingeMate[],
): HingeTrajectoryRequest {
  if (hinges.length !== 6 || hinges.some((mate, index) => mate.id !== `J${index + 1}` || !mate.limit)) {
    throw new Error('coordinated robot trajectory requires ordered, limited J1..J6 hinges');
  }
  for (const mate of hinges) {
    if (mate.limit!.minAngleDeg > 0 || mate.limit!.maxAngleDeg < 0) {
      throw new Error(`coordinated robot trajectory requires zero inside ${mate.id} limits`);
    }
  }
  const keyframes = NORMALIZED_KEYFRAMES.map(frame => frame.map((normalized, index) => {
    const limit = hinges[index]!.limit!;
    return normalized < 0 ? Math.abs(normalized) * limit.minAngleDeg : normalized * limit.maxAngleDeg;
  }));
  return {
    mateIds: hinges.map(mate => mate.id),
    keyframes,
    stepsPerSegment: ROBOT_COORDINATED_MOTION_STEPS,
  };
}
