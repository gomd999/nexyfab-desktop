import { createHash } from 'node:crypto';
import { evaluateRobotDynamicLoadEnvelopeBytes } from './robotDynamicLoadEnvelope';
import { buildRobotDynamicLoadEnvelopeFixture } from './robotDynamicLoadEnvelope.testFixture';

const HASH = 'e'.repeat(64);
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }

export function buildRobotBearingReducerLifeFixture() {
  const dynamicReport = evaluateRobotDynamicLoadEnvelopeBytes(new TextEncoder().encode(JSON.stringify(buildRobotDynamicLoadEnvelopeFixture())));
  const dynamicReportBytes = new TextEncoder().encode(JSON.stringify(dynamicReport));
  const lifeInput = {
    schema: 'nexyfab.robot-bearing-reducer-life-input.v1' as const,
    dynamicReportSha256: digest(dynamicReportBytes),
    requirementsSha256: dynamicReport.requirementsSha256!,
    requiredServiceLifeCycles: 1_000,
    cycleTimeS: 1,
    joints: Array.from({ length: 6 }, (_, index) => ({
      joint: index + 1,
      spectrumArtifactSha256: HASH,
      spectrum: [{ durationFraction: 1, outputTorqueNm: index === 0 ? 50 : 0, outputSpeedRpm: index === 0 ? 100 : 0, equivalentBearingLoadN: index === 0 ? 100 : 0, peakBearingLoadN: index === 0 ? 150 : 0 }],
      bearing: { dynamicLoadRatingN: 1_000, staticLoadRatingN: 5_000, lifeExponent: 3 as const, reliabilityFactor: 1, requiredStaticSafetyFactor: 1.5, sourceArtifactSha256: HASH },
      reducer: { ratedOutputTorqueNm: 100, peakOutputTorqueNm: 200, ratedOutputSpeedRpm: 100, ratedLifeHours: 10_000, lifeExponent: 3, sourceArtifactSha256: HASH },
    })),
  };
  return { dynamicReport, dynamicReportBytes, lifeInput };
}
