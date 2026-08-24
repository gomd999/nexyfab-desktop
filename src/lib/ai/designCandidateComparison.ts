/**
 * Headless candidate comparison model for AI Design.
 *
 * This module deliberately treats missing evidence as missing evidence. A
 * candidate is never upgraded to PASS because it has a score, a model name,
 * or a recommendation. The CAD/verification consumer can enrich the model
 * later without changing the selection and revision rules here.
 */

export const DESIGN_CANDIDATE_COMPARISON_SCHEMA = 'nexyfab.design-candidate-comparison.v1' as const;

export type CandidateEvidenceStatus = 'verified' | 'failed' | 'unknown' | 'not_run';
export type CandidateMetricStatus = CandidateEvidenceStatus;

export interface CandidateMetric {
  metricId: string;
  label: string;
  value: number | string | null;
  unit?: string;
  status: CandidateMetricStatus;
  evidenceId?: string;
}

export interface CandidateEvidence {
  evidenceId: string;
  label: string;
  status: CandidateEvidenceStatus;
  summary?: string;
  source?: string;
}

export interface DesignCandidate {
  candidateId: string;
  revision: string;
  baseRevision: string;
  title: string;
  summary: string;
  metrics: readonly CandidateMetric[];
  evidence: readonly CandidateEvidence[];
  /** Stable IDs make partial application deterministic and auditable. */
  featureIds: readonly string[];
  modelId?: string;
  provenance?: readonly string[];
}

export interface CandidateRecommendation {
  candidateId: string | null;
  eligible: boolean;
  /** True when the card is useful as a concept, but exact verification is still required. */
  verificationRequired: boolean;
  reasons: readonly string[];
}

export interface CandidateComparisonOptions {
  /** Explicit product/UI choice for a conceptual default. It never marks evidence verified. */
  conceptualRecommendationCandidateId?: string;
}

export interface CandidateComparisonViewModel {
  schema: typeof DESIGN_CANDIDATE_COMPARISON_SCHEMA;
  baseRevision: string;
  revision: number;
  candidates: readonly DesignCandidate[];
  recommendation: CandidateRecommendation;
  /** Candidate IDs with no duplicate/revision conflicts. */
  selectableCandidateIds: readonly string[];
}

export type CandidateApplyResult =
  | { ok: true; candidateId: string; baseRevision: string; mode: 'whole' | 'partial'; featureIds: readonly string[]; actionId: string }
  | { ok: false; issues: readonly string[] };

const statuses: readonly CandidateEvidenceStatus[] = ['verified', 'failed', 'unknown', 'not_run'];
const isStatus = (value: unknown): value is CandidateEvidenceStatus => statuses.includes(value as CandidateEvidenceStatus);
const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function cloneCandidate(candidate: DesignCandidate): DesignCandidate {
  return {
    ...candidate,
    metrics: candidate.metrics.map(metric => ({ ...metric })),
    evidence: candidate.evidence.map(item => ({ ...item })),
    featureIds: [...candidate.featureIds],
    provenance: candidate.provenance ? [...candidate.provenance] : undefined,
  };
}

function candidateIssues(candidate: DesignCandidate, baseRevision: string): string[] {
  const issues: string[] = [];
  if (!validId(candidate.candidateId)) issues.push('candidate_id_required');
  if (!validId(candidate.revision)) issues.push(`candidate_revision_required:${candidate.candidateId}`);
  if (candidate.baseRevision !== baseRevision) issues.push(`candidate_base_revision_mismatch:${candidate.candidateId}`);
  if (!candidate.title.trim()) issues.push(`candidate_title_required:${candidate.candidateId}`);
  const seenMetrics = new Set<string>();
  for (const metric of candidate.metrics) {
    if (!validId(metric.metricId) || seenMetrics.has(metric.metricId)) issues.push(`duplicate_metric:${candidate.candidateId}`);
    seenMetrics.add(metric.metricId);
    if (!isStatus(metric.status)) issues.push(`invalid_metric_status:${candidate.candidateId}:${metric.metricId}`);
  }
  const seenEvidence = new Set<string>();
  for (const evidence of candidate.evidence) {
    if (!validId(evidence.evidenceId) || seenEvidence.has(evidence.evidenceId)) issues.push(`duplicate_evidence:${candidate.candidateId}`);
    seenEvidence.add(evidence.evidenceId);
    if (!isStatus(evidence.status)) issues.push(`invalid_evidence_status:${candidate.candidateId}:${evidence.evidenceId}`);
  }
  if (new Set(candidate.featureIds).size !== candidate.featureIds.length) issues.push(`duplicate_feature:${candidate.candidateId}`);
  return issues;
}

