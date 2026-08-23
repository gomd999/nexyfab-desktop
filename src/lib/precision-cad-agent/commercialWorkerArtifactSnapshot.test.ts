import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CommercialWorkerReceipt } from '../../../packages/job-contracts/src/commercialPrecisionExecution';
import { canonicalCommercialWorkerReceiptPayload, commercialWorkerReceiptHash } from './commercialWorkerReceipt';
import { InMemoryImmutableArtifactStore, snapshotCommercialWorkerArtifacts } from './commercialWorkerArtifactSnapshot';

const keys = generateKeyPairSync('ed25519');
const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const fingerprint = createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
const bytes = (value: string) => new TextEncoder().encode(value);
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
function fixture(): CommercialWorkerReceipt {
  const values = [['model', 'STEP'], ['report', '{}'], ['verification', 'PASS'] as const];
  const receipt = { schema: 'nexyfab.precision-cad-commercial-execution.v2' as const, tenantId: 'tenant-1', projectId: 'project-1', executionId: 'exec-1', generationRunId: 'run-1', generationStateRevision: 11, generationProgramSha256: '8'.repeat(64), workspaceId: 'workspace-1', workspaceRevision: 7, workspaceContentHash: 'a'.repeat(64), journalVersion: 3, leaseGeneration: 1, leaseCapabilityHash: '9'.repeat(64), attempt: 1, jobId: 'job-1', commandHash: 'c'.repeat(64), targetHash: 'd'.repeat(64), workerIdentity: 'worker-1', workerPublicKeyFingerprint: fingerprint, status: 'PASS' as const, startedAt: '2026-08-22T00:00:00.000Z', completedAt: '2026-08-22T00:01:00.000Z', outputArtifacts: values.map(([role, value], index) => { const body = bytes(value); return { artifactId: `${role}-1`, role: role as 'model' | 'report' | 'verification', contentSha256: digest(body), byteLength: body.byteLength, objectKey: `source/${role}-${index}` }; }), failureReasons: [], signatureBase64: '' };
  receipt.signatureBase64 = sign(null, Buffer.from(canonicalCommercialWorkerReceiptPayload(receipt)), keys.privateKey).toString('base64');
  return receipt;
}
describe('commercial worker artifact snapshot', () => {
  it('hashes, copies, and authoritatively rereads all exact outputs', async () => {
    const receipt = fixture(); const store = new InMemoryImmutableArtifactStore();
    receipt.outputArtifacts.forEach((artifact, index) => store.seed(artifact.objectKey, bytes(['STEP', '{}', 'PASS'][index]!)));
    const result = await snapshotCommercialWorkerArtifacts({ store, receipt, expected: { ...receipt }, trustedWorkers: { 'worker-1': { workerIdentity: 'worker-1', publicKeyPem, fingerprintSha256: fingerprint } }, metadata: receipt.outputArtifacts });
    expect(result.ok).toBe(true); if (result.ok) expect(result.snapshots.every(item => item.snapshotObjectKey.startsWith('private/commercial-snapshots/'))).toBe(true);
    const replay = await snapshotCommercialWorkerArtifacts({ store, receipt, expected: { ...receipt }, trustedWorkers: { 'worker-1': { workerIdentity: 'worker-1', publicKeyPem, fingerprintSha256: fingerprint } }, metadata: receipt.outputArtifacts });
    expect(replay.ok).toBe(true);
  });
  it('fails closed on source TOCTOU/hash mismatch and never reports persistence', async () => {
    const receipt = fixture(); const store = new InMemoryImmutableArtifactStore(); receipt.outputArtifacts.forEach(artifact => store.seed(artifact.objectKey, bytes('wrong')));
    const result = await snapshotCommercialWorkerArtifacts({ store, receipt, expected: { ...receipt }, trustedWorkers: { 'worker-1': { workerIdentity: 'worker-1', publicKeyPem, fingerprintSha256: fingerprint } }, metadata: receipt.outputArtifacts });
    expect(result.ok).toBe(false); if (result.ok) throw new Error('unexpected_snapshot_success'); expect(result.code).toBe('ARTIFACT_HASH_MISMATCH'); expect(commercialWorkerReceiptHash(receipt)).toHaveLength(64);
  });
});
