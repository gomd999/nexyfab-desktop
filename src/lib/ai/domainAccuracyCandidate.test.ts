import { describe, expect, it } from 'vitest';
import { domainCandidateGroundTruthHash, promoteDomainAccuracyCandidate, type DomainAccuracyApproval, type DomainAccuracyCandidate } from './domainAccuracyCandidate';

const candidate: DomainAccuracyCandidate = {
  schema: 'nexyfab.domain-accuracy-candidate.v1', caseId: 'civil-wall-1', domain: 'civil',
  sourceHash: 'a'.repeat(64), sourceKind: 'expert-authored', templateId: 'retaining_wall_run', split: 'candidate',
  sourceRights: { basis: 'work-for-hire', reference: 'contract-2026-001', benchmarkingAllowed: true },
  artifactHash: 'b'.repeat(64),
  groundTruthAssertions: [{ axis: 'dimensions', tolerancePolicy: 'linear-0.1mm', provenance: 'expert-measurement', artifactHashes: ['c'.repeat(64)] }],
  artifactSummary: { name: 'wall', partCount: 2, pipeCount: 0, roles: ['wall'], alignmentErrors: [], unverifiedPartCount: 0 },
};
const approval = (reviewerId: string): DomainAccuracyApproval => ({
  schema: 'nexyfab.domain-accuracy-approval.v1', caseId: candidate.caseId, sourceHash: candidate.sourceHash,
  artifactHash: candidate.artifactHash, groundTruthHash: domainCandidateGroundTruthHash(candidate),
  reviewerId, reviewedAt: '2026-08-07T00:00:00.000Z', decision: 'approve', independent: true,
});

describe('domain accuracy candidate promotion', () => {
  it('keeps an unreviewed internal template candidate out of scoring', () => {
    const internal = { ...candidate, sourceKind: 'internal-template' as const };
    expect(promoteDomainAccuracyCandidate(internal, [])).toMatchObject({ status: 'pending', scoreEligible: false, issues: ['dual_approval_missing:0/2'] });
    const promoted = promoteDomainAccuracyCandidate(internal, [approval('a'), approval('b')]);
    expect(promoted).toMatchObject({ status: 'approved', scoreEligible: false, issues: ['internal_template_not_independent_holdout'] });
    expect(promoted).not.toHaveProperty('benchmarkCase');
  });
  it('requires two distinct reviewers bound to the exact source hash', () => {
    expect(promoteDomainAccuracyCandidate(candidate, [approval('a'), approval('b')])).toMatchObject({
      status: 'approved', scoreEligible: true,
      benchmarkCase: { split: 'holdout', approvalReviewerIds: ['a', 'b'] },
    });
    const stale = approval('b'); stale.sourceHash = 'b'.repeat(64);
    expect(promoteDomainAccuracyCandidate(candidate, [approval('a'), stale])).toMatchObject({ status: 'invalid', scoreEligible: false });
  });
  it('invalidates approvals when the artifact, tolerance or evidence set changes', () => {
    const signed = [approval('a'), approval('b')];
    const changedArtifact = { ...candidate, artifactHash: 'd'.repeat(64) };
    expect(promoteDomainAccuracyCandidate(changedArtifact, signed)).toMatchObject({ status: 'invalid', scoreEligible: false });
    const changedTruth = { ...candidate, groundTruthAssertions: [{ ...candidate.groundTruthAssertions![0]!, tolerancePolicy: 'linear-1mm' }] };
    expect(promoteDomainAccuracyCandidate(changedTruth, signed)).toMatchObject({
      status: 'invalid', scoreEligible: false,
      issues: expect.arrayContaining(['approval_ground_truth_hash_mismatch:a', 'approval_ground_truth_hash_mismatch:b']),
    });
  });
  it('does not count duplicate reviewer identities as independent approval', () => {
    expect(promoteDomainAccuracyCandidate(candidate, [approval('same'), approval('same')])).toMatchObject({ status: 'pending', scoreEligible: false, issues: expect.arrayContaining(['dual_approval_missing:1/2']) });
  });
  it('honors an explicit rejection', () => {
    const rejected = approval('reviewer-b'); rejected.decision = 'reject';
    expect(promoteDomainAccuracyCandidate(candidate, [approval('reviewer-a'), rejected])).toMatchObject({ status: 'rejected', scoreEligible: false });
  });
  it('cannot promote geometry with alignment errors or unverified parts', () => {
    const dirty = { ...candidate, artifactSummary: { ...candidate.artifactSummary, alignmentErrors: ['overlap'], unverifiedPartCount: 1 } };
    expect(promoteDomainAccuracyCandidate(dirty, [approval('a'), approval('b')])).toMatchObject({
      status: 'invalid', scoreEligible: false,
      issues: expect.arrayContaining(['candidate_alignment_errors', 'candidate_unverified_parts']),
    });
  });
  it('cannot score external evidence without explicit benchmark rights', () => {
    const unlicensed = { ...candidate, sourceRights: undefined };
    expect(promoteDomainAccuracyCandidate(unlicensed, [approval('a'), approval('b')])).toMatchObject({
      status: 'invalid', scoreEligible: false, issues: expect.arrayContaining(['candidate_benchmark_rights_missing']),
    });
  });
});
