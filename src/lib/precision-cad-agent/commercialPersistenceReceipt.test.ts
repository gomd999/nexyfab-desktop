import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { NativeParserReceipt } from './commercialPersistenceReceipt';
import { canonicalNativeParserReceipt, nativeParserReceiptHash, verifyNativeParserReceipt } from './commercialPersistenceReceipt';
const keys = generateKeyPairSync('ed25519');
const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const fingerprint = createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
const receipt = (): NativeParserReceipt => ({ schema: 'nexyfab.precision-cad-native-parser-receipt.v1', parserIdentity: 'occt-parser', parserPublicKeyFingerprint: fingerprint, parserRole: 'native_parser', format: 'STEP', kernelIdentity: 'occt-7.8.1', modelArtifactId: 'model-1', workspaceEnvelopeArtifactId: 'report-1', modelContentSha256: 'f'.repeat(64), targetHash: 'd'.repeat(64), workspaceAfter: { workspaceId: 'workspace-1', projectId: 'project-1', revision: 8, contentHash: 'b'.repeat(64) }, manifest: [{ artifactId: 'model-1', role: 'model', objectKey: 'private/commercial-snapshots/model', contentSha256: 'f'.repeat(64), byteLength: 10 }, { artifactId: 'report-1', role: 'report', objectKey: 'private/commercial-snapshots/report', contentSha256: 'e'.repeat(64), byteLength: 10 }], issuedAt: '2026-08-22T00:00:00.000Z', completedAt: '2026-08-22T00:01:00.000Z', signatureBase64: '' });
describe('commercial persistence receipt', () => {
  it('requires trusted native parser signature and exact snapshot manifest', () => {
    const value = receipt(); value.signatureBase64 = sign(null, Buffer.from(canonicalNativeParserReceipt(value)), keys.privateKey).toString('base64');
    const result = verifyNativeParserReceipt({ receipt: value, expected: { tenantId: 'tenant-1', projectId: 'project-1', executionId: 'exec-1', generationRunId: 'run-1', jobId: 'job-1', targetHash: value.targetHash, workspaceId: 'workspace-1', workspaceRevision: 7, workspaceContentHash: 'a'.repeat(64) }, snapshots: [{ artifactId: 'model-1', role: 'model', objectKey: 'source/model', contentSha256: 'f'.repeat(64), byteLength: 10, snapshotObjectKey: 'private/commercial-snapshots/model', snapshotSha256: 'f'.repeat(64), snapshotByteLength: 10 }, { artifactId: 'report-1', role: 'report', objectKey: 'source/report', contentSha256: 'e'.repeat(64), byteLength: 10, snapshotObjectKey: 'private/commercial-snapshots/report', snapshotSha256: 'e'.repeat(64), snapshotByteLength: 10 }], trustedParser: { parserIdentity: 'occt-parser', publicKeyPem, fingerprintSha256: fingerprint }, now: Date.parse('2026-08-22T00:02:00.000Z') });
    expect(result.ok).toBe(true); expect(nativeParserReceiptHash(value)).toHaveLength(64);
  });
  it('rejects a parser receipt without an exact report-backed workspace envelope', () => {
    const value = receipt(); value.workspaceEnvelopeArtifactId = 'missing'; value.signatureBase64 = sign(null, Buffer.from(canonicalNativeParserReceipt(value)), keys.privateKey).toString('base64');
    const result = verifyNativeParserReceipt({ receipt: value, expected: { tenantId: 'tenant-1', projectId: 'project-1', executionId: 'exec-1', generationRunId: 'run-1', jobId: 'job-1', targetHash: value.targetHash, workspaceId: 'workspace-1', workspaceRevision: 7, workspaceContentHash: 'a'.repeat(64) }, snapshots: [], trustedParser: { parserIdentity: 'occt-parser', publicKeyPem, fingerprintSha256: fingerprint }, now: Date.parse('2026-08-22T00:02:00.000Z') });
    expect(result).toMatchObject({ ok: false }); if (!result.ok) expect(result.issues).toContain('workspace_envelope_artifact_invalid');
  });
});
