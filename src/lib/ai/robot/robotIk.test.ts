import { describe, expect, it } from 'vitest';
import { safeRobot } from './robotEngineering.test';
import { buildReachabilityMap, robotForwardPose, solveRobotIk } from './robotIk';

describe('DLS robot inverse kinematics', () => {
  it('recovers a reachable six-axis pose within position and orientation tolerances', () => {
    const target = robotForwardPose(safeRobot, [20, -30, 40, 15, 25, -10]);
    const result = solveRobotIk(safeRobot, target, [18, -28, 38, 13, 23, -8]);
    expect(result.success).toBe(true); expect(result.positionErrorMm).toBeLessThan(0.1); expect(result.orientationErrorRad).toBeLessThan(1e-3);
  });
  it('does not claim an unreachable target succeeded', () => {
    const target = { positionMm: [10000, 10000, 10000] as [number,number,number], rotation: [1,0,0,0,1,0,0,0,1] as [number,number,number,number,number,number,number,number,number] };
    expect(solveRobotIk(safeRobot, target).success).toBe(false);
    expect(buildReachabilityMap(safeRobot, [target]).unreachable).toBe(1);
  });
});
