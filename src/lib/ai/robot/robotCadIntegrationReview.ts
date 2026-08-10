import { createHash, createPublicKey, verify } from 'node:crypto';
import { hashRobotCadIntegrationTarget, type RobotCadIntegrationPacket } from './robotCadIntegrationPacket';
import type { TrustedReviewerKeys } from '@/lib/reference/nativeCadExpertReview';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
export type RobotCadIntegrationSignoff = { role: 'domain-reviewer' | 'independent-reviewer'; reviewerId: string; decision: 'approved' | 'rejected' | 'changes_requested'; reviewedAt: string; targetHash: string; signature: string };
export type RobotCadIntegrationReview = { schema: 'nexyfab.robot-cad-integration-review.v1'; targetHash: string; signoffs: RobotCadIntegrationSignoff[] };
export type RobotCadIntegrationReviewResult = { schema: 'nexyfab.robot-cad-integration-review-validation.v1'; targetHash: string; approved: boolean; integrationAuthorized: boolean; cadApplied: false; releaseReady: false; nextStep: 'create_new_cad_revision_then_reverify'; errors: string[]; sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false } };

export const robotCadIntegrationSignoffPayload = (value: Omit<RobotCadIntegrationSignoff, 'signature'>) => JSON.stringify({ decision: value.decision, reviewedAt: value.reviewedAt, reviewerId: value.reviewerId, role: value.role, targetHash: value.targetHash });

export function verifyRobotCadIntegrationReview(packet: RobotCadIntegrationPacket, review: RobotCadIntegrationReview | undefined, trusted: TrustedReviewerKeys, now = Date.now()): RobotCadIntegrationReviewResult {
  const errors: string[] = []; let computed = '';
  try { computed = hashRobotCadIntegrationTarget(packet); } catch { errors.push('integration_packet_target_invalid'); }
  if (packet.schema !== 'nexyfab.robot-cad-integration-review-packet.v1' || packet.readiness !== 'review_pending' || packet.expertReviewRequired !== true || packet.cadIntegrationStatus !== 'not_applied' || packet.releaseReady !== false || packet.replacements.length !== 6 || packet.errors.length || Object.values(packet.sideEffects).some(value => value !== false)) errors.push('integration_packet_not_reviewable');
  if (!computed || computed !== packet.targetHash) errors.push('integration_packet_hash_mismatch');
  if (!review || review.schema !== 'nexyfab.robot-cad-integration-review.v1' || review.targetHash !== packet.targetHash) errors.push('integration_review_missing_or_target_mismatch');
  const signoffs = Array.isArray(review?.signoffs) ? review.signoffs : [];
  for (const role of ['domain-reviewer', 'independent-reviewer'] as const) if (signoffs.filter(item => item?.role === role).length !== 1) errors.push(`integration_review_signoff_invalid:${role}`);
  if (signoffs.length !== 2) errors.push('integration_review_requires_exactly_two_signoffs');
  if (signoffs.length === 2 && signoffs[0]!.reviewerId === signoffs[1]!.reviewerId) errors.push('integration_reviewers_not_independent');
  const fingerprints = signoffs.map(item => trusted[item.reviewerId] ? fingerprint(trusted[item.reviewerId]!.publicKey) : null);
  if (fingerprints.length === 2 && fingerprints[0] && fingerprints[0] === fingerprints[1]) errors.push('integration_reviewer_keys_not_independent');
  for (const signoff of signoffs) {
    if (signoff.targetHash !== packet.targetHash) errors.push(`integration_review_target_mismatch:${signoff.role}`);
    if (signoff.decision !== 'approved') errors.push(`integration_review_not_approved:${signoff.role}`);
    if (!ISO_DATE.test(signoff.reviewedAt) || !Number.isFinite(Date.parse(signoff.reviewedAt)) || Date.parse(signoff.reviewedAt) > now + 300_000) errors.push(`integration_review_time_invalid:${signoff.role}`);
    const registration = trusted[signoff.reviewerId];
    if (!registration?.roles.includes(signoff.role)) errors.push(`integration_review_role_unauthorized:${signoff.role}`);
    try { const { signature: _signature, ...unsigned } = signoff; if (!registration || !verify(null, Buffer.from(robotCadIntegrationSignoffPayload(unsigned)), registration.publicKey, Buffer.from(signoff.signature, 'base64'))) errors.push(`integration_review_signature_invalid:${signoff.role}`); } catch { errors.push(`integration_review_signature_invalid:${signoff.role}`); }
  }
  const approved = errors.length === 0;
  return { schema: 'nexyfab.robot-cad-integration-review-validation.v1', targetHash: computed || packet.targetHash || '', approved, integrationAuthorized: approved, cadApplied: false, releaseReady: false, nextStep: 'create_new_cad_revision_then_reverify', errors: [...new Set(errors)], sideEffects: { persisted: false, cadModified: false, quoteCreated: false, rfqSent: false } };
}
function fingerprint(key: string) { try { return createHash('sha256').update(createPublicKey(key).export({ type: 'spki', format: 'der' })).digest('hex'); } catch { return null; } }