function eligible(candidate: DesignCandidate): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const failed = [...candidate.evidence, ...candidate.metrics].filter(item => item.status === 'failed');
  const incomplete = [...candidate.evidence, ...candidate.metrics].filter(item => item.status === 'unknown' || item.status === 'not_run');
  if (failed.length) reasons.push('contains_failed_evidence');
  if (incomplete.length) reasons.push('verification_incomplete');
  if (!candidate.evidence.length && !candidate.metrics.length) reasons.push('no_verification_evidence');
  return { ok: reasons.length === 0, reasons };
}

/** Build a deterministic, immutable-friendly comparison model (max 3 cards). */
export function createDesignCandidateComparison(
  baseRevision: string,
  candidates: readonly DesignCandidate[],
  options: CandidateComparisonOptions = {},
): CandidateComparisonViewModel {
  const unique = new Map<string, DesignCandidate>();
  const normalized: DesignCandidate[] = [];
  for (const candidate of candidates.slice(0, 3)) {
    if (unique.has(candidate.candidateId)) continue;
    unique.set(candidate.candidateId, candidate);
    normalized.push(cloneCandidate(candidate));
  }
  const issues = normalized.flatMap(candidate => candidateIssues(candidate, baseRevision));
  const eligibleCandidates = normalized
    .map(candidate => ({ candidate, result: eligible(candidate) }))
    .filter(item => item.candidate.baseRevision === baseRevision && item.result.ok);
  // Eligibility is intentionally all-or-nothing: scores do not manufacture a PASS.
  const recommendation = eligibleCandidates.length === 1
    ? { candidateId: eligibleCandidates[0]!.candidate.candidateId, eligible: true, verificationRequired: false, reasons: ['all_available_evidence_verified'] }
    : eligibleCandidates.length > 1
      ? { candidateId: eligibleCandidates[0]!.candidate.candidateId, eligible: true, verificationRequired: false, reasons: ['all_available_evidence_verified', 'first_verified_candidate_is_stable_default'] }
      : options.conceptualRecommendationCandidateId && normalized.some(candidate => candidate.candidateId === options.conceptualRecommendationCandidateId && candidate.baseRevision === baseRevision)
        ? { candidateId: options.conceptualRecommendationCandidateId, eligible: false, verificationRequired: true, reasons: ['conceptual_recommendation_only', 'verification_required_before_apply'] }
        : { candidateId: null, eligible: false, verificationRequired: true, reasons: issues.length ? ['candidate_contract_invalid', ...issues] : ['no_candidate_has_complete_verified_evidence'] };
  return {
    schema: DESIGN_CANDIDATE_COMPARISON_SCHEMA,
    baseRevision,
    revision: 1,
    candidates: normalized,
    recommendation,
    selectableCandidateIds: normalized.filter(candidate => candidate.baseRevision === baseRevision).map(candidate => candidate.candidateId),
  };
}

export const buildDesignCandidateComparison = createDesignCandidateComparison;

function applyCandidate(
  model: CandidateComparisonViewModel,
  candidateId: string,
  currentRevision: string,
  featureIds: readonly string[] | undefined,
): CandidateApplyResult {
  if (currentRevision !== model.baseRevision) return { ok: false, issues: ['stale_workspace_revision'] };
  const candidate = model.candidates.find(item => item.candidateId === candidateId);
  if (!candidate) return { ok: false, issues: ['candidate_not_found'] };
  const contractIssues = candidateIssues(candidate, model.baseRevision);
  if (contractIssues.length) return { ok: false, issues: contractIssues };
  const verification = eligible(candidate);
  if (!verification.ok) return { ok: false, issues: verification.reasons };
  const requested = featureIds ? [...new Set(featureIds)] : [...candidate.featureIds];
  if (!requested.length) return { ok: false, issues: ['feature_selection_required'] };
  const available = new Set(candidate.featureIds);
  const outside = requested.filter(id => !available.has(id));
  if (outside.length) return { ok: false, issues: ['feature_outside_candidate', ...outside] };
  const mode = featureIds ? 'partial' : 'whole';
  return { ok: true, candidateId, baseRevision: model.baseRevision, mode, featureIds: requested, actionId: `apply:${candidateId}:${candidate.revision}:${mode}:${requested.join(',')}` };
}

export function applyWholeDesignCandidate(model: CandidateComparisonViewModel, candidateId: string, currentRevision = model.baseRevision): CandidateApplyResult {
  return applyCandidate(model, candidateId, currentRevision, undefined);
}

export function applyPartialDesignCandidate(model: CandidateComparisonViewModel, candidateId: string, featureIds: readonly string[], currentRevision = model.baseRevision): CandidateApplyResult {
  return applyCandidate(model, candidateId, currentRevision, featureIds);
}
