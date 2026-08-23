import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { robotExactCadEvidencePayload, robotManufacturingEvidencePayloadV3, type TrustedRobotExactCadKeys } from './robotReleaseEvidenceAuditV2';
import { buildRobotPhysicalValidationReceiptFixture } from './robotPhysicalValidationReceipt.testFixture';
import type { TrustedRobotPhysicalValidationKeys } from './robotPhysicalValidationReceipt';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function buildRobotVerifiedSystemsReleaseAuditFixture() {
  const physical = buildRobotPhysicalValidationReceiptFixture();
  const post = {
    schema: 'nexyfab.robot-post-integration-evidence.v1', postIntegrationStatus: 'passed', integrationAuthorized: true, selectedOccurrencesVerified: true, precisionStatus: 'passed', lineageId: 'robot-lineage', revision: 3,
    programHash: 'a'.repeat(64), preciseReportHash: '6'.repeat(64), applicationReceiptHash: '7'.repeat(64), applicationHash: '8'.repeat(64), targetHash: 'b'.repeat(64), catalogManifestSha256: 'c'.repeat(64), housingSha256: '9'.repeat(64),
    releaseReady: false, blockers: ['nexyfab_exact_cad_evidence_required', 'manufacturing_validation_required', 'final_expert_release_review_required'], errors: [],
    counts: { selectedOccurrences: 18, auxiliaryOccurrences: 4, appliedOccurrences: 22, catalogUnresolved: 0, motionFrames: 156, checkedMotionFrames: 156, collisionFrames: 0, coordinatedMotionFrames: 49, checkedCoordinatedMotionFrames: 49, coordinatedCollisionFrames: 0, preciseInterferences: 0 },
    sideEffects: { persisted: false, sourceModified: false, workspaceModified: false, quoteCreated: false, rfqSent: false },
  };
  const exactKey = generateKeyPairSync('ed25519'), manufacturingKey = generateKeyPairSync('ed25519'), auditKey = generateKeyPairSync('ed25519');
  const exactPublic = exactKey.publicKey.export({ type: 'spki', format: 'pem' }).toString(), manufacturingPublic = manufacturingKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const exactUnsigned = { schema: 'nexyfab.robot-exact-cad-evidence.v3' as const, lineageId: post.lineageId, revision: post.revision, programHash: post.programHash, targetHash: post.targetHash, applicationHash: post.applicationHash, applicationReceiptHash: post.applicationReceiptHash, preciseReportHash: post.preciseReportHash, catalogManifestSha256: post.catalogManifestSha256, housingSha256: post.housingSha256, signerId: 'nexyfab-kernel-1', signerIdentitySha256: fingerprint(exactKey.publicKey), kernelStackIdentitySha256: '1'.repeat(64), kernelEvidenceSha256: '2'.repeat(64), revisionManifestSha256: '3'.repeat(64), assemblyStepSha256: '4'.repeat(64), drawingPackageSha256: '5'.repeat(64), generatedAt: '2026-08-09T00:00:00.000Z', partCount: 29 as const, jointCount: 6 as const, checks: { partRoundtrip: true as const, assemblyXcafRoundtrip: true as const, motion: true as const, interference: true as const, drawing: true as const, units: true as const, topology: true as const } };
  const manufacturingUnsigned = { schema: 'nexyfab.robot-manufacturing-validation.v3' as const, lineageId: post.lineageId, revision: post.revision, programHash: post.programHash, targetHash: post.targetHash, applicationHash: post.applicationHash, applicationReceiptHash: post.applicationReceiptHash, preciseReportHash: post.preciseReportHash, catalogManifestSha256: post.catalogManifestSha256, housingSha256: post.housingSha256, catalogArtifactSetSha256: 'f'.repeat(64), reviewerId: 'mfg-1', reviewerIdentitySha256: fingerprint(manufacturingKey.publicKey), generatedAt: '2026-08-09T00:00:00.000Z', selectedComponentCount: 22 as const, driveComponentCount: 18 as const, auxiliaryComponentCount: 4 as const, checks: { dfm: true as const, toleranceStack: true as const, bom: true as const, fasteners: true as const, cableRouting: true as const, materials: true as const, processPlan: true as const } };
  const engineering = JSON.parse(new TextDecoder().decode(physical.upstream.engineeringCoverage)) as { frozenRequirementsSha256: string; coverageHash: string };
  const motion = JSON.parse(new TextDecoder().decode(physical.upstream.motionCoverage)) as { coverageHash: string };
  const cable = JSON.parse(new TextDecoder().decode(physical.upstream.cableLife)) as { cableInputSha256: string };
  const safety = JSON.parse(new TextDecoder().decode(physical.upstream.safetyElectrical)) as { inputSha256: string };
  const files = {
    postIntegration: encode(post),
    exactCadEvidence: encode({ ...exactUnsigned, signature: sign(null, Buffer.from(robotExactCadEvidencePayload(exactUnsigned)), exactKey.privateKey).toString('base64') }),
    manufacturingEvidence: encode({ ...manufacturingUnsigned, signature: sign(null, Buffer.from(robotManufacturingEvidencePayloadV3(manufacturingUnsigned)), manufacturingKey.privateKey).toString('base64') }),
    engineeringCoverage: physical.upstream.engineeringCoverage,
    motionCoverage: physical.upstream.motionCoverage,
    cableLife: physical.upstream.cableLife,
    safetyElectrical: physical.upstream.safetyElectrical,
    physicalReceipt: physical.receiptBytes,
    systemBinding: encode({ schema: 'nexyfab.robot-verified-systems-release-binding.v1', postIntegrationTargetHash: post.targetHash, postIntegrationApplicationHash: post.applicationHash, frozenRequirementsSha256: engineering.frozenRequirementsSha256, engineeringCoverageHash: engineering.coverageHash, motionCoverageHash: motion.coverageHash, cableInputSha256: cable.cableInputSha256, safetyElectricalInputSha256: safety.inputSha256, physicalValidationReceiptSha256: digest(physical.receiptBytes) }),
  };
  const trusted: { exactCad: TrustedRobotExactCadKeys; manufacturing: TrustedRobotExactCadKeys; physical: TrustedRobotPhysicalValidationKeys } = { exactCad: { 'nexyfab-kernel-1': { publicKey: exactPublic } }, manufacturing: { 'mfg-1': { publicKey: manufacturingPublic } }, physical: physical.trustedKeys };
  const auditSigner = { auditorId: 'verified-auditor-1', privateKey: auditKey.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), issuedAt: '2026-08-12T02:30:00.000Z' };
  const trustedAuditIssuers = { 'verified-auditor-1': { publicKey: auditKey.publicKey.export({ type: 'spki', format: 'pem' }).toString() } };
  return { files, artifacts: physical.artifacts, trusted, auditSigner, trustedAuditIssuers };
}

function fingerprint(key: ReturnType<typeof generateKeyPairSync>['publicKey']) { return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex'); }
