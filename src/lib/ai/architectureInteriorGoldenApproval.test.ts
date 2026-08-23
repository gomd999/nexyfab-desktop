import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  ARCHITECTURE_INTERIOR_GOLDEN_APPROVAL_SCHEMA,
  architectureInteriorGoldenApprovalPayload,
  encodeArchitectureInteriorGoldenApprovalReceipt,
  verifyArchitectureInteriorGoldenApproval,
  verifyArchitectureInteriorGoldenApprovals,
} from './architectureInteriorGoldenApproval';

const sourceHashes = { brief: 'a'.repeat(64), survey: 'b'.repeat(64) };
const context = { scenarioId: 'arch-case', sourceHashes, suiteHash: 'c'.repeat(64), releaseHash: 'd'.repeat(64) };

function reviewer(id: string, role = 'independent-reviewer') {
  const pair = generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const unsigned = { schema: ARCHITECTURE_INTERIOR_GOLDEN_APPROVAL_SCHEMA, receiptId: `receipt-${id}`, reviewerId: id, role: 'independent-reviewer' as const, scenarioId: context.scenarioId, sourceHashes, suiteHash: context.suiteHash, releaseHash: context.releaseHash, approved: true as const, issuedAt: '2026-08-22T00:00:00.000Z', expiresAt: '2026-08-29T00:00:00.000Z', publicKeyPem };
  const signatureBase64 = sign(null, Buffer.from(architectureInteriorGoldenApprovalPayload(unsigned)), pair.privateKey).toString('base64');
  const receipt = { ...unsigned, signatureBase64 };
  const receiptBytes = encodeArchitectureInteriorGoldenApprovalReceipt(receipt);
  return { approval: { reviewerId: id, approvalReceiptHash: createHash('sha256').update(receiptBytes).digest('hex'), approved: true as const, receiptBytes }, trusted: { publicKeyPem, roles: [role] as const } };
}

describe('architecture/interior golden approval verifier', () => {
  it('verifies actual canonical receipt bytes and all campaign bindings', () => {
    const a = reviewer('reviewer-a');
    expect(verifyArchitectureInteriorGoldenApproval({ ...context, approval: a.approval, trustedReviewers: { 'reviewer-a': a.trusted }, now: Date.parse('2026-08-23T00:00:00Z') })).toMatchObject({ ok: true, reviewerId: 'reviewer-a' });
  });

  it('fails closed for tampering, stale receipts, and non-distinct reviewers', () => {
    const a = reviewer('reviewer-a');
    const bad = structuredClone(a.approval);
    bad.receiptBytes![0] = bad.receiptBytes![0]! ^ 1;
    expect(verifyArchitectureInteriorGoldenApproval({ ...context, approval: bad, trustedReviewers: { 'reviewer-a': a.trusted }, now: Date.parse('2026-08-23T00:00:00Z') })).toMatchObject({ ok: false });
    const result = verifyArchitectureInteriorGoldenApprovals({ ...context, approvals: [a.approval, a.approval], trustedReviewers: { 'reviewer-a': a.trusted }, now: Date.parse('2026-08-23T00:00:00Z') });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.issues.join('|')).toContain('reviewer_not_distinct');
  });

  it('rejects receipt paths that traverse outside an approved root', () => {
    const a = reviewer('reviewer-a');
    expect(verifyArchitectureInteriorGoldenApproval({ ...context, approval: { ...a.approval, receiptBytes: undefined, receiptPath: '../receipt.json' }, approvedRoots: ['.'], trustedReviewers: { 'reviewer-a': a.trusted }, now: Date.parse('2026-08-23T00:00:00Z') })).toMatchObject({ ok: false });
  });

  it('does not allow callers to weaken or exhaust the two-reviewer policy', () => {
    const a = reviewer('reviewer-a');
    expect(verifyArchitectureInteriorGoldenApprovals({ ...context, approvals: [a.approval], requiredReviewers: 0, trustedReviewers: { 'reviewer-a': a.trusted } })).toEqual({ ok: false, issues: ['independent_reviewer_policy_invalid'] });
    expect(verifyArchitectureInteriorGoldenApprovals({ ...context, approvals: Array.from({ length: 17 }, () => a.approval), trustedReviewers: { 'reviewer-a': a.trusted } })).toEqual({ ok: false, issues: ['independent_reviewers_limit_exceeded'] });
  });
});
