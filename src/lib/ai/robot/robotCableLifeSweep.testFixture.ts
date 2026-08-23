import { createHash } from 'node:crypto';
import { buildRobotMotionCoverageFixture } from './robotMotionCoverage.testFixture';
import { evaluateRobotMotionCoverageBytes } from './robotMotionCoverage';

const HASH = 'b'.repeat(64);
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function buildRobotCableLifeSweepFixture() {
  const motionFixture = buildRobotMotionCoverageFixture();
  const motionReport = evaluateRobotMotionCoverageBytes(motionFixture.requirementsBytes, encode(motionFixture.motionInput), motionFixture.sweptEvidenceArtifacts, motionFixture.trustedSigners);
  const motionReportBytes = encode(motionReport);
  const cableInput = {
    schema: 'nexyfab.robot-cable-life-sweep-input.v1' as const,
    requirementsFileSha256: digest(motionFixture.requirementsBytes),
    frozenRequirementsSha256: motionReport.frozenRequirementsSha256!,
    motionCoverageReportSha256: digest(motionReportBytes),
    requiredServiceLifeCycles: 10_000_000,
    cables: [{
      id: 'internal-harness-1',
      minimumAllowedBendRadiusMm: 30,
      maximumTwistDegPerM: 200,
      maximumConnectorDisplacementMm: 2,
      minimumClearanceMm: 2,
      minimumServiceLoopReserveMm: 10,
      lifeSafetyFactor: 1.2,
      bendLifeCurve: [{ bendRadiusMm: 30, allowableCycles: 20_000_000 }, { bendRadiusMm: 50, allowableCycles: 100_000_000 }],
      specificationArtifactSha256: HASH,
      lifeCurveArtifactSha256: HASH,
    }],
    combinations: motionReport.combinations.map(combination => ({
      motionCombinationId: combination.id,
      usageFraction: 1 / motionReport.combinations.length,
      cableStates: [{
        cableId: 'internal-harness-1',
        routePointsMm: [{ x: 0, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }, { x: 50, y: 50, z: 0 }],
        accumulatedTwistDeg: 10,
        minimumExactClearanceMm: 8,
        maximumConnectorDisplacementMm: 1,
        stateArtifactSha256: HASH,
      }],
    })),
  };
  return { requirementsBytes: motionFixture.requirementsBytes, motionReportBytes, cableInput };
}
