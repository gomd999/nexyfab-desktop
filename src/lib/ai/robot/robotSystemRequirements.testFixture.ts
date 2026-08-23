export const ROBOT_SYSTEM_REQUIREMENTS_TEST_HASH = 'a'.repeat(64);

export function buildValidRobotSystemRequirementsFixture() {
  const authority = { sourceArtifactSha256: ROBOT_SYSTEM_REQUIREMENTS_TEST_HASH, approvedBy: 'engineer-1', approvedAt: '2026-08-12T00:00:00+09:00' };
  const vector = { x: 0, y: 0, z: 0 };
  const inertia = { ixx: 0.1, iyy: 0.1, izz: 0.1, ixy: 0, ixz: 0, iyz: 0 };
  const manufacturingSubjects = ['materials', 'processes', 'tolerances', 'inspection'] as const;
  return {
    schema: 'nexyfab.robot-system-requirements.v2' as const,
    identity: { productId: 'robot-medium-01', lineageId: 'robot-medium', revision: 1, intendedUse: 'Industrial material handling inside a guarded cell.', frozen: true as const },
    mechanics: {
      axes: 6 as const,
      reachMm: 1_300,
      jointRanges: Array.from({ length: 6 }, (_, index) => ({ joint: index + 1, minDeg: -120, maxDeg: 120 })),
      installationPose: { kind: 'floor' as const, baseTransform: { positionMm: vector, orientation: { x: 0, y: 0, z: 0, w: 1 } }, authority },
      payloadCases: [
        { id: 'payload-zero', kind: 'zero' as const, massKg: 0, centerOfMassMm: vector, inertiaKgM2: { ixx: 0, iyy: 0, izz: 0, ixy: 0, ixz: 0, iyz: 0 }, externalWrench: { forceN: vector, torqueNm: vector }, authority },
        { id: 'payload-rated', kind: 'rated' as const, massKg: 10, centerOfMassMm: vector, inertiaKgM2: inertia, externalWrench: { forceN: vector, torqueNm: vector }, authority },
        { id: 'payload-eccentric', kind: 'eccentric' as const, massKg: 10, centerOfMassMm: { x: 100, y: 0, z: 50 }, inertiaKgM2: inertia, externalWrench: { forceN: vector, torqueNm: vector }, authority },
      ],
    },
    performance: { tcpAccuracyMm: 0.2, tcpRepeatabilityMm: 0.05, cycleTimeS: 4, dutyCycleRatio: 0.7, serviceLifeCycles: 10_000_000, authority },
    motion: {
      jointLimits: Array.from({ length: 6 }, (_, index) => ({ joint: index + 1, maxVelocityDegS: 120, maxAccelerationDegS2: 300, maxJerkDegS3: 1_000, authority })),
      governedPaths: [{ id: 'path-cycle-a', description: 'Rated production cycle', artifactSha256: ROBOT_SYSTEM_REQUIREMENTS_TEST_HASH }],
      forbiddenZones: [{ id: 'zone-operator', description: 'Operator exclusion volume', artifactSha256: ROBOT_SYSTEM_REQUIREMENTS_TEST_HASH }],
    },
    environment: { minimumTemperatureC: 5, maximumTemperatureC: 40, maximumRelativeHumidityPct: 80, contaminationClass: 'Indoor industrial non-condensing', ipTarget: 'IP54', expectedLifeCycles: 10_000_000, authority },
    power: { supply: { kind: 'ac_three_phase' as const, nominalVoltageV: 400, phases: 3 as const, frequencyHz: 60 }, peakPowerW: 12_000, rmsPowerW: 5_000, regenerative: { enabled: true, maximumReturnPowerW: 4_000 }, brake: { supplyVoltageV: 24, deenergizedHoldingRequired: true }, authority },
    safety: {
      personsPresentInApplication: true,
      cellBoundary: { id: 'cell-a', description: 'Guarded robot cell boundary', artifactSha256: ROBOT_SYSTEM_REQUIREMENTS_TEST_HASH },
      foreseeableMisuse: ['Entry through an open guard during automatic operation'],
      hazards: [{ id: 'hazard-crush', description: 'Crushing between robot and fixed cell equipment', lifecyclePhases: ['operation' as const, 'maintenance' as const], sourceArtifactSha256: ROBOT_SYSTEM_REQUIREMENTS_TEST_HASH }],
      safetyFunctions: [{ id: 'sf-protective-stop', hazardIds: ['hazard-crush'], trigger: 'Guard opens or presence is detected', safeState: 'All robot axes reach the validated protective stop state', resetCondition: 'Manual reset outside the safeguarded space after clearance', requiredPerformanceTarget: 'Application-specific target approved by the safety reviewer', authority }],
      authority,
    },
    manufacturing: { authorities: manufacturingSubjects.map(subject => ({ subject, ...authority })) },
    authority,
  };
}
