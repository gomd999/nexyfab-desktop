import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encodeAgenticCommercialReceiptEnvelope } from './agenticCommercialReceiptCodec';
import { createInMemoryVerifiedAgenticCommercialReceiptStore } from './verifiedAgenticCommercialReceiptStore';
import { loadVerifiedAgenticCommercialReceiptForGeneration } from './loadVerifiedAgenticCommercialReceiptForGeneration';

const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const common = { executionId: 'exec-1', generationRunId: 'run-1', generationStateRevision: 11, generationProgramSha256: '9'.repeat(64), targetSha256: 'b'.repeat(64), project: { projectId: 'project-1', workspaceId: 'workspace-1', revision: 2, contentHash: 'c'.repeat(64), modelContentHash: 'a'.repeat(64) }, artifactManifestSha256: 'd'.repeat(64), parser: { receiptSha256: 'e'.repeat(64) }, executionJournal: { sha256: 'f'.repeat(64) } };
function value(kind: 'candidate' | 'final' = 'final') { const payload = { ...common, bytes: new Uint8Array([1, 2]), schema: 'nexyfab.agentic-commercial-qualification-receipt.v1' }; const finalEnvelopeBytes = encodeAgenticCommercialReceiptEnvelope(kind, payload); return { receiptId: 'receipt-1', tenantId: 'tenant-1', projectId: 'project-1', executionId: common.executionId, generationRunId: common.generationRunId, revision: 2, modelContentHash: 'a'.repeat(64), targetSha256: common.targetSha256, candidateEnvelopeSha256: hash(encodeAgenticCommercialReceiptEnvelope('candidate', payload)), finalEnvelopeBytes, verifierKeyId: 'external-1', verifierFingerprintSha256: '2'.repeat(64), issuedAt: '2026-08-22T00:00:00.000Z', expiresAt: '2026-08-23T00:00:00.000Z' }; }

describe('verified agentic commercial receipt store', () => {
  it('stores only final envelopes with exact generation binding and idempotent replay', async () => {
    const store = createInMemoryVerifiedAgenticCommercialReceiptStore(); const input = value();
    expect(await store.put(input)).toMatchObject({ ok: true, finalEnvelopeSha256: hash(input.finalEnvelopeBytes) });
    expect(await store.put(input)).toMatchObject({ ok: true });
    expect(await store.put({ ...input, receiptId: 'receipt-bad-candidate', candidateEnvelopeSha256: '1'.repeat(64) })).toMatchObject({ ok: false, code: 'FINAL_ENVELOPE_INVALID_OR_UNBOUND' });
    expect(await store.put({ ...input, finalEnvelopeBytes: encodeAgenticCommercialReceiptEnvelope('candidate', { ...common }) })).toMatchObject({ ok: false, code: 'FINAL_ENVELOPE_INVALID_OR_UNBOUND' });
    expect((await store.get('tenant-1', 'project-1', 'receipt-1'))?.payload).toMatchObject({ executionId: 'exec-1' });
  });

  it('keeps generation loader HOLD on transplant/expiry and never legacy ledger-only PASS', async () => {
    const store = createInMemoryVerifiedAgenticCommercialReceiptStore(); const input = value(); await store.put(input);
    const context = { trustedRegistry: [], now: new Date('2026-08-22T12:00:00.000Z'), mode: 'runtime' as const };
    await expect(loadVerifiedAgenticCommercialReceiptForGeneration(store, { tenantId: 'tenant-1', projectId: 'project-1', receiptId: 'receipt-1', executionId: 'other-exec', generationRunId: 'run-1', generationStateRevision: common.generationStateRevision, generationProgramSha256: common.generationProgramSha256, revision: 2, modelContentHash: 'a'.repeat(64), targetSha256: common.targetSha256 }, context)).resolves.toMatchObject({ status: 'HOLD', releaseReady: false, issues: ['verified_final_receipt_binding_mismatch'] });
    const expired = { ...input, receiptId: 'receipt-expired', expiresAt: '2026-08-22T01:00:00.000Z' }; await store.put(expired);
    await expect(loadVerifiedAgenticCommercialReceiptForGeneration(store, { tenantId: 'tenant-1', projectId: 'project-1', receiptId: 'receipt-expired', executionId: 'exec-1', generationRunId: 'run-1', generationStateRevision: common.generationStateRevision, generationProgramSha256: common.generationProgramSha256, revision: 2, modelContentHash: 'a'.repeat(64), targetSha256: common.targetSha256 }, context)).resolves.toMatchObject({ status: 'HOLD', releaseReady: false, issues: ['verified_final_receipt_expired_or_future'] });
    await expect(loadVerifiedAgenticCommercialReceiptForGeneration(store, { tenantId: 'tenant-1', projectId: 'project-1', receiptId: 'receipt-1', executionId: 'exec-1', generationRunId: 'run-1', generationStateRevision: common.generationStateRevision, generationProgramSha256: '8'.repeat(64), revision: 2, modelContentHash: 'a'.repeat(64), targetSha256: common.targetSha256 }, context)).resolves.toMatchObject({ status: 'HOLD', releaseReady: false, issues: ['verified_final_receipt_program_binding_mismatch'] });
  });
});
