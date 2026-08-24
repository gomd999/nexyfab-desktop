export const AI_DESIGN_CANDIDATE_QUALITY_SCHEMA = 'nexyfab.ai-design-candidate-quality.v1' as const;

export interface AiDesignCandidateQualityInput {
  id: string;
  title: string;
  summary: string;
  parameterKeys: readonly string[];
  featureKeys: readonly string[];
}

export interface AiDesignCandidatePairQuality {
  leftId: string;
  rightId: string;
  featureSimilarity: number;
  parameterSimilarity: number;
  wordingDuplicate: boolean;
  nearDuplicate: boolean;
}

export interface AiDesignCandidateQualityV1 {
  schema: typeof AI_DESIGN_CANDIDATE_QUALITY_SCHEMA;
  candidateCount: number;
  conceptPublishable: boolean;
  diversityScore: number;
  pairs: readonly AiDesignCandidatePairQuality[];
  issues: readonly string[];
  /** Quality/diversity is not geometry or manufacturing verification. */
  criticStatus: 'NOT_RUN';
  exactVerificationStatus: 'NOT_RUN';
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

function normalizedSet(values: readonly string[]): Set<string> { return new Set(values.map(value => value.trim().toLowerCase()).filter(Boolean)); }
function jaccard(left: readonly string[], right: readonly string[]): number {
  const a = normalizedSet(left), b = normalizedSet(right);
  const union = new Set([...a, ...b]);
  if (!union.size) return 1;
  return [...a].filter(value => b.has(value)).length / union.size;
}
function wording(value: string): string { return value.toLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ').trim().replace(/\s+/g, ' '); }

/** Deterministic concept-diversity gate. It never emits engineering PASS. */
export function assessAiDesignCandidateQuality(candidates: readonly AiDesignCandidateQualityInput[]): AiDesignCandidateQualityV1 {
  const bounded = candidates.slice(0, 3);
  const issues: string[] = [];
  if (candidates.length < 2) issues.push('candidate_comparison_requires_two_or_more');
  if (candidates.length > 3) issues.push('candidate_count_exceeds_limit');
  const ids = new Set<string>();
  for (const candidate of bounded) {
    if (!SAFE_ID.test(candidate.id) || ids.has(candidate.id)) issues.push('candidate_identity_invalid_or_duplicate');
    ids.add(candidate.id);
    if (!candidate.title.trim() || !candidate.summary.trim()) issues.push(`candidate_description_missing:${candidate.id}`);
    if (!candidate.featureKeys.length) issues.push(`candidate_features_missing:${candidate.id}`);
    if (new Set(candidate.featureKeys).size !== candidate.featureKeys.length || new Set(candidate.parameterKeys).size !== candidate.parameterKeys.length) issues.push(`candidate_keys_duplicate:${candidate.id}`);
  }
  const pairs: AiDesignCandidatePairQuality[] = [];
  for (let left = 0; left < bounded.length; left += 1) for (let right = left + 1; right < bounded.length; right += 1) {
    const a = bounded[left]!, b = bounded[right]!;
    const featureSimilarity = jaccard(a.featureKeys, b.featureKeys);
    const parameterSimilarity = jaccard(a.parameterKeys, b.parameterKeys);
    const wordingDuplicate = wording(`${a.title} ${a.summary}`) === wording(`${b.title} ${b.summary}`);
    const nearDuplicate = wordingDuplicate || (featureSimilarity >= 0.9 && parameterSimilarity >= 0.9);
    pairs.push({ leftId: a.id, rightId: b.id, featureSimilarity, parameterSimilarity, wordingDuplicate, nearDuplicate });
    if (nearDuplicate) issues.push(`candidate_near_duplicate:${a.id}:${b.id}`);
  }
  const diversityScore = pairs.length ? pairs.reduce((sum, pair) => sum + (1 - ((pair.featureSimilarity + pair.parameterSimilarity) / 2)), 0) / pairs.length : 0;
  return {
    schema: AI_DESIGN_CANDIDATE_QUALITY_SCHEMA,
    candidateCount: candidates.length,
    conceptPublishable: issues.length === 0,
    diversityScore,
    pairs,
    issues: [...new Set(issues)],
    criticStatus: 'NOT_RUN',
    exactVerificationStatus: 'NOT_RUN',
  };
}

