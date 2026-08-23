import { describe, expect, it } from 'vitest';
import {
  buildReviewerWorkPacket,
  reviewerAttestationPayloadSha256,
  type TrustedVerificationRecord,
  type ReviewerAttestation,
  validateReviewerWorkPacket,
} from './reviewerWorkPacket';

const HASH = (char: string) => char.repeat(64);
const NOW = Date.parse('2026-08-23T00:00:00.000Z');

function packet() {
  return buildReviewerWorkPacket({
    packetId: 'packet-architecture-001',
    caseId: 'architecture-holdout-001',
    domain: 'architecture',
    sourceInputSha256: HASH('a'),
    holdoutSet: {
      id: 'holdout-architecture-v1',
      sha256: HASH('b'),
      sourceKind: 'external-holdout',
      independentFromTrainingAndReference: true,
    },
    revision: { id: 'revision-7', sha256: HASH('c') },
    artifactSha256: [HASH('d'), HASH('e')],
    evidenceRootSha256: HASH('f'),
    issuedAt: '2026-08-22T00:00:00.000Z',
  });
}

function attestation(
  base: ReturnType<typeof packet>,
  reviewerId: string,
  role: ReviewerAttestation['role'],
): ReviewerAttestation {
  const value: ReviewerAttestation = {
    schema: 'nexyfab.reviewer-attestation.v1',
    reviewerId,
    role,
    independentFromBuild: true,
    verdict: 'PASS',
    reviewedAt: '2026-08-22T01:00:00.000Z',
    targetPacketSha256: base.targetSha256,
    revisionSha256: base.target.revision.sha256,
    attestationRef: `external://review/${reviewerId}`,
    signatureRef: `sha256:${HASH(reviewerId === 'domain-1' ? '1' : '2')}`,
    signedPayloadSha256: HASH('0'),
  };
  value.signedPayloadSha256 = reviewerAttestationPayloadSha256(value);
  return value;
}

describe('reviewer work packet contract', () => {
  it('creates a hash-bound pending packet without inventing reviewers or approval', () => {
    const value = packet();
    const result = validateReviewerWorkPacket(value, { currentRevisionSha256: HASH('c'), now: NOW });
    expect(value.attestations).toEqual([]);
    expect(result).toMatchObject({ valid: true, releaseReady: false, verdict: 'PENDING', issues: [] });
  });

  it('accepts only two independently linked, signature-verified role attestations for release', () => {
    const value = packet();
    value.attestations.push(attestation(value, 'domain-1', 'domain-expert'));
    value.attestations.push(attestation(value, 'independent-1', 'independent-validator'));
    const trustedVerificationRecords: TrustedVerificationRecord[] = value.attestations.map((item, index) => ({
      reviewerId: item.reviewerId,
      signatureRef: item.signatureRef!,
      targetPacketSha256: value.targetSha256,
      revisionSha256: value.target.revision.sha256,
      verificationReceiptSha256: HASH(index === 0 ? '7' : '8'),
      verifierId: `signature-verifier-${index + 1}`,
    }));
    expect(validateReviewerWorkPacket(value, { currentRevisionSha256: value.target.revision.sha256, trustedVerificationRecords, now: NOW })).toMatchObject({ valid: true, releaseReady: true, verdict: 'PASS', issues: [] });
    expect(validateReviewerWorkPacket(value, { trustedVerificationRecords, now: NOW })).toMatchObject({ valid: true, releaseReady: false, verdict: 'PASS', issues: [] });
  });

  it('does not trust a self-asserted signature boolean or missing external verification record', () => {
    const value = packet();
    value.attestations.push(attestation(value, 'domain-1', 'domain-expert'));
    value.attestations.push(attestation(value, 'independent-1', 'independent-validator'));
    expect(validateReviewerWorkPacket(value, { now: NOW })).toMatchObject({ valid: true, releaseReady: false, verdict: 'PENDING', issues: [] });
  });

  it('detects target tampering and rejects a stale revision', () => {
    const value = packet();
    value.target.artifactSha256[0] = HASH('9');
    expect(validateReviewerWorkPacket(value, { currentRevisionSha256: HASH('c'), now: NOW }).issues).toContain('packet_target_tampered');
    const fresh = packet();
    expect(validateReviewerWorkPacket(fresh, { currentRevisionSha256: HASH('8'), now: NOW }).issues).toContain('stale_revision');
  });

  it('keeps missing external signature/attestation pending and rejects tampered linkage', () => {
    const value = packet();
    const review = attestation(value, 'domain-1', 'domain-expert');
    value.attestations.push(review);
    const pending = validateReviewerWorkPacket(value, { now: NOW });
    expect(pending.releaseReady).toBe(false);
    expect(pending.verdict).toBe('PENDING');

    const tampered = packet();
    const linked = attestation(tampered, 'domain-1', 'domain-expert');
    linked.targetPacketSha256 = HASH('9');
    tampered.attestations.push(linked);
    expect(validateReviewerWorkPacket(tampered, { now: NOW }).issues).toContain('attestation_target_mismatch:domain-1');
  });

  it('rejects a verification record whose target or revision was tampered', () => {
    const value = packet();
    const review = attestation(value, 'domain-1', 'domain-expert');
    value.attestations.push(review);
    const record: TrustedVerificationRecord = {
      reviewerId: review.reviewerId,
      signatureRef: review.signatureRef!,
      targetPacketSha256: HASH('9'),
      revisionSha256: HASH('8'),
      verificationReceiptSha256: HASH('7'),
      verifierId: 'external-verifier',
    };
    const result = validateReviewerWorkPacket(value, { trustedVerificationRecords: [record], now: NOW });
    expect(result.releaseReady).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining(['verification_target_mismatch:domain-1', 'verification_revision_mismatch:domain-1']));
  });

  it('returns invalid instead of throwing for malformed runtime input', () => {
    expect(validateReviewerWorkPacket({} as never, { now: NOW })).toMatchObject({ valid: false, releaseReady: false, verdict: 'PENDING', issues: ['packet_runtime_shape_invalid'] });
  });
});
