import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { auditRobotReleaseEvidenceV2, robotExactCadEvidencePayload, robotManufacturingEvidencePayloadV3 } from './robotReleaseEvidenceAuditV2';

const enc = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);
const programHash = 'a'.repeat(64);
const exactKey = generateKeyPairSync('ed25519');
const manufacturingKey = generateKeyPairSync('ed25519');
const exactPem = exactKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const manufacturingPem = manufacturingKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const identity = createHash('sha256').update(exactKey.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
const manufacturingIdentity = createHash('sha256').update(manufacturingKey.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
const post = {
  schema: 'nexyfab.robot-post-integration-evidence.v1', postIntegrationStatus: 'passed', integrationAuthorized: true,
  selectedOccurrencesVerified: true, precisionStatus: 'passed', lineageId: 'robot-lineage', revision: 3,
  programHash, preciseReportHash: '6'.repeat(64), applicationReceiptHash: '7'.repeat(64), applicationHash: '8'.repeat(64),
  targetHash: 'b'.repeat(64), catalogManifestSha256: 'c'.repeat(64), housingSha256: '9'.repeat(64),
  releaseReady: false, blockers: ['nexyfab_exact_cad_evidence_required', 'manufacturing_validation_required', 'final_expert_release_review_required'], errors: [],
  counts: { selectedOccurrences: 18, auxiliaryOccurrences: 4, appliedOccurrences: 22, catalogUnresolved: 0, motionFrames: 156, checkedMotionFrames: 156, collisionFrames: 0, coordinatedMotionFrames: 49, checkedCoordinatedMotionFrames: 49, coordinatedCollisionFrames: 0, preciseInterferences: 0 },
  sideEffects: { persisted: false, sourceModified: false, workspaceModified: false, quoteCreated: false, rfqSent: false },
};

function exact(hash = programHash) {
  const value = {
    schema: 'nexyfab.robot-exact-cad-evidence.v3' as const, lineageId: post.lineageId, revision: post.revision,
    programHash: hash, targetHash: post.targetHash, applicationHash: post.applicationHash,
    applicationReceiptHash: post.applicationReceiptHash, preciseReportHash: post.preciseReportHash,
    catalogManifestSha256: post.catalogManifestSha256, housingSha256: post.housingSha256, signerId: 'nexyfab-kernel-1',
    signerIdentitySha256: identity, kernelStackIdentitySha256: '1'.repeat(64), kernelEvidenceSha256: '2'.repeat(64),
    revisionManifestSha256: '3'.repeat(64), assemblyStepSha256: '4'.repeat(64), drawingPackageSha256: '5'.repeat(64),
    generatedAt: '2026-08-09T00:00:00.000Z', partCount: 29 as const, jointCount: 6 as const,
    checks: { partRoundtrip: true as const, assemblyXcafRoundtrip: true as const, motion: true as const, interference: true as const, drawing: true as const, units: true as const, topology: true as const },
  };
  return { ...value, signature: sign(null, Buffer.from(robotExactCadEvidencePayload(value)), exactKey.privateKey).toString('base64') };
}

function manufacturing() {
  const value = {
    schema: 'nexyfab.robot-manufacturing-validation.v3' as const, lineageId: post.lineageId, revision: post.revision,
    programHash, targetHash: post.targetHash, applicationHash: post.applicationHash,
    applicationReceiptHash: post.applicationReceiptHash, preciseReportHash: post.preciseReportHash,
    catalogManifestSha256: post.catalogManifestSha256, housingSha256: post.housingSha256,
    catalogArtifactSetSha256: 'f'.repeat(64), reviewerId: 'mfg-1', reviewerIdentitySha256: manufacturingIdentity,
    generatedAt: '2026-08-09T00:00:00.000Z', selectedComponentCount: 22 as const,
    driveComponentCount: 18 as const, auxiliaryComponentCount: 4 as const,
    checks: { dfm: true as const, toleranceStack: true as const, bom: true as const, fasteners: true as const, cableRouting: true as const, materials: true as const, processPlan: true as const },
  };
  return { ...value, signature: sign(null, Buffer.from(robotManufacturingEvidencePayloadV3(value)), manufacturingKey.privateKey).toString('base64') };
}

describe('CAD-independent robot release evidence audit v2', () => {
  it('uses signed NexyFab exact CAD evidence without external CAD', () => {
    const report = auditRobotReleaseEvidenceV2(enc(post), enc(exact()), enc(manufacturing()), { 'nexyfab-kernel-1': { publicKey: exactPem } }, { 'mfg-1': { publicKey: manufacturingPem } });
    expect(report).toMatchObject({ status: 'ready_for_final_review', exactCadEvidenceValid: true, manufacturingEvidenceValid: true, externalCadRequired: false, releaseReady: false, errors: [], blockers: ['final_release_dual_signoff_required'] });
  });

  it('fails closed on missing evidence or a program mismatch', () => {
    expect(auditRobotReleaseEvidenceV2(enc(post), null, null, {}, {}).status).toBe('not_ready');
    expect(auditRobotReleaseEvidenceV2(enc(post), enc(exact('9'.repeat(64))), enc(manufacturing()), { 'nexyfab-kernel-1': { publicKey: exactPem } }, { 'mfg-1': { publicKey: manufacturingPem } }).errors.join('|')).toContain('exact CAD evidence programHash mismatch');
  });

  it('rejects a release audit when any auxiliary occurrence disappears', () => {
    const incomplete = { ...post, counts: { ...post.counts, auxiliaryOccurrences: 3, appliedOccurrences: 21 } };
    const report = auditRobotReleaseEvidenceV2(enc(incomplete), enc(exact()), enc(manufacturing()), { 'nexyfab-kernel-1': { publicKey: exactPem } }, { 'mfg-1': { publicKey: manufacturingPem } });
    expect(report.status).toBe('not_ready');
    expect(report.errors.join(',')).toMatch(/auxiliaryOccurrences|appliedOccurrences/);
  });

  it('rejects signed evidence replayed against another integration target', () => {
    const anotherTarget = { ...post, targetHash: 'd'.repeat(64) };
    const report = auditRobotReleaseEvidenceV2(enc(anotherTarget), enc(exact()), enc(manufacturing()), { 'nexyfab-kernel-1': { publicKey: exactPem } }, { 'mfg-1': { publicKey: manufacturingPem } });
    expect(report.status).toBe('not_ready');
    expect(report.errors).toContain('exact CAD evidence targetHash mismatch');
    expect(report.errors).toContain('manufacturing evidence targetHash mismatch');
  });
});
