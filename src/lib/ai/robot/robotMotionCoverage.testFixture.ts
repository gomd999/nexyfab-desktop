import { createHash, generateKeyPairSync } from 'node:crypto';
import { buildValidRobotSystemRequirementsFixture } from './robotSystemRequirements.testFixture';
import { verifyRobotSystemRequirementsBytes } from './robotSystemRequirements';
import { createRobotSweptEvidenceArtifactBytes, robotSweptEvidenceBindingSha256 } from './robotMotionCoverage';

const HASH = 'a'.repeat(64);
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const WORKER_KEY = generateKeyPairSync('ed25519');
const KERNEL_KEY = generateKeyPairSync('ed25519');

export function buildRobotMotionCoverageFixture() {
  const requirementsBytes = encode(buildValidRobotSystemRequirementsFixture());
  const verification = verifyRobotSystemRequirementsBytes(requirementsBytes);
  if (!verification.frozenRequirementsSha256) throw new Error('requirements fixture must verify');
  const workerPublicKey = WORKER_KEY.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const kernelPublicKey = KERNEL_KEY.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const trustedSigners = new Map([
    ['worker-fixture', { publicKey: workerPublicKey, role: 'worker' as const, identitySha256: 'd'.repeat(64) }],
    ['kernel-fixture', { publicKey: kernelPublicKey, role: 'kernel' as const, identitySha256: 'e'.repeat(64) }],
  ]);
  const combinations = ['payload-zero', 'payload-rated', 'payload-eccentric'].map(payloadCaseId => ({
    id: `${payloadCaseId}-path-cycle-a`,
    payloadCaseId,
    governedPathId: 'path-cycle-a',
    governedPathArtifactSha256: HASH,
    frames: [
      { timeS: 0, anglesDeg: [0, 0, 0, 0, 0, 0], jacobianConditionNumber: 10, endpointClearanceMm: 10, workspaceCellIds: ['cell-a'] },
      { timeS: 1, anglesDeg: [1, 0, 0, 0, 0, 0], jacobianConditionNumber: 20, endpointClearanceMm: 8, workspaceCellIds: ['cell-b'] },
    ],
    segments: [{ fromFrame: 0, toFrame: 1, maximumJointDeltaDeg: 1, continuousMinimumClearanceMm: 8, method: 'exact_brep_continuous_collision' as const, evidenceArtifactSha256: HASH }],
  }));
  const sweptEvidenceArtifacts = new Map<string, Uint8Array>();
  const boundCombinations = combinations.map(combination => {
    const unsignedArtifact = {
      schema: 'nexyfab.robot-swept-evidence-artifact.v1' as const,
      frozenRequirementsSha256: verification.frozenRequirementsSha256!,
      governedPathArtifactSha256: combination.governedPathArtifactSha256,
      payloadCaseId: combination.payloadCaseId,
      governedPathId: combination.governedPathId,
      combinationId: combination.id,
      fromFrame: 0,
      toFrame: 1,
      method: 'exact_brep_continuous_collision' as const,
      continuousMinimumClearanceMm: 8,
      workerIdentitySha256: 'd'.repeat(64),
      kernelIdentitySha256: 'e'.repeat(64),
    };
    const bytes = createRobotSweptEvidenceArtifactBytes(unsignedArtifact, [
      { issuerId: 'worker-fixture', role: 'worker', privateKey: WORKER_KEY.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
      { issuerId: 'kernel-fixture', role: 'kernel', privateKey: KERNEL_KEY.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
    ]);
    const evidenceArtifactSha256 = digest(bytes);
    sweptEvidenceArtifacts.set(evidenceArtifactSha256, bytes);
    const withEvidence = { ...combination, segments: [{ ...combination.segments[0]!, evidenceArtifactSha256 }] };
    return { ...withEvidence, sweptEvidenceBindingSha256: robotSweptEvidenceBindingSha256(withEvidence) };
  });
  const motionInput = {
    schema: 'nexyfab.robot-motion-coverage-input.v1' as const,
    requirementsFileSha256: digest(requirementsBytes),
    frozenRequirementsSha256: verification.frozenRequirementsSha256,
    coveragePlanArtifactSha256: HASH,
    exactGeometryArtifactSha256: HASH,
    obstacleSetArtifactSha256: HASH,
    policy: { maximumJointStepDeg: 5, adaptiveMaximumJointStepDeg: 1.5, nearContactThresholdMm: 5, minimumAllowedClearanceMm: 2, nearSingularityConditionNumber: 100 },
    requiredWorkspaceCellIds: ['cell-a', 'cell-b'],
    combinations: boundCombinations,
  };
  return { requirementsBytes, motionInput, sweptEvidenceArtifacts, trustedSigners };
}
