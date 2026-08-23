// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { issueCommercialFinalizationReceipt, verifyCommercialFinalizationReceipt } from './commercialFinalizationReceipt';

const secret = 'commercial-generation-evidence-secret-32-bytes';
const input = { runId: 'run-1', revision: 7, partId: 'pump-1', programSha256: 'a'.repeat(64), kernelCheckpointHash: 'b'.repeat(64), topologyCheckpointHash: 'c'.repeat(64), partEvidence: { volumeMm3: 100, exact: true } };

describe('commercial finalization receipt', () => {
  it('binds server-measured evidence to run, revision, part and program', () => {
    const now = new Date('2026-08-12T00:00:00.000Z');
    const receipt = issueCommercialFinalizationReceipt(input, secret, now);
    expect(verifyCommercialFinalizationReceipt(receipt, input, secret, new Date(now.getTime() + 1000))).toEqual([]);
  });

  it('rejects changed measurements, signatures and expired receipts', () => {
    const now = new Date('2026-08-12T00:00:00.000Z');
    const receipt = issueCommercialFinalizationReceipt(input, secret, now, 1000);
    expect(verifyCommercialFinalizationReceipt(receipt, { ...input, partEvidence: { volumeMm3: 99, exact: true } }, secret, now)).toContain('CLIENT_ASSERTED_MEASUREMENT_REJECTED');
    expect(verifyCommercialFinalizationReceipt({ ...receipt, signature: '0'.repeat(64) }, input, secret, now)).toContain('RELEASE_EVIDENCE_SIGNATURE_INVALID');
    expect(verifyCommercialFinalizationReceipt(receipt, { ...input, kernelCheckpointHash: 'd'.repeat(64) }, secret, now)).toContain('GENERATION_EXACT_CAD_CHECKPOINT_MISMATCH');
    expect(verifyCommercialFinalizationReceipt(receipt, input, secret, new Date(now.getTime() + 1001))).toContain('GENERATION_EVIDENCE_RECEIPT_EXPIRED');
  });
});
