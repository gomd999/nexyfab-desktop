import { describe, expect, it } from 'vitest';
import {
  createAiDesignPrecisionVerificationRequest,
  issueAiDesignPrecisionVerificationReceipt,
  verifyAiDesignPrecisionVerificationReceipt,
} from './aiDesignPrecisionVerification';

const secret = 'precision-receipt-signing-secret-at-least-32-bytes';
const exactDigest = 'e'.repeat(64);

describe('AI Design Precision verification receipt', () => {
  it('accepts a fully bound signed exact receipt without granting manufacturing authority', () => {
    const request = createAiDesignPrecisionVerificationRequest({
      requestId: 'request-1', projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 4, complexRevision: 7,
      productStructureDigest: 'a'.repeat(64), crossDomainContentHash: 'b'.repeat(64),
      scopes: [{ kind: 'structure_node', id: 'part-a' }], requestedAt: '2026-08-24T00:00:00.000Z', expiresAt: '2026-08-24T02:00:00.000Z',
    });
    const receipt = issueAiDesignPrecisionVerificationReceipt({
      receiptId: 'receipt-1', request, status: 'PASS', keyId: 'precision-key-1',
      issuedAt: '2026-08-24T00:10:00.000Z', expiresAt: '2026-08-24T01:00:00.000Z',
      scopeResults: [{ kind: 'structure_node', id: 'part-a', status: 'PASS', exactArtifactDigest: exactDigest, codes: ['exact-brep-pass'] }],
    }, secret);
    expect(verifyAiDesignPrecisionVerificationReceipt(receipt, request, { signingSecret: secret, now: new Date('2026-08-24T00:20:00.000Z'), expectedRuntimeRevision: 4, expectedComplexRevision: 7 })).toEqual({ ok: true, status: 'PASS', issues: [], receiptDigest: receipt.receiptDigest });
    expect(receipt.manufacturingReleaseReady).toBe(false);
  });

  it('rejects tampering, stale revisions, and incomplete PASS scope results', () => {
    const request = createAiDesignPrecisionVerificationRequest({
      requestId: 'request-2', projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 1, complexRevision: 2,
      productStructureDigest: 'a'.repeat(64), crossDomainContentHash: null,
      scopes: [{ kind: 'interface', id: 'interface-a-b' }], requestedAt: '2026-08-24T00:00:00.000Z', expiresAt: '2026-08-24T02:00:00.000Z',
    });
    const receipt = issueAiDesignPrecisionVerificationReceipt({
      receiptId: 'receipt-2', request, status: 'PASS', keyId: 'precision-key-1',
      issuedAt: '2026-08-24T00:10:00.000Z', expiresAt: '2026-08-24T01:00:00.000Z',
      scopeResults: [{ kind: 'interface', id: 'interface-a-b', status: 'PASS', exactArtifactDigest: exactDigest, codes: [] }],
    }, secret);
    expect(verifyAiDesignPrecisionVerificationReceipt({ ...receipt, status: 'FAIL' }, request, { signingSecret: secret, now: new Date('2026-08-24T00:20:00.000Z'), expectedRuntimeRevision: 1, expectedComplexRevision: 2 }).issues).toContain('precision_receipt_signature_invalid');
    expect(verifyAiDesignPrecisionVerificationReceipt(receipt, request, { signingSecret: secret, now: new Date('2026-08-24T00:20:00.000Z'), expectedRuntimeRevision: 2, expectedComplexRevision: 2 }).status).toBe('STALE');
    const incomplete = { ...receipt, receiptId: 'receipt-3', scopeResults: [
      { kind: 'interface' as const, id: 'interface-a-b', status: 'PASS' as const, exactArtifactDigest: null, codes: [] },
    ] };
    expect(verifyAiDesignPrecisionVerificationReceipt(incomplete, request, { signingSecret: secret, now: new Date('2026-08-24T00:20:00.000Z'), expectedRuntimeRevision: 1, expectedComplexRevision: 2 }).issues).toContain('precision_receipt_pass_incomplete');
  });

  it('refuses to issue receipts outside the request validity window', () => {
    const request = createAiDesignPrecisionVerificationRequest({
      requestId: 'request-time', projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 1, complexRevision: 2,
      productStructureDigest: 'a'.repeat(64), crossDomainContentHash: null,
      scopes: [{ kind: 'structure_node', id: 'part-a' }], requestedAt: '2026-08-24T01:00:00.000Z', expiresAt: '2026-08-24T02:00:00.000Z',
    });
    const base = {
      receiptId: 'receipt-time', request, status: 'PASS' as const, keyId: 'precision-key-1',
      scopeResults: [{ kind: 'structure_node' as const, id: 'part-a', status: 'PASS' as const, exactArtifactDigest: exactDigest, codes: [] }],
    };
    expect(() => issueAiDesignPrecisionVerificationReceipt({
      ...base, issuedAt: '2026-08-24T00:59:00.000Z', expiresAt: '2026-08-24T01:30:00.000Z',
    }, secret)).toThrow('AI_DESIGN_PRECISION_RECEIPT_INVALID');
    expect(() => issueAiDesignPrecisionVerificationReceipt({
      ...base, issuedAt: '2026-08-24T01:30:00.000Z', expiresAt: '2026-08-24T02:01:00.000Z',
    }, secret)).toThrow('AI_DESIGN_PRECISION_RECEIPT_INVALID');
  });
});
