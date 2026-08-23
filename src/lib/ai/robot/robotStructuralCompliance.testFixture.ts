import { createHash } from 'node:crypto';
import { buildValidRobotSystemRequirementsFixture } from './robotSystemRequirements.testFixture';
import { verifyRobotSystemRequirementsBytes } from './robotSystemRequirements';

const HASH = 'e'.repeat(64);

export function buildRobotStructuralComplianceFixture() {
  const requirementsBytes = new TextEncoder().encode(JSON.stringify(buildValidRobotSystemRequirementsFixture()));
  const verification = verifyRobotSystemRequirementsBytes(requirementsBytes);
  if (!verification.frozenRequirementsSha256) throw new Error('requirements fixture must verify');
  return {
    requirementsBytes,
    complianceInput: {
      schema: 'nexyfab.robot-structural-compliance-input.v1' as const,
      requirementsFileSha256: createHash('sha256').update(requirementsBytes).digest('hex'),
      frozenRequirementsSha256: verification.frozenRequirementsSha256,
      kinematicModelArtifactSha256: HASH,
      structuralModelArtifactSha256: HASH,
      physicalStiffnessValidationPlanArtifactSha256: HASH,
      allowableTcpDeflectionMm: 0.15,
      kinematicJoints: Array.from({ length: 6 }, (_, index) => ({ joint: index + 1, aMm: index === 0 ? 1_000 : 0, alphaDeg: 0, dMm: 0, thetaOffsetDeg: 0 })),
      jointStiffness: Array.from({ length: 6 }, (_, index) => ({ joint: index + 1, minimumOutputTorsionalStiffnessNmPerRad: 100_000, sourceArtifactSha256: HASH })),
      loadCases: [{
        id: 'tcp-force-y',
        anglesDeg: [0, 0, 0, 0, 0, 0],
        forceBaseN: { x: 0, y: 10, z: 0 },
        torqueBaseNm: { x: 0, y: 0, z: 0 },
        maximumLinkTranslationalComplianceMPerN: { xx: 0, yy: 0, zz: 0, xy: 0, xz: 0, yz: 0 },
        complianceArtifactSha256: HASH,
      }],
    },
  };
}
