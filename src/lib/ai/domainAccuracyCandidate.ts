import { createHash } from 'node:crypto';
import type { DomainAccuracyCase } from './domainAccuracyEvidence';
import type { DomainAccuracyDomain } from './domainAccuracyProgram';

export interface DomainAccuracyCandidate {
  schema: 'nexyfab.domain-accuracy-candidate.v1';
  caseId: string;
  domain: DomainAccuracyDomain;
  sourceHash: string;
  sourceKind: 'internal-template' | 'licensed-customer' | 'public-standard' | 'expert-authored';
  sourceRights?: {
    basis: 'customer-consent' | 'public-license' | 'work-for-hire';
    reference: string;
    benchmarkingAllowed: boolean;
  };
  templateId?: string;
  parameters?: Record<string, number | string | boolean>;
  artifactHash: string;
  artifactSummary: {
    name: string;
    partCount: number;
    pipeCount: number;
    roles: string[];
    alignmentErrors: string[];
    unverifiedPartCount: number;
  };
  groundTruthAssertions?: DomainAccuracyCase['groundTruthAssertions'];
  split: 'candidate';
}

export interface DomainAccuracyApproval {
  schema: 'nexyfab.domain-accuracy-approval.v1';
  caseId: string;
  sourceHash: string;
  artifactHash: string;
  groundTruthHash: string;
  reviewerId: string;
  reviewedAt: string;
  decision: 'approve' | 'reject';
  independent: boolean;
}

const SHA256 = /^[a-f0-9]{64}$/;

/** Canonical digest reviewers sign: source, generated artifact and every axis/tolerance/evidence hash. */
export function domainCandidateGroundTruthHash(candidate: DomainAccuracyCandidate): string {
  const assertions = [...(candidate.groundTruthAssertions ?? [])]
    .map(item => ({
      axis: item.axis,
      tolerancePolicy: item.tolerancePolicy,
      provenance: item.provenance,
      artifactHashes: [...item.artifactHashes].sort(),
    }))
    .sort((a, b) => a.axis.localeCompare(b.axis));
  return createHash('sha256').update(JSON.stringify({
    caseId: candidate.caseId,
    sourceHash: candidate.sourceHash,
    artifactHash: candidate.artifactHash,
    assertions,
  })).digest('hex');
}

export interface DomainCandidatePromotion {
  status: 'approved' | 'pending' | 'rejected' | 'invalid';
  scoreEligible: boolean;
  issues: string[];
  benchmarkCase?: DomainAccuracyCase;
}

/** Hash-bound, dual-independent promotion. Internal template origin is disclosed, never hidden. */
export function promoteDomainAccuracyCandidate(
  candidate: DomainAccuracyCandidate,
  approvals: readonly DomainAccuracyApproval[],
): DomainCandidatePromotion {
  const issues: string[] = [];
  if (!candidate.caseId.trim()) issues.push('candidate_case_id_missing');
  if (!SHA256.test(candidate.sourceHash)) issues.push('candidate_source_hash_invalid');
  if (!SHA256.test(candidate.artifactHash)) issues.push('candidate_artifact_hash_invalid');
  if (candidate.artifactSummary.alignmentErrors.length) issues.push('candidate_alignment_errors');
  if (candidate.artifactSummary.unverifiedPartCount > 0) issues.push('candidate_unverified_parts');
  if (candidate.sourceKind !== 'internal-template' && (
    !candidate.sourceRights?.benchmarkingAllowed || !candidate.sourceRights.reference.trim()
  )) issues.push('candidate_benchmark_rights_missing');
  if (candidate.sourceKind !== 'internal-template' && !candidate.groundTruthAssertions?.length) issues.push('candidate_ground_truth_missing');
  const groundTruthHash = domainCandidateGroundTruthHash(candidate);
  const relevant = approvals.filter(item => item.caseId === candidate.caseId);
  for (const item of relevant) {
    if (item.sourceHash !== candidate.sourceHash) issues.push(`approval_hash_mismatch:${item.reviewerId}`);
    if (item.artifactHash !== candidate.artifactHash) issues.push(`approval_artifact_hash_mismatch:${item.reviewerId}`);
    if (item.groundTruthHash !== groundTruthHash) issues.push(`approval_ground_truth_hash_mismatch:${item.reviewerId}`);
    if (!item.reviewerId.trim()) issues.push('approval_reviewer_missing');
    if (!item.independent) issues.push(`approval_not_independent:${item.reviewerId}`);
    if (!Number.isFinite(Date.parse(item.reviewedAt))) issues.push(`approval_date_invalid:${item.reviewerId}`);
  }
  if (relevant.some(item => item.decision === 'reject')) {
    return { status: 'rejected', scoreEligible: false, issues };
  }
  const validApprovers = new Set(relevant.filter(item =>
    item.decision === 'approve' && item.independent && item.sourceHash === candidate.sourceHash
    && item.artifactHash === candidate.artifactHash && item.groundTruthHash === groundTruthHash
    && item.reviewerId.trim() && Number.isFinite(Date.parse(item.reviewedAt)),
  ).map(item => item.reviewerId));
  if (validApprovers.size < 2) {
    return { status: issues.length ? 'invalid' : 'pending', scoreEligible: false, issues: [...issues, `dual_approval_missing:${validApprovers.size}/2`] };
  }
  if (issues.length) return { status: 'invalid', scoreEligible: false, issues };
  if (candidate.sourceKind === 'internal-template') {
    return {
      status: 'approved',
      scoreEligible: false,
      issues: ['internal_template_not_independent_holdout'],
    };
  }
  return {
    status: 'approved',
    scoreEligible: true,
    issues: [],
    benchmarkCase: {
      caseId: candidate.caseId,
      domain: candidate.domain,
      sourceHash: candidate.sourceHash,
      split: 'holdout',
      approvalReviewerIds: [...validApprovers].sort(),
      groundTruthAssertions: candidate.groundTruthAssertions!,
    },
  };
}
