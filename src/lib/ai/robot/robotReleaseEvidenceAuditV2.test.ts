import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { auditRobotReleaseEvidenceV2, robotExactCadEvidencePayload, robotManufacturingEvidencePayloadV2 } from './robotReleaseEvidenceAuditV2';

const enc = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`), programHash = 'a'.repeat(64);
const exactKey = generateKeyPairSync('ed25519'), manufacturingKey = generateKeyPairSync('ed25519');
const exactPem = exactKey.publicKey.export({ type: 'spki', format: 'pem' }).toString(), manufacturingPem = manufacturingKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const identity = createHash('sha256').update(exactKey.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
const post = { schema: 'nexyfab.robot-post-integration-evidence.v1', postIntegrationStatus: 'passed', programHash, targetHash: 'b'.repeat(64), catalogManifestSha256: 'c'.repeat(64), releaseReady: false, errors: [], counts: { selectedOccurrences: 18, motionFrames: 156, checkedMotionFrames: 156, collisionFrames: 0, preciseInterferences: 0 } };
function exact(hash = programHash) { const value = { schema: 'nexyfab.robot-exact-cad-evidence.v1' as const, programHash: hash, signerId: 'nexyfab-kernel-1', signerIdentitySha256: identity, kernelStackIdentitySha256: '1'.repeat(64), kernelEvidenceSha256: '2'.repeat(64), revisionManifestSha256: '3'.repeat(64), assemblyStepSha256: '4'.repeat(64), drawingPackageSha256: '5'.repeat(64), generatedAt: '2026-08-09T00:00:00.000Z', partCount: 25 as const, jointCount: 6 as const, checks: { partRoundtrip: true as const, assemblyXcafRoundtrip: true as const, motion: true as const, interference: true as const, drawing: true as const, units: true as const, topology: true as const } }; return { ...value, signature: sign(null, Buffer.from(robotExactCadEvidencePayload(value)), exactKey.privateKey).toString('base64') }; }
function manufacturing() { const value = { schema: 'nexyfab.robot-manufacturing-validation.v1' as const, programHash, catalogArtifactSetSha256: 'f'.repeat(64), reviewerId: 'mfg-1', generatedAt: '2026-08-09T00:00:00.000Z', selectedComponentCount: 18 as const, checks: { dfm: true as const, toleranceStack: true as const, bom: true as const, fasteners: true as const, cableRouting: true as const, materials: true as const, processPlan: true as const } }; return { ...value, signature: sign(null, Buffer.from(robotManufacturingEvidencePayloadV2(value)), manufacturingKey.privateKey).toString('base64') }; }

describe('CAD-independent robot release evidence audit v2', () => {
  it('uses signed NexyFab exact CAD evidence without external CAD', () => {
    const report = auditRobotReleaseEvidenceV2(enc(post), enc(exact()), enc(manufacturing()), { 'nexyfab-kernel-1': { publicKey: exactPem } }, { 'mfg-1': { publicKey: manufacturingPem } });
    expect(report).toMatchObject({ status: 'ready_for_final_review', exactCadEvidenceValid: true, manufacturingEvidenceValid: true, externalCadRequired: false, releaseReady: false, errors: [], blockers: ['final_release_dual_signoff_required'] });
  });
  it('fails closed on missing evidence or a program mismatch', () => {
    expect(auditRobotReleaseEvidenceV2(enc(post), null, null, {}, {}).status).toBe('not_ready');
    expect(auditRobotReleaseEvidenceV2(enc(post), enc(exact('9'.repeat(64))), enc(manufacturing()), { 'nexyfab-kernel-1': { publicKey: exactPem } }, { 'mfg-1': { publicKey: manufacturingPem } }).errors).toContain('exact CAD evidence program hash mismatch');
  });
});
