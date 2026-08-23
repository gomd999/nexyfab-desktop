const HASH = 'b'.repeat(64);
const zero = { x: 0, y: 0, z: 0 };
const zeroInertia = { ixx: 0, iyy: 0, izz: 0, ixy: 0, ixz: 0, iyz: 0 };
const pointMassInertia = { ixx: 1e-9, iyy: 1e-9, izz: 1e-9, ixy: 0, ixz: 0, iyz: 0 };

export function buildRobotDynamicLoadEnvelopeFixture() {
  const joints = Array.from({ length: 6 }, (_, index) => ({
    joint: index + 1,
    aMm: 0,
    alphaDeg: 0,
    dMm: 0,
    thetaOffsetDeg: 0,
    massKg: index === 0 ? 1 : 0,
    centerOfMassMm: index === 0 ? { x: 1_000, y: 0, z: 0 } : zero,
    inertiaKgM2: index === 0 ? pointMassInertia : zeroInertia,
    reflectedInertiaKgM2: 0,
    viscousFrictionNmPerRadS: 0,
    coulombFrictionNm: 0,
    massPropertiesArtifactSha256: HASH,
  }));
  const drives = Array.from({ length: 6 }, (_, index) => ({
    joint: index + 1,
    maximumOutputSpeedRpm: 100,
    maximumMechanicalPowerW: 10_000,
    torqueSpeedCurve: [
      { speedRpm: 0, continuousTorqueNm: 100, peakTorqueNm: 200 },
      { speedRpm: 100, continuousTorqueNm: 50, peakTorqueNm: 100 },
    ],
    sourceArtifactSha256: HASH,
  }));
  const frame = { timeS: 0, anglesDeg: [0, 0, 0, 0, 0, 0], velocityDegS: [0, 0, 0, 0, 0, 0], accelerationDegS2: [0, 0, 0, 0, 0, 0], externalWrenchBase: { forceN: zero, torqueNm: zero } };
  return {
    schema: 'nexyfab.robot-dynamic-load-envelope-input.v1' as const,
    requirementsSha256: HASH,
    modelArtifactSha256: HASH,
    pathArtifactSha256: HASH,
    gravityBaseMps2: { x: 0, y: -9.80665, z: 0 },
    joints,
    payload: { caseId: 'payload-zero', massKg: 0, centerOfMassToolMm: zero, inertiaToolKgM2: zeroInertia, sourceArtifactSha256: HASH },
    frames: [frame, { ...frame, timeS: 1 }],
    drives,
  };
}
