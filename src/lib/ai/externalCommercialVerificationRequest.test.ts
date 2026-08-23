import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createInMemoryExternalCommercialEvidenceStore, type ExternalCommercialEvidence } from './externalCommercialEvidenceStore';
import { normalizedExternalFingerprint, type ExternalCommercialVerifierRegistry } from './externalCommercialVerifierRegistry';
import { buildExternalEvidenceManifest, canonicalExternalVerifierCallbackPayload, createExternalVerificationRequest, externalVerificationRequestSha, EXTERNAL_EVIDENCE_ROLES, verifyExternalVerifierCallback, type ExternalVerifierCallback } from './externalCommercialVerificationRequest';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const common = { tenantId: 'tenant-1', projectId: 'project-1', executionId: 'exec-1', generationRunId: 'run-1', revision: 4, modelContentHash: 'a'.repeat(64), targetSha256: 'b'.repeat(64) };

function fixture() {
  const store = createInMemoryExternalCommercialEvidenceStore();
  for (const [index, role] of EXTERNAL_EVIDENCE_ROLES.entries()) {
    const bytes = new Uint8Array([index + 1, 7, 9]);
    const value: ExternalCommercialEvidence = { ...common, evidenceId: `evidence-${role}`, role, bytes, size: bytes.length, sha256: hash(bytes) };
    void store.put(value);
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const fingerprintSha256 = normalizedExternalFingerprint(publicKeyPem)!;
  const registry: ExternalCommercialVerifierRegistry = { identities: [{ keyId: 'verifier-1', role: 'external_verifier', publicKeyPem, fingerprintSha256 }] };
  return { store, privateKey, registry };
}

async function requestAndCallback() {
  const f = fixture();
  const request = await createExternalVerificationRequest({ ...common, requestId: 'request-1', issuedAt: '2026-08-22T00:00:00.000Z', expiresAt: '2026-08-23T00:00:00.000Z', evidenceIds: EXTERNAL_EVIDENCE_ROLES.map(role => `evidence-${role}`), store: f.store });
  const unsigned = { schema: 'nexyfab.external-commercial-verifier-callback.v1' as const, requestId: request.requestId, claimLeaseId: 'lease-1', keyId: 'verifier-1', fingerprintSha256: f.registry.identities[0].fingerprintSha256, requestSha256: externalVerificationRequestSha(request), evidenceManifestSha256: request.evidenceManifestSha256, finalReceiptSha256: 'c'.repeat(64), executionId: request.executionId, generationRunId: request.generationRunId, revision: request.revision, modelContentHash: request.modelContentHash, targetSha256: request.targetSha256, sequence: 1, issuedAt: '2026-08-22T01:00:00.000Z', expiresAt: '2026-08-22T02:00:00.000Z' };
  const callback: ExternalVerifierCallback = { ...unsigned, signatureBase64: sign(null, Buffer.from(canonicalExternalVerifierCallbackPayload(unsigned)), f.privateKey).toString('base64') };
  return { ...f, request, callback };
}

describe('external commercial verification request', () => {
  it('requires all six exact stored evidence roles and binds their bytes/identity', async () => {
    const f = fixture();
    await expect(createExternalVerificationRequest({ ...common, requestId: 'request-1', issuedAt: '2026-08-22T00:00:00.000Z', expiresAt: '2026-08-23T00:00:00.000Z', evidenceIds: EXTERNAL_EVIDENCE_ROLES.slice(0, 5).map(role => `evidence-${role}`), store: f.store })).rejects.toThrow('external_evidence_request_invalid');
    const request = await createExternalVerificationRequest({ ...common, requestId: 'request-1', issuedAt: '2026-08-22T00:00:00.000Z', expiresAt: '2026-08-23T00:00:00.000Z', evidenceIds: EXTERNAL_EVIDENCE_ROLES.map(role => `evidence-${role}`), store: f.store });
    expect(request.status).toBe('PENDING');
    const loaded = await Promise.all(EXTERNAL_EVIDENCE_ROLES.map(role => f.store.get(common.tenantId, common.projectId, `evidence-${role}`)));
    expect(buildExternalEvidenceManifest(loaded.filter(Boolean) as ExternalCommercialEvidence[])).toEqual(expect.objectContaining({ sha256: request.evidenceManifestSha256 }));
  });

  it('accepts one current signed callback and rejects replay/transplant/time/key forgery', async () => {
    const { request, callback, registry } = await requestAndCallback();
    expect(verifyExternalVerifierCallback(request, callback, registry, new Date('2026-08-22T01:30:00.000Z'))).toBe(true);
    expect(verifyExternalVerifierCallback({ ...request, targetSha256: 'd'.repeat(64) }, callback, registry, new Date('2026-08-22T01:30:00.000Z'))).toBe(false);
    expect(verifyExternalVerifierCallback(request, { ...callback, sequence: 2 }, registry, new Date('2026-08-22T01:30:00.000Z'))).toBe(false);
    expect(verifyExternalVerifierCallback(request, { ...callback, issuedAt: '2026-08-22T03:00:00.000Z' }, registry, new Date('2026-08-22T01:30:00.000Z'))).toBe(false);
    expect(verifyExternalVerifierCallback(request, { ...callback, fingerprintSha256: 'e'.repeat(64) }, registry, new Date('2026-08-22T01:30:00.000Z'))).toBe(false);
    expect(verifyExternalVerifierCallback(request, { ...callback, finalReceiptSha256: 'bad' }, registry, new Date('2026-08-22T01:30:00.000Z'))).toBe(false);
  });

  it('rejects evidence transplant and immutable metadata conflict', async () => {
    const f = fixture();
    const original = await f.store.get(common.tenantId, common.projectId, 'evidence-command');
    expect(original).toBeDefined();
    expect(await f.store.put({ ...original!, targetSha256: 'd'.repeat(64) })).toMatchObject({ ok: false, code: 'EVIDENCE_IMMUTABLE_CONFLICT' });
    expect(await f.store.put({ ...original!, tenantId: 'other-tenant' })).toMatchObject({ ok: true });
  });
});
