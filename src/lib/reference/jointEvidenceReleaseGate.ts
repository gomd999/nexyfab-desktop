export type JointEvidenceProvenance = 'native-cad' | 'user-confirmed' | 'geometry-inferred';

export interface JointEvidenceClaim {
  provenance: JointEvidenceProvenance;
  sourceHash: string;
  artifactHashes: string[];
  jointCount: number;
  semanticsComplete: boolean;
  reviewerApproved: boolean;
}

const SHA256 = /^[a-f0-9]{64}$/;

export function evaluateJointEvidenceRelease(claim: JointEvidenceClaim) {
  const errors: string[] = [];
  if (!SHA256.test(claim.sourceHash) || !claim.artifactHashes.length || claim.artifactHashes.some(hash => !SHA256.test(hash))) errors.push('joint_evidence_hash_invalid');
  if (!Number.isInteger(claim.jointCount) || claim.jointCount < 0) errors.push('joint_count_invalid');
  if (claim.provenance !== 'native-cad' && claim.semanticsComplete) errors.push('non_native_semantics_complete_forbidden');
  const nativeKpiEligible = errors.length === 0 && claim.provenance === 'native-cad' && claim.semanticsComplete && claim.reviewerApproved;
  const manufacturingReleaseEligible = nativeKpiEligible && claim.jointCount > 0;
  const usage = claim.provenance === 'geometry-inferred' ? 'visualization-only' : claim.provenance === 'user-confirmed' ? 'editable-unverified' : nativeKpiEligible ? 'native-verified' : 'native-pending-review';
  return { status: errors.length ? 'fail' as const : manufacturingReleaseEligible ? 'pass' as const : 'not_run' as const, nativeKpiEligible, manufacturingReleaseEligible, usage, errors };
}
