import type { DirectManipulationProposal } from './directManipulation';

export const PRECISION_CAD_DIRECT_EDIT_RECEIPT_SCHEMA = 'nexyfab.precision-cad-direct-edit-receipt.v1' as const;

export type PrecisionCadDirectEditStatus = 'REJECTED' | 'APPLIED' | 'VERIFIED' | 'ROLLED_BACK';
export type PrecisionCadVerificationStatus = 'NOT_RUN' | 'PASS' | 'FAIL';

export interface PrecisionCadVerificationEvidence {
  status: PrecisionCadVerificationStatus;
  sourceId?: string;
  sourceHash?: string;
}

export interface PrecisionCadDirectEditReceipt {
  schema: typeof PRECISION_CAD_DIRECT_EDIT_RECEIPT_SCHEMA;
  receiptId: string;
  proposalId: string;
  intentId: string;
  projectId: string;
  idempotencyKey: string;
  baseRevision: string;
  proposalDigestSha256: string;
  status: PrecisionCadDirectEditStatus;
  resultRevision: string;
  resultDigestSha256?: string;
  rollback?: {
    snapshotId: string;
    snapshotDigestSha256: string;
    sourceReceiptId?: string;
  };
  verification: {
    geometry: PrecisionCadVerificationEvidence;
    topology: PrecisionCadVerificationEvidence;
    manufacturing: PrecisionCadVerificationEvidence;
  };
  issues: string[];
  issuedAt: string;
}

export interface PrecisionCadReceiptGuardResult {
  accepted: boolean;
  issues: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const nonEmpty = (value: string | undefined): boolean => typeof value === 'string' && value.trim().length > 0;

function evidenceIssues(label: string, evidence: PrecisionCadVerificationEvidence): string[] {
  if (!['NOT_RUN', 'PASS', 'FAIL'].includes(evidence.status)) return [`invalid_${label}_verification_status`];
  if (evidence.status !== 'NOT_RUN'
    && (!nonEmpty(evidence.sourceId) || !evidence.sourceHash || !SHA256.test(evidence.sourceHash))) {
    return [`unbound_${label}_verification_evidence`];
  }
  return [];
}

/**
 * Validates Precision CAD evidence without executing or trusting geometry in
 * AI Design. The caller supplies the SHA-256 of the exact proposal bytes it
 * sent so a receipt cannot be rebound to another proposal.
 */
export function guardPrecisionCadDirectEditReceipt(input: {
  receipt: PrecisionCadDirectEditReceipt;
  proposal: DirectManipulationProposal;
  proposalDigestSha256: string;
}): PrecisionCadReceiptGuardResult {
  const { receipt, proposal, proposalDigestSha256 } = input;
  const issues: string[] = [];
  if (receipt.schema !== PRECISION_CAD_DIRECT_EDIT_RECEIPT_SCHEMA) issues.push('invalid_receipt_schema');
  if (![receipt.receiptId, receipt.proposalId, receipt.intentId, receipt.projectId, receipt.idempotencyKey,
    receipt.baseRevision, receipt.resultRevision].every(nonEmpty)) issues.push('missing_receipt_identity');
  if (!SHA256.test(proposalDigestSha256) || receipt.proposalDigestSha256 !== proposalDigestSha256) {
    issues.push('proposal_digest_mismatch');
  }
  if (receipt.proposalId !== proposal.proposalId || receipt.intentId !== proposal.intentId
    || receipt.projectId !== proposal.projectId || receipt.idempotencyKey !== proposal.idempotencyKey
    || receipt.baseRevision !== proposal.transaction.baseRevision) issues.push('proposal_binding_mismatch');
  if (!Number.isFinite(Date.parse(receipt.issuedAt))) issues.push('invalid_receipt_timestamp');
  if (!['REJECTED', 'APPLIED', 'VERIFIED', 'ROLLED_BACK'].includes(receipt.status)) issues.push('invalid_receipt_status');
  issues.push(...evidenceIssues('geometry', receipt.verification.geometry));
  issues.push(...evidenceIssues('topology', receipt.verification.topology));
  issues.push(...evidenceIssues('manufacturing', receipt.verification.manufacturing));

  const resultBearing = receipt.status === 'APPLIED' || receipt.status === 'VERIFIED' || receipt.status === 'ROLLED_BACK';
  if (resultBearing && (!receipt.resultDigestSha256 || !SHA256.test(receipt.resultDigestSha256))) {
    issues.push('result_digest_required');
  }
  if ((receipt.status === 'APPLIED' || receipt.status === 'VERIFIED') && proposal.state !== 'READY_FOR_CAD') {
    issues.push('proposal_not_ready_for_cad');
  }
  if ((receipt.status === 'APPLIED' || receipt.status === 'VERIFIED') && receipt.resultRevision === receipt.baseRevision) {
    issues.push('result_revision_not_advanced');
  }
  if (receipt.status === 'REJECTED' && receipt.resultRevision !== receipt.baseRevision) {
    issues.push('rejected_receipt_changed_revision');
  }
  if (receipt.status === 'VERIFIED'
    && (receipt.verification.geometry.status !== 'PASS' || receipt.verification.topology.status !== 'PASS')) {
    issues.push('precision_verification_incomplete');
  }
  if (receipt.status !== 'VERIFIED'
    && (receipt.verification.geometry.status === 'PASS' || receipt.verification.topology.status === 'PASS')) {
    issues.push('verification_claim_requires_verified_status');
  }
  if (receipt.status === 'APPLIED' || receipt.status === 'VERIFIED' || receipt.status === 'ROLLED_BACK') {
    if (!receipt.rollback || !nonEmpty(receipt.rollback.snapshotId)
      || !SHA256.test(receipt.rollback.snapshotDigestSha256)) issues.push('rollback_binding_required');
  }
  if (receipt.status === 'ROLLED_BACK' && !nonEmpty(receipt.rollback?.sourceReceiptId)) {
    issues.push('rollback_source_receipt_required');
  }
  if (Object.values(receipt.verification).some(evidence => evidence.status === 'FAIL')
    && receipt.status !== 'REJECTED' && receipt.status !== 'ROLLED_BACK') issues.push('failed_verification_must_fail_closed');
  return { accepted: issues.length === 0, issues: [...new Set(issues)] };
}
