import { createHash, createPublicKey, verify } from 'node:crypto';
import type { TrustedReviewerKeys } from '@/lib/reference/nativeCadExpertReview';
import { nativeCadSignoffPayload, type NativeCadExpertSignoff } from '@/lib/reference/nativeCadExpertReview';

const SHA = /^[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
export type RobotFinalReleaseReview = { schema: 'nexyfab.robot-final-release-review.v1'; targetHash: string; signoffs: NativeCadExpertSignoff[] };
export type RobotFinalReleaseDecision = { schema: 'nexyfab.robot-final-release-decision.v1'; approved: boolean; releaseReady: boolean; releaseExecuted: false; targetHash: string | null; auditReportSha256: string; errors: string[]; blockers: string[]; sideEffects: { persisted: false; cadModified: false; releasePublished: false; quoteCreated: false; rfqSent: false } };

export function verifyRobotFinalReleaseReview(auditBytes: Uint8Array, review: RobotFinalReleaseReview | undefined, trusted: TrustedReviewerKeys, now = Date.now()): RobotFinalReleaseDecision {
  const errors: string[] = [];
  const auditHash = createHash('sha256').update(auditBytes).digest('hex');
  let audit: Record<string, unknown> | null = null;
  try { audit = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(auditBytes)); }
  catch { errors.push('release evidence audit must be valid UTF-8 JSON'); }
  const targetHash = typeof audit?.releaseTargetHash === 'string' ? audit.releaseTargetHash : null;
  const supportedAudit = audit?.schema === 'nexyfab.robot-release-evidence-audit.v1' || audit?.schema === 'nexyfab.robot-release-evidence-audit.v2';
  if (!audit || !supportedAudit || audit.status !== 'ready_for_final_review' || audit.releaseReady !== false || !Array.isArray(audit.errors) || audit.errors.length || !Array.isArray(audit.blockers) || audit.blockers.length !== 1 || audit.blockers[0] !== 'final_release_dual_signoff_required' || !targetHash || !SHA.test(targetHash)) errors.push('release evidence audit is not final-review ready');
  if (!review || review.schema !== 'nexyfab.robot-final-release-review.v1' || review.targetHash !== targetHash) errors.push('final release review missing or target mismatch');
  const signoffs = Array.isArray(review?.signoffs) ? review.signoffs : [];
  for (const role of ['domain-reviewer', 'independent-reviewer'] as const) if (signoffs.filter(item => item?.role === role).length !== 1) errors.push(`final_release_signoff_invalid:${role}`);
  if (signoffs.length !== 2) errors.push('final_release_requires_exactly_two_signoffs');
  if (signoffs.length === 2 && signoffs[0]!.reviewerId === signoffs[1]!.reviewerId) errors.push('final_release_reviewers_not_independent');
  const fingerprints = signoffs.map(signoff => trusted[signoff.reviewerId] ? fingerprint(trusted[signoff.reviewerId]!.publicKey) : null);
  if (fingerprints.length === 2 && fingerprints[0] && fingerprints[0] === fingerprints[1]) errors.push('final_release_keys_not_independent');
  for (const signoff of signoffs) {
    if (signoff.targetHash !== targetHash) errors.push(`final_release_target_mismatch:${signoff.role}`);
    if (signoff.decision !== 'approved') errors.push(`final_release_not_approved:${signoff.role}`);
    if (!ISO.test(signoff.reviewedAt) || !Number.isFinite(Date.parse(signoff.reviewedAt)) || Date.parse(signoff.reviewedAt) > now + 300_000) errors.push(`final_release_time_invalid:${signoff.role}`);
    const registration = trusted[signoff.reviewerId];
    if (!registration?.roles.includes(signoff.role)) errors.push(`final_release_role_unauthorized:${signoff.role}`);
    try {
      const { signature: _signature, ...unsigned } = signoff;
      if (!registration || !verify(null, Buffer.from(nativeCadSignoffPayload(unsigned)), registration.publicKey, Buffer.from(signoff.signature, 'base64'))) errors.push(`final_release_signature_invalid:${signoff.role}`);
    } catch { errors.push(`final_release_signature_invalid:${signoff.role}`); }
  }
  const approved = errors.length === 0;
  return { schema: 'nexyfab.robot-final-release-decision.v1', approved, releaseReady: approved, releaseExecuted: false, targetHash, auditReportSha256: auditHash, errors: [...new Set(errors)], blockers: approved ? [] : ['final_release_dual_signoff_required'], sideEffects: { persisted: false, cadModified: false, releasePublished: false, quoteCreated: false, rfqSent: false } };
}

function fingerprint(key: string) { try { return createHash('sha256').update(createPublicKey(key).export({ type: 'spki', format: 'der' })).digest('hex'); } catch { return null; } }
