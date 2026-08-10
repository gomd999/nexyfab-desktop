import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { evaluateJointEvidenceRelease, type JointEvidenceClaim } from './jointEvidenceReleaseGate';
import { hashNativeCadReviewTarget, nativeCadSignoffPayload, type NativeCadExpertSignoff } from './nativeCadExpertReview';

const hash = 'a'.repeat(64);
const keys = ['domain', 'independent'].map(reviewerId => ({ reviewerId, ...generateKeyPairSync('ed25519') }));
const trusted = Object.fromEntries(keys.map((item, index) => [item.reviewerId, { publicKey: item.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: [index ? 'independent-reviewer' as const : 'domain-reviewer' as const] }]));
const native = (): JointEvidenceClaim => ({ provenance: 'native-cad', sourceHash: hash, artifactHashes: ['b'.repeat(64)], jointDefinitionHash: 'c'.repeat(64), verificationInputHash: 'd'.repeat(64), revision: 1, jointCount: 2, semanticsComplete: true });
const reviewed = (): JointEvidenceClaim => {
  const claim = native(), target = { sourceHash: claim.sourceHash, artifactHashes: claim.artifactHashes, jointDefinitionHash: claim.jointDefinitionHash, verificationInputHash: claim.verificationInputHash, revision: claim.revision }, targetHash = hashNativeCadReviewTarget(target);
  const signoff = (index: number, role: NativeCadExpertSignoff['role']): NativeCadExpertSignoff => {
    const unsigned = { role, reviewerId: keys[index]!.reviewerId, decision: 'approved' as const, reviewedAt: '2026-08-01T00:00:00.000Z', targetHash };
    return { ...unsigned, signature: sign(null, Buffer.from(nativeCadSignoffPayload(unsigned)), keys[index]!.privateKey).toString('base64') };
  };
  return { ...claim, expertReview: { schema: 'nexyfab.native-cad-expert-review.v1', target, signoffs: [signoff(0, 'domain-reviewer'), signoff(1, 'independent-reviewer')] } };
};

describe('joint evidence release gate', () => {
  it('allows only hash-bound, signed, independent native review', () => expect(evaluateJointEvidenceRelease(reviewed(), trusted)).toMatchObject({ status: 'pass', nativeKpiEligible: true, manufacturingReleaseEligible: true, usage: 'native-verified' }));
  it('does not accept a client boolean or missing signed review', () => expect(evaluateJointEvidenceRelease({ ...native(), reviewerApproved: true } as JointEvidenceClaim, trusted)).toMatchObject({ status: 'fail', nativeKpiEligible: false, errors: ['expert_review_missing_or_invalid'] }));
  it('invalidates approval after an edit changes the joint definition hash', () => expect(evaluateJointEvidenceRelease({ ...reviewed(), jointDefinitionHash: 'e'.repeat(64) }, trusted)).toMatchObject({ status: 'fail', nativeKpiEligible: false, errors: expect.arrayContaining(['expert_review_target_mismatch']) }));
  it('rejects replay against a different verification input', () => expect(evaluateJointEvidenceRelease(reviewed(), trusted, 'e'.repeat(64)).errors).toContain('verification_input_hash_mismatch'));
  it('rejects duplicate reviewer identities', () => { const claim = reviewed(); claim.expertReview!.signoffs[1] = { ...claim.expertReview!.signoffs[0]!, role: 'independent-reviewer' }; expect(evaluateJointEvidenceRelease(claim, trusted).errors).toContain('expert_reviewers_not_independent'); });
  it('rejects a valid key used for an unauthorized reviewer role', () => { const claim = reviewed(); const unauthorized = { ...trusted, domain: { ...trusted.domain!, roles: ['independent-reviewer' as const] } }; expect(evaluateJointEvidenceRelease(claim, unauthorized).errors).toContain('expert_review_role_unauthorized:domain-reviewer'); });
  it('rejects two reviewer IDs backed by the same public key', () => { const duplicateKey = { ...trusted, independent: { ...trusted.independent!, publicKey: trusted.domain!.publicKey } }; expect(evaluateJointEvidenceRelease(reviewed(), duplicateKey).errors).toContain('expert_reviewer_keys_not_independent'); });
  it('fails closed on malformed untrusted review JSON', () => expect(() => evaluateJointEvidenceRelease({ ...native(), expertReview: { schema: 'nexyfab.native-cad-expert-review.v1' } } as JointEvidenceClaim, trusted)).not.toThrow());
  it('fails closed without throwing when artifact hashes are omitted', () => { const claim = { ...native(), artifactHashes: undefined } as unknown as JointEvidenceClaim; expect(() => evaluateJointEvidenceRelease(claim, trusted)).not.toThrow(); expect(evaluateJointEvidenceRelease(claim, trusted).errors).toContain('joint_evidence_hash_invalid'); });
  it('never promotes geometry inference to native KPI', () => expect(evaluateJointEvidenceRelease({ ...native(), provenance: 'geometry-inferred', semanticsComplete: false }, trusted)).toMatchObject({ status: 'not_run', nativeKpiEligible: false, manufacturingReleaseEligible: false, usage: 'visualization-only' }));
  it('keeps user-confirmed joints outside manufacturing release', () => expect(evaluateJointEvidenceRelease({ ...native(), provenance: 'user-confirmed', semanticsComplete: false }, trusted)).toMatchObject({ status: 'not_run', nativeKpiEligible: false, usage: 'editable-unverified' }));
  it('keeps incomplete native extraction pending rather than claiming review', () => expect(evaluateJointEvidenceRelease({ ...native(), semanticsComplete: false }, trusted)).toMatchObject({ status: 'not_run', nativeKpiEligible: false, manufacturingReleaseEligible: false, errors: [] }));
  it('rejects a false complete declaration from inference', () => expect(evaluateJointEvidenceRelease({ ...native(), provenance: 'geometry-inferred' }, trusted)).toMatchObject({ status: 'fail', errors: ['non_native_semantics_complete_forbidden'] }));
});
