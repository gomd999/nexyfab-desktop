import { describe, expect, it } from 'vitest';
import { forward, verifyRobotEngineering, type RobotEngineeringSpec } from './robotEngineering';

export const safeRobot: RobotEngineeringSpec = {
  payloadKg: 4, samples: 24,
  joints: [
    { aMm: 0, alphaDeg: 90, dMm: 180, minDeg: -170, maxDeg: 170 },
    { aMm: 260, alphaDeg: 0, dMm: 0, minDeg: -120, maxDeg: 120 },
    { aMm: 220, alphaDeg: 0, dMm: 0, minDeg: -150, maxDeg: 150 },
    { aMm: 0, alphaDeg: 90, dMm: 120, minDeg: -180, maxDeg: 180 },
    { aMm: 0, alphaDeg: -90, dMm: 90, minDeg: -120, maxDeg: 120 },
    { aMm: 0, alphaDeg: 0, dMm: 80, minDeg: -180, maxDeg: 180 },
  ].map((joint, index) => ({ ...joint, motorTorqueNm: 2 + (5 - index), gearRatio: 100, efficiency: 0.75, linkMassKg: 1, cableDiameterMm: 6, routingRadiusMm: 40, maxCableTwistDeg: 400 })),
};

describe('robot engineering verification', () => {
  it('computes a deterministic kinematic chain and sampled workspace', () => {
    expect(forward(safeRobot.joints, [0, 0, 0, 0, 0, 0])).toHaveLength(7);
    const report = verifyRobotEngineering(safeRobot);
    expect(report.workspace.sampledPoses).toBe(24);
    expect(report.workspace.max.x).toBeGreaterThan(report.workspace.min.x);
    expect(report.torque).toHaveLength(6);
  });
  it('detects insufficient cable bend radius and twist allowance', () => {
    const bad = structuredClone(safeRobot); bad.joints[0]!.routingRadiusMm = 10; bad.joints[0]!.maxCableTwistDeg = 90;
    const report = verifyRobotEngineering(bad);
    expect(report.cables[0]).toMatchObject({ bendPassed: false, twistPassed: false });
    expect(report.designOk).toBe(false);
  });
  it('rejects a non-six-axis specification', () => expect(() => verifyRobotEngineering({ ...safeRobot, joints: safeRobot.joints.slice(0, 5) })).toThrow(/exactly six/));
});
