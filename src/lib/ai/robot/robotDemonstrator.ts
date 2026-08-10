import type { RobotEngineeringSpec } from './robotEngineering';

/** Non-holdout engineering brief used to exercise the editable AI→CAD pipeline. */
export const ROBOT_6AXIS_DEMONSTRATOR_SPEC: RobotEngineeringSpec = {
  payloadKg: 4,
  samples: 24,
  joints: [
    { aMm: 0, alphaDeg: 90, dMm: 180, minDeg: -170, maxDeg: 170 },
    { aMm: 260, alphaDeg: 0, dMm: 0, minDeg: -120, maxDeg: 120 },
    { aMm: 220, alphaDeg: 0, dMm: 0, minDeg: -150, maxDeg: 150 },
    { aMm: 0, alphaDeg: 90, dMm: 120, minDeg: -180, maxDeg: 180 },
    { aMm: 0, alphaDeg: -90, dMm: 90, minDeg: -120, maxDeg: 120 },
    { aMm: 0, alphaDeg: 0, dMm: 80, minDeg: -180, maxDeg: 180 },
  ].map((joint, index) => ({
    ...joint,
    motorTorqueNm: 7 - index,
    gearRatio: 100,
    efficiency: 0.75,
    linkMassKg: 1,
    cableDiameterMm: 6,
    routingRadiusMm: 40,
    maxCableTwistDeg: 400,
    requiredOutputTorqueNm: [60, 80, 45, 20, 12, 8][index]!,
    requiredOutputRpm: [30, 30, 40, 60, 60, 90][index]!,
    radialLoadN: [5000, 4500, 3500, 2000, 1400, 900][index]!,
    minShaftDiameterMm: [25, 25, 20, 15, 12, 10][index]!,
  })),
};
