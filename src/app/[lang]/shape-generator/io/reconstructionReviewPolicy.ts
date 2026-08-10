import type { ReconstructedFeatureTree } from './stepReverseEngineer';

export type ReconstructionReviewStatus = 'candidate' | 'review_required' | 'reference_only';
export type ReconstructionGrade = 'A' | 'B' | 'C' | 'D';

export interface ReconstructionReviewDecision {
  status: ReconstructionReviewStatus;
  grade: ReconstructionGrade;
  canApplyBase: boolean;
  reasons: string[];
}

/** Separates a plausible editable candidate from unverified/reference geometry. */
export function decideReconstructionReview(tree: ReconstructedFeatureTree): ReconstructionReviewDecision {
  const reasons = [...tree.limitations];
  if (tree.baseShape.type === 'imported_mesh') reasons.push('No editable analytic base shape was reconstructed.');
  if (tree.overallConfidence < 0.75) reasons.push('Overall reconstruction confidence is below 75%.');
  if (tree.baseShape.confidence < 0.75) reasons.push('Base-shape confidence is below 75%.');

  if (tree.baseShape.type === 'imported_mesh') {
    return {
      status: 'reference_only',
      grade: tree.overallConfidence >= 0.5 ? 'C' : 'D',
      canApplyBase: false,
      reasons,
    };
  }
  if (reasons.length > 0) {
    return {
      status: 'review_required',
      grade: tree.overallConfidence >= 0.5 ? 'C' : 'D',
      canApplyBase: false,
      reasons,
    };
  }
  return {
    status: 'candidate',
    grade: tree.overallConfidence >= 0.9 && tree.baseShape.confidence >= 0.9 ? 'A' : 'B',
    canApplyBase: true,
    reasons: [],
  };
}
