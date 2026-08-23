import { createHash } from 'node:crypto';
import { buildValidRobotSystemRequirementsFixture } from './robotSystemRequirements.testFixture';
import { verifyRobotSystemRequirementsBytes } from './robotSystemRequirements';

const HASH = 'd'.repeat(64);

export function buildRobotTcpPositionErrorBudgetFixture() {
  const requirements = buildValidRobotSystemRequirementsFixture();
  const requirementsBytes = new TextEncoder().encode(JSON.stringify(requirements));
  const verification = verifyRobotSystemRequirementsBytes(requirementsBytes);
  if (!verification.frozenRequirementsSha256) throw new Error('requirements fixture must verify');
  const contributors = [
    jointContributor('reducer', 'reducer_lost_motion', 1, 1, 0.2),
    jointContributor('encoder', 'encoder_accuracy', 1, 1, 0.2),
    jointContributor('mount', 'joint_mounting', 1, 1, 0.2),
    positionContributor('manufacturing', 'manufacturing_stack', 0.01, 0.002),
    positionContributor('thermal', 'thermal_drift', 0.01, 0.002),
    positionContributor('structure', 'structural_compliance', 0.01, 0.002),
    positionContributor('calibration', 'calibration_residual', 0.01, 0.002),
  ];
  return {
    requirementsBytes,
    precisionInput: {
      schema: 'nexyfab.robot-tcp-position-error-budget-input.v1' as const,
      requirementsFileSha256: createHash('sha256').update(requirementsBytes).digest('hex'),
      frozenRequirementsSha256: verification.frozenRequirementsSha256,
      kinematicModelArtifactSha256: HASH,
      toleranceModelArtifactSha256: HASH,
      calibrationPlanArtifactSha256: HASH,
      physicalValidationPlanArtifactSha256: HASH,
      kinematicJoints: Array.from({ length: 6 }, (_, index) => ({ joint: index + 1, aMm: index === 0 ? 1_000 : 0, alphaDeg: 0, dMm: 0, thetaOffsetDeg: 0 })),
      governedPoses: [{ id: 'home', anglesDeg: [0, 0, 0, 0, 0, 0] }],
      contributors,
    },
  };
}

function jointContributor(id: string, category: 'reducer_lost_motion' | 'encoder_accuracy' | 'joint_mounting', joint: number, accuracyBound: number, repeatabilityBound: number) {
  return { kind: 'joint_angle_arcsec' as const, id, category, joint, accuracyBound, repeatabilityBound, sourceArtifactSha256: HASH, basis: 'Governed supplier or inspection upper bound.' };
}

function positionContributor(id: string, category: 'manufacturing_stack' | 'thermal_drift' | 'structural_compliance' | 'calibration_residual', accuracyBound: number, repeatabilityBound: number) {
  return { kind: 'tcp_position_mm' as const, id, category, accuracyBound, repeatabilityBound, sourceArtifactSha256: HASH, basis: 'Governed Cartesian upper bound.' };
}
