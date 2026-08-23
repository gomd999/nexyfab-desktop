import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { nativeCadSignoffPayload, type NativeCadExpertSignoff, type TrustedReviewerKeys } from '@/lib/reference/nativeCadExpertReview';
import { auditRobotVerifiedSystemsRelease } from './robotVerifiedSystemsReleaseAudit';
import { buildRobotVerifiedSystemsReleaseAuditFixture } from './robotVerifiedSystemsReleaseAudit.testFixture';
import { verifyRobotFinalReleaseReview } from './robotFinalReleaseReview';

const enc = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);
const auditFixture = buildRobotVerifiedSystemsReleaseAuditFixture();
const audit = auditRobotVerifiedSystemsRelease(auditFixture.files, auditFixture.artifacts, auditFixture.trusted, auditFixture.auditSigner);
const targetHash = audit.releaseTargetHash!;
const a = generateKeyPairSync('ed25519'), b = generateKeyPairSync('ed25519');
const trusted: TrustedReviewerKeys = {
  alice: { publicKey: a.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['domain-reviewer'] },
  bob: { publicKey: b.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['independent-reviewer'] },
};
function signed(role: NativeCadExpertSignoff['role'], id: string, key: typeof a.privateKey, target = targetHash) {
  const unsigned = { role, reviewerId: id, decision: 'approved' as const, reviewedAt: '2026-08-12T03:00:00.000Z', targetHash: target };
  return { ...unsigned, signature: sign(null, Buffer.from(nativeCadSignoffPayload(unsigned)), key).toString('base64') };
}
const review = () => ({ schema: 'nexyfab.robot-final-release-review.v1' as const, targetHash, signoffs: [signed('domain-reviewer', 'alice', a.privateKey), signed('independent-reviewer', 'bob', b.privateKey)] });
const now = Date.parse('2026-08-12T03:01:00Z');

describe('robot final release review', () => {
  it('marks a server-attested, fully evidenced dual approval release-ready without executing release', () => {
    expect(verifyRobotFinalReleaseReview(enc(audit), review(), trusted, auditFixture.trustedAuditIssuers, now)).toMatchObject({ approved: true, releaseReady: true, releaseExecuted: false, errors: [], blockers: [], sideEffects: { persisted: false, cadModified: false, releasePublished: false, quoteCreated: false, rfqSent: false } });
  });

  it('rejects another target, one reviewer, non-ready evidence, and downgraded audits', () => {
    const wrong = review();
    wrong.signoffs[0] = signed('domain-reviewer', 'alice', a.privateKey, 'b'.repeat(64));
    expect(verifyRobotFinalReleaseReview(enc(audit), wrong, trusted, auditFixture.trustedAuditIssuers, now).approved).toBe(false);
    const one = review(); one.signoffs.pop();
    expect(verifyRobotFinalReleaseReview(enc(audit), one, trusted, auditFixture.trustedAuditIssuers, now).releaseReady).toBe(false);
    expect(verifyRobotFinalReleaseReview(enc({ ...audit, status: 'not_ready', releaseTargetHash: null }), review(), trusted, auditFixture.trustedAuditIssuers, now).approved).toBe(false);
    expect(verifyRobotFinalReleaseReview(enc({ ...audit, schema: 'nexyfab.robot-verified-systems-release-audit.v1' }), review(), trusted, auditFixture.trustedAuditIssuers, now).approved).toBe(false);
  });

  it('rejects a forged, tampered or untrusted audit receipt before human signoff', () => {
    expect(verifyRobotFinalReleaseReview(enc({ ...audit, physicalValidationValid: false }), review(), trusted, auditFixture.trustedAuditIssuers, now).errors).toContain('verified_audit_signature_invalid');
    expect(verifyRobotFinalReleaseReview(enc(audit), review(), trusted, {}, now).errors).toContain('verified_audit_issuer_untrusted');
  });
});
