import { createHash } from 'node:crypto';
import { buildRobotEngineeringAnalysisPacketFixture } from './robotEngineeringAnalysisPacket.testFixture';
import { buildValidRobotSystemRequirementsFixture } from './robotSystemRequirements.testFixture';
import { verifyRobotSystemRequirementsBytes } from './robotSystemRequirements';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function buildRobotEngineeringCoverageMatrixFixture() {
  const requirementsBytes = encode(buildValidRobotSystemRequirementsFixture());
  const verification = verifyRobotSystemRequirementsBytes(requirementsBytes);
  if (!verification.frozenRequirementsSha256) throw new Error('requirements fixture must verify');
  const artifacts = new Map<string, Uint8Array>();
  const combinations = ['payload-zero', 'payload-rated', 'payload-eccentric'].map(payloadCaseId => {
    const packet = buildRobotEngineeringAnalysisPacketFixture({ requirementsBytes, payloadCaseId });
    const id = `${payloadCaseId}-path-cycle-a`;
    const files = {
      dynamicInput: `${id}-dynamic-input.json`,
      dynamicReport: `${id}-dynamic-report.json`,
      thermalInput: `${id}-thermal-input.json`,
      lifeInput: `${id}-life-input.json`,
      complianceInput: `${id}-compliance-input.json`,
      precisionInput: `${id}-precision-input.json`,
    };
    for (const [key, name] of Object.entries(files)) artifacts.set(name, packet[key as keyof typeof files]);
    return { id, payloadCaseId, governedPathId: 'path-cycle-a', files };
  });
  const manifest = {
    schema: 'nexyfab.robot-engineering-coverage-manifest.v1' as const,
    requirementsFileSha256: digest(requirementsBytes),
    frozenRequirementsSha256: verification.frozenRequirementsSha256,
    combinations,
  };
  return { requirementsBytes, manifest, manifestBytes: encode(manifest), artifacts };
}
