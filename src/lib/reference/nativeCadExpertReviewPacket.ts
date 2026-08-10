import { hashNativeCadReviewTarget, hashNativeCadVerificationInput, verifyNativeCadExpertReview, type NativeCadExpertReview, type NativeCadReviewTarget, type TrustedReviewerKeys } from './nativeCadExpertReview';

export interface NativeCadExpertReviewPacket {
  schema: 'nexyfab.native-cad-expert-review-packet.v1';
  target: NativeCadReviewTarget;
  targetHash: string;
  policy: {
    requiredRoles: ['domain-reviewer', 'independent-reviewer'];
    privateKeysMustRemainOffline: true;
    editInvalidatesApproval: true;
  };
  signoffPayloadTemplates: Array<{
    role: 'domain-reviewer' | 'independent-reviewer';
    reviewerId: null;
    decision: null;
    reviewedAt: null;
    targetHash: string;
  }>;
}

type PacketSource = Pick<NativeCadReviewTarget, 'sourceHash' | 'artifactHashes' | 'jointDefinitionHash' | 'revision'>;

export function buildNativeCadExpertReviewPacket(source: PacketSource, verificationInput: unknown): NativeCadExpertReviewPacket {
  const target: NativeCadReviewTarget = { ...source, artifactHashes: [...source.artifactHashes], verificationInputHash: hashNativeCadVerificationInput(verificationInput) };
  const targetHash = hashNativeCadReviewTarget(target);
  return {
    schema: 'nexyfab.native-cad-expert-review-packet.v1', target, targetHash,
    policy: { requiredRoles: ['domain-reviewer', 'independent-reviewer'], privateKeysMustRemainOffline: true, editInvalidatesApproval: true },
    signoffPayloadTemplates: (['domain-reviewer', 'independent-reviewer'] as const).map(role => ({ role, reviewerId: null, decision: null, reviewedAt: null, targetHash })),
  };
}

export function validateNativeCadExpertReviewPacket(packet: NativeCadExpertReviewPacket, review: NativeCadExpertReview | undefined, trustedKeys: TrustedReviewerKeys) {
  const errors: string[] = [];
  if (!packet || packet.schema !== 'nexyfab.native-cad-expert-review-packet.v1') return { approved: false, errors: ['expert_review_packet_invalid'] };
  let targetHash = '';
  try { targetHash = hashNativeCadReviewTarget(packet.target); } catch { errors.push('expert_review_packet_target_invalid'); }
  if (!targetHash || packet.targetHash !== targetHash) errors.push('expert_review_packet_hash_mismatch');
  const result = verifyNativeCadExpertReview(review, packet.target, trustedKeys);
  errors.push(...result.errors);
  return { approved: errors.length === 0 && result.approved, targetHash, errors: [...new Set(errors)] };
}
