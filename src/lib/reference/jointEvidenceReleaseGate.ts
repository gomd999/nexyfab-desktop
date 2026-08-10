import { parseTrustedReviewerKeys, verifyNativeCadExpertReview, type NativeCadExpertReview, type TrustedReviewerKeys } from './nativeCadExpertReview';

export type JointEvidenceProvenance = 'native-cad' | 'user-confirmed' | 'geometry-inferred';

export interface JointEvidenceClaim {
  provenance: JointEvidenceProvenance;
  sourceHash: string;
  artifactHashes: string[];
  jointDefinitionHash: string;
  verificationInputHash: string;
  revision: number;
  jointCount: number;
  semanticsComplete: boolean;
  expertReview?: NativeCadExpertReview;
}

const SHA256 = /^[a-f0-9]{64}$/;

export function evaluateJointEvidenceRelease(claim: JointEvidenceClaim, trustedKeys: TrustedReviewerKeys = parseTrustedReviewerKeys(), expectedVerificationInputHash?: string) {
  const errors: string[] = [];
  const artifactHashes = Array.isArray(claim?.artifactHashes) ? claim.artifactHashes : [];
  if (!claim || !SHA256.test(claim.sourceHash) || !artifactHashes.length || artifactHashes.some(hash => !SHA256.test(hash)) || new Set(artifactHashes).size !== artifactHashes.length) errors.push('joint_evidence_hash_invalid');
  if (!Number.isInteger(claim.jointCount) || claim.jointCount < 0) errors.push('joint_count_invalid');
  if (!SHA256.test(claim.jointDefinitionHash) || !SHA256.test(claim.verificationInputHash) || !Number.isInteger(claim.revision) || claim.revision < 1) errors.push('joint_definition_identity_invalid');
  if (expectedVerificationInputHash && claim.verificationInputHash !== expectedVerificationInputHash) errors.push('verification_input_hash_mismatch');
  if (claim.provenance !== 'native-cad' && claim.semanticsComplete) errors.push('non_native_semantics_complete_forbidden');
  const review = verifyNativeCadExpertReview(claim.expertReview, { sourceHash: claim.sourceHash, artifactHashes, jointDefinitionHash: claim.jointDefinitionHash, verificationInputHash: claim.verificationInputHash, revision: claim.revision }, trustedKeys);
  if (claim.provenance === 'native-cad' && claim.semanticsComplete && !review.approved) errors.push(...review.errors);
  const nativeKpiEligible = errors.length === 0 && claim.provenance === 'native-cad' && claim.semanticsComplete && review.approved;
  const manufacturingReleaseEligible = nativeKpiEligible && claim.jointCount > 0;
  const usage = claim.provenance === 'geometry-inferred' ? 'visualization-only' : claim.provenance === 'user-confirmed' ? 'editable-unverified' : nativeKpiEligible ? 'native-verified' : 'native-pending-review';
  return { status: errors.length ? 'fail' as const : manufacturingReleaseEligible ? 'pass' as const : 'not_run' as const, nativeKpiEligible, manufacturingReleaseEligible, usage, errors };
}
