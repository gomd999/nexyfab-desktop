import { createHash } from 'node:crypto';
import { applyAssertionReviews, type ComplexAssertionReviewRecord } from './complexAssertionReview';
import type { ComplexBenchmarkCaseV2 } from './complexProductBenchmarkV2';

export interface GroundTruthDecision {
  decision: 'approved' | 'rejected' | 'changes_requested'; reviewerId: string; note: string; reviewedAt: string;
}
export interface GroundTruthSignoff extends GroundTruthDecision {
  role: 'domain-reviewer' | 'independent-reviewer'; artifactSetHash: string; reviewedAssertionIds: string[];
}
export interface ComplexGroundTruthApprovalRecord {
  schema: 'nexyfab.complex-ground-truth-approval.v1'; caseId: string; sourceHash: string; revision: number;
  licenseReview: GroundTruthDecision; holdoutIsolationReview: GroundTruthDecision;
  assertionReviews: ComplexAssertionReviewRecord[]; signoffs: GroundTruthSignoff[];
}
export interface ComplexGroundTruthApprovalVerdict { status: 'approved' | 'rejected' | 'changes_requested' | 'pending' | 'invalid'; scoreEligible: boolean; issues: string[]; approvedAssertionIds: string[]; artifactSetHash: string; }
const SHA256 = /^[a-f0-9]{64}$/;
const exactSet = (actual: readonly string[], expected: readonly string[]) => [...actual].sort().join('|') === [...expected].sort().join('|');
const validDecision = (item: GroundTruthDecision) => item.reviewerId.trim() && item.note.trim() && !Number.isNaN(Date.parse(item.reviewedAt));

export function groundTruthArtifactSetHash(caseValue: ComplexBenchmarkCaseV2): string {
  const rows = caseValue.assertions.map(item => `${item.id}\0${item.tolerancePolicy}\0${[...item.artifactHashes].sort().join(',')}`).sort();
  return createHash('sha256').update(`${caseValue.caseId}\0${caseValue.sourceHash}\0${rows.join('\n')}`).digest('hex');
}

export function validateComplexGroundTruthApproval(caseValue: ComplexBenchmarkCaseV2, record?: ComplexGroundTruthApprovalRecord): ComplexGroundTruthApprovalVerdict {
  const artifactSetHash = groundTruthArtifactSetHash(caseValue);
  if (!record) return { status: 'pending', scoreEligible: false, issues: ['ground_truth_approval_missing'], approvedAssertionIds: [], artifactSetHash };
  const issues: string[] = [];
  if (record.caseId !== caseValue.caseId || record.sourceHash !== caseValue.sourceHash || !SHA256.test(record.sourceHash)) issues.push('ground_truth_target_mismatch');
  if (!Number.isInteger(record.revision) || record.revision < 1) issues.push('ground_truth_revision_invalid');
  if (!validDecision(record.licenseReview)) issues.push('license_review_metadata_invalid');
  if (!validDecision(record.holdoutIsolationReview)) issues.push('holdout_review_metadata_invalid');
  const applied = applyAssertionReviews(caseValue, record.assertionReviews); issues.push(...applied.issues);
  const requiredIds = caseValue.assertions.filter(item => item.required).map(item => item.id);
  if (!exactSet(applied.approvedAssertionIds.filter(id => requiredIds.includes(id)), requiredIds)) issues.push('required_assertions_not_approved');
  const roles = new Map(record.signoffs.map(item => [item.role, item]));
  if (roles.size !== record.signoffs.length) issues.push('ground_truth_signoff_role_duplicate');
  const domain = roles.get('domain-reviewer'), independent = roles.get('independent-reviewer');
  if (!domain || !independent) issues.push('ground_truth_dual_signoff_missing');
  for (const signoff of record.signoffs) {
    if (!validDecision(signoff) || signoff.artifactSetHash !== artifactSetHash || !exactSet(signoff.reviewedAssertionIds, requiredIds)) issues.push(`ground_truth_signoff_invalid:${signoff.role}`);
  }
  if (domain && independent && domain.reviewerId === independent.reviewerId) issues.push('ground_truth_reviewers_not_independent');
  if (independent && record.assertionReviews.some(item => item.reviewerId === independent.reviewerId)) issues.push('independent_reviewer_authored_assertion_review');
  if (issues.length) return { status: 'invalid', scoreEligible: false, issues: [...new Set(issues)], approvedAssertionIds: applied.approvedAssertionIds, artifactSetHash };
  const decisions = [record.licenseReview, record.holdoutIsolationReview, ...record.assertionReviews, ...record.signoffs].map(item => item.decision);
  const status = decisions.includes('rejected') ? 'rejected' : decisions.includes('changes_requested') ? 'changes_requested' : decisions.every(item => item === 'approved') ? 'approved' : 'pending';
  return { status, scoreEligible: status === 'approved', issues: [], approvedAssertionIds: applied.approvedAssertionIds, artifactSetHash };
}
