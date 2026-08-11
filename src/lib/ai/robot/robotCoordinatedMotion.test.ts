import { describe, expect, it } from 'vitest';
import { generateRobot6Axis } from './robotGenerator';
import { ROBOT_6AXIS_DEMONSTRATOR_SPEC } from './robotDemonstrator';
import { buildRobotCoordinatedMotionTrajectory, ROBOT_COORDINATED_MOTION_FRAMES } from './robotCoordinatedMotion';
import type { HingeMate } from '@/lib/assembly/mate';

describe('robot coordinated motion trajectory', () => {
  it('binds a deterministic 49-frame stress path to governed J1..J6 limits', () => {
    const hinges = generateRobot6Axis(ROBOT_6AXIS_DEMONSTRATOR_SPEC).program.assembly.mates
      .filter((mate): mate is HingeMate => mate.kind === 'hinge' && /^J[1-6]$/.test(mate.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    const trajectory = buildRobotCoordinatedMotionTrajectory(hinges);
    expect(trajectory.mateIds).toEqual(['J1', 'J2', 'J3', 'J4', 'J5', 'J6']);
    expect((trajectory.keyframes.length - 1) * trajectory.stepsPerSegment + 1).toBe(ROBOT_COORDINATED_MOTION_FRAMES);
    for (const frame of trajectory.keyframes) frame.forEach((value, index) => {
      expect(value).toBeGreaterThanOrEqual(hinges[index]!.limit!.minAngleDeg);
      expect(value).toBeLessThanOrEqual(hinges[index]!.limit!.maxAngleDeg);
    });
    expect(trajectory.keyframes.at(0)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(trajectory.keyframes.at(-1)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
