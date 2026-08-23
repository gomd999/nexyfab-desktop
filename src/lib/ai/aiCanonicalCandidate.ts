import { lockProtectsTarget, type DesignLockTarget } from './designWorkspaceRevision';
import { validateGuidedRequirementGate, type GuidedRequirementGate } from './guidedDesignBrief';

export const AI_CANONICAL_CANDIDATE_SCHEMA = 'nexyfab.ai-canonical-candidate.v1' as const;

export type AiCandidateKind = 'intent' | 'pattern' | 'feature_batch';
export type AiCandidateState = 'PREVIEW' | 'BLOCKED' | 'APPLIED' | 'DISCARDED';
export type AiCandidateEvidenceState = 'PREVIEW' | 'NOT_RUN' | 'PASS' | 'FAIL' | 'STALE';

export interface AiCandidateLock {
  id: string;
  target: DesignLockTarget;
}

export interface AiCandidateEvidence {
  id: string;
  label: string;
  status: AiCandidateEvidenceState;
  sourceId?: string;
  sourceHash?: string;
}

export interface AiCandidateMetric {
  id: string;
  label: string;
  value?: string | number;
  unit?: string;
  status: AiCandidateEvidenceState;
  sourceId?: string;
  sourceHash?: string;
}

export interface AiCanonicalCandidate {
  schema: typeof AI_CANONICAL_CANDIDATE_SCHEMA;
  id: string;
  kind: AiCandidateKind;
  baseRevision: string;
  summary: string;
  payload: Record<string, unknown>;
  changedTargets: DesignLockTarget[];
  evidence: AiCandidateEvidence[];
  metrics: AiCandidateMetric[];
  blockedLockIds: string[];
  issues: string[];
  state: AiCandidateState;
  createdAt: string;
  appliedAt?: string;
  /** User-confirmed intake facts bound to this proposal; never supplied by the model. */
  requirementGate?: GuidedRequirementGate;
  /** Optional request-only scope. In this mode edits outside the selected feature are blocked. */
  scope?: AiCandidateScope;
}

export interface AiCandidateScope {
  mode: 'new_design' | 'request_only_edit';
  featureId?: string;
  partInstanceId?: string;
}

export interface AiCandidateGuardResult {
  allowed: boolean;
  blockedLockIds: string[];
  issues: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const CLAIM_STATES = new Set<AiCandidateEvidenceState>(['PASS', 'FAIL']);

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function uniqueTargets(targets: DesignLockTarget[]): DesignLockTarget[] {
  const seen = new Set<string>();
  return targets.filter(target => {
    const key = `${target.kind}:${target.objectId}:${target.field ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Converts opaque AI wire payloads into conservative workspace targets. An
 * unknown or whole-model action is deliberately treated as a workspace edit,
 * so it cannot evade a narrower human or authority lock.
 */
export function aiCandidateChangedTargets(kind: AiCandidateKind, payload: Record<string, unknown>): DesignLockTarget[] {
  if (kind === 'pattern') return [{ kind: 'workspace', objectId: 'feature_tree' }];
  const intents = Array.isArray(payload.intents) ? payload.intents : [payload];
  const targets: DesignLockTarget[] = [];
  for (const raw of intents) {
    const intent = object(raw);
    if (!intent) {
      targets.push({ kind: 'workspace', objectId: 'feature_tree' });
      continue;
    }
    const intentKind = typeof intent.kind === 'string' ? intent.kind : '';
    if (intentKind === 'update_param' && typeof intent.featureId === 'string' && typeof intent.paramKey === 'string') {
      targets.push({ kind: 'parameter', objectId: intent.featureId, field: intent.paramKey });
    } else if (['remove_feature', 'reorder_feature', 'toggle_feature'].includes(intentKind) && typeof intent.featureId === 'string') {
      targets.push({ kind: 'feature', objectId: intent.featureId });
    } else if (intentKind === 'set_assembly_parts') {
      targets.push({ kind: 'assembly', objectId: 'main' });
    } else if (intentKind === 'set_base_shape' || typeof intent.shapeId === 'string') {
      targets.push({ kind: 'base_shape', objectId: 'main' });
      const params = object(intent.params);
      for (const field of Object.keys(params ?? {})) targets.push({ kind: 'parameter', objectId: 'base_shape:main', field });
    } else if (['add_feature', 'add_feature_on_selection', 'add_sketch_extrude'].includes(intentKind)) {
      // Additive edits do not mutate an existing locked value. The resulting
      // feature receives its own identity when the command is committed.
    } else {
      targets.push({ kind: 'workspace', objectId: 'feature_tree' });
    }
  }
  return uniqueTargets(targets);
}

function readBoundEvidence(payload: Record<string, unknown>): { evidence: AiCandidateEvidence[]; issues: string[] } {
  if (payload.evidence === undefined) return { evidence: [], issues: [] };
  if (!Array.isArray(payload.evidence)) return { evidence: [], issues: ['fabricated_or_unbound_evidence'] };
  const evidence: AiCandidateEvidence[] = [];
  const issues: string[] = [];
  for (const raw of payload.evidence) {
    const item = object(raw);
    const status = item?.status;
    const sourceHash = item?.sourceHash;
    const sourceId = item?.sourceId;
    if (!item || typeof item.id !== 'string' || typeof item.label !== 'string'
      || (status !== 'PASS' && status !== 'FAIL') || typeof sourceId !== 'string'
      || typeof sourceHash !== 'string' || !SHA256.test(sourceHash)) {
      issues.push('fabricated_or_unbound_evidence');
      continue;
    }
    evidence.push({ id: item.id, label: item.label, status, sourceId, sourceHash });
  }
  return { evidence, issues: [...new Set(issues)] };
}

function readMetrics(payload: Record<string, unknown>): { metrics: AiCandidateMetric[]; issues: string[] } {
  if (payload.comparisonMetrics === undefined) return { metrics: [], issues: [] };
  if (!Array.isArray(payload.comparisonMetrics)) return { metrics: [], issues: ['invalid_candidate_metric'] };
  const metrics: AiCandidateMetric[] = [];
  const issues: string[] = [];
  for (const raw of payload.comparisonMetrics) {
    const item = object(raw);
    const status = item?.status;
    const sourceHash = item?.sourceHash;
    const needsSource = typeof status === 'string' && CLAIM_STATES.has(status as AiCandidateEvidenceState);
    if (!item || typeof item.id !== 'string' || typeof item.label !== 'string'
      || !['PREVIEW', 'NOT_RUN', 'PASS', 'FAIL'].includes(String(status))
      || (item.value !== undefined && typeof item.value !== 'string' && typeof item.value !== 'number')
      || (needsSource && (typeof item.sourceId !== 'string' || typeof sourceHash !== 'string' || !SHA256.test(sourceHash)))) {
      issues.push(needsSource ? 'fabricated_or_unbound_metric' : 'invalid_candidate_metric');
      continue;
    }
    metrics.push({
      id: item.id,
      label: item.label,
      value: item.value as string | number | undefined,
      unit: typeof item.unit === 'string' ? item.unit : undefined,
      status: status as AiCandidateEvidenceState,
      sourceId: typeof item.sourceId === 'string' ? item.sourceId : undefined,
      sourceHash: typeof sourceHash === 'string' ? sourceHash : undefined,
    });
  }
  return { metrics, issues: [...new Set(issues)] };
}

function blockedLocks(targets: DesignLockTarget[], locks: readonly AiCandidateLock[]): string[] {
  const wholeWorkspace = targets.some(target => target.kind === 'workspace');
  return locks
    .filter(lock => wholeWorkspace || targets.some(target => lockProtectsTarget(lock as Parameters<typeof lockProtectsTarget>[0], target)))
    .map(lock => lock.id)
    .sort();
}

function scopeIssues(targets: DesignLockTarget[], scope?: AiCandidateScope): string[] {
  if (!scope || scope.mode !== 'request_only_edit') return [];
  if (!scope.featureId?.trim() && !scope.partInstanceId?.trim()) return ['missing_requested_scope_identity'];
  if (targets.length === 0) return ['requested_scope_unverifiable'];
  if (scope.featureId?.trim()) {
    const outside = targets.some(target =>
      (target.kind !== 'feature' && target.kind !== 'parameter') || target.objectId !== scope.featureId,
    );
    return outside ? ['requested_scope_violation'] : [];
  }
  // The feature-tree intent payload has no part-occurrence ownership map. A
  // selected part id alone therefore cannot prove that a feature belongs to
  // that occurrence; callers must bind an exact feature id or use the stronger
  // AiEditTransaction/repairScope verifier.
  return ['requested_part_scope_unverifiable'];
}

export function createAiCanonicalCandidate(input: {
  id: string;
  kind: AiCandidateKind;
  baseRevision: string;
  summary: string;
  payload: Record<string, unknown>;
  locks?: readonly AiCandidateLock[];
  requirementGate?: GuidedRequirementGate;
  scope?: AiCandidateScope;
  now?: string;
}): AiCanonicalCandidate {
  const changedTargets = aiCandidateChangedTargets(input.kind, input.payload);
  const bound = readBoundEvidence(input.payload);
  const metricResult = readMetrics(input.payload);
  const blockedLockIds = blockedLocks(changedTargets, input.locks ?? []);
  const requirementIssues = input.requirementGate ? validateGuidedRequirementGate(input.requirementGate) : [];
  const requestScopeIssues = scopeIssues(changedTargets, input.scope);
  const issues = [...new Set([
    ...bound.issues,
    ...metricResult.issues,
    ...(blockedLockIds.length ? ['protected_user_or_authority_value'] : []),
    ...requirementIssues,
    ...requestScopeIssues,
    ...(!input.baseRevision.trim() ? ['missing_base_revision'] : []),
  ])];
  return {
    schema: AI_CANONICAL_CANDIDATE_SCHEMA,
    id: input.id,
    kind: input.kind,
    baseRevision: input.baseRevision,
    summary: input.summary,
    payload: structuredClone(input.payload),
    changedTargets,
    evidence: [
      { id: 'ai-plan', label: 'AI plan', status: 'PREVIEW', sourceId: input.id },
      ...bound.evidence,
      { id: 'geometry-reverification', label: 'Geometry reverification', status: 'NOT_RUN' },
      { id: 'dfm-reverification', label: 'DFM reverification', status: 'NOT_RUN' },
    ],
    metrics: metricResult.metrics.length ? metricResult.metrics : [{ id: 'candidate-diff', label: 'Changed targets', value: changedTargets.length, status: 'PREVIEW', sourceId: input.id }],
    blockedLockIds,
    issues,
    state: issues.length ? 'BLOCKED' : 'PREVIEW',
    createdAt: input.now ?? new Date().toISOString(),
    ...(input.requirementGate ? { requirementGate: structuredClone(input.requirementGate) } : {}),
    ...(input.scope ? { scope: structuredClone(input.scope) } : {}),
  };
}

export function guardAiCanonicalCandidate(
  candidate: AiCanonicalCandidate,
  currentRevision: string,
  locks: readonly AiCandidateLock[] = [],
): AiCandidateGuardResult {
  const issues = [...candidate.issues];
  if (candidate.schema !== AI_CANONICAL_CANDIDATE_SCHEMA) issues.push('invalid_candidate_schema');
  if (candidate.state !== 'PREVIEW') issues.push('candidate_not_in_preview');
  if (candidate.baseRevision !== currentRevision) issues.push('stale_workspace_revision');
  if (candidate.requirementGate) issues.push(...validateGuidedRequirementGate(candidate.requirementGate));
  issues.push(...scopeIssues(candidate.changedTargets, candidate.scope));
  const currentBlockers = blockedLocks(candidate.changedTargets, locks);
  if (currentBlockers.length) issues.push('protected_user_or_authority_value');
  return {
    allowed: issues.length === 0 && currentBlockers.length === 0,
    blockedLockIds: [...new Set([...candidate.blockedLockIds, ...currentBlockers])].sort(),
    issues: [...new Set(issues)],
  };
}

/** Applying a plan never inherits prior verification. Downstream truth is stale or NOT_RUN until rerun. */
export function markAiCanonicalCandidateApplied(candidate: AiCanonicalCandidate, now?: string): AiCanonicalCandidate {
  return {
    ...candidate,
    state: 'APPLIED',
    appliedAt: now ?? new Date().toISOString(),
    evidence: candidate.evidence.map(item => item.id === 'ai-plan' ? item : {
      ...item,
      status: item.status === 'NOT_RUN' ? 'NOT_RUN' : 'STALE',
    }),
    metrics: candidate.metrics.map(metric => ({ ...metric, status: metric.status === 'NOT_RUN' ? 'NOT_RUN' : 'STALE' })),
  };
}

export function discardAiCanonicalCandidate(candidate: AiCanonicalCandidate): AiCanonicalCandidate {
  return candidate.state === 'PREVIEW' || candidate.state === 'BLOCKED'
    ? { ...candidate, state: 'DISCARDED' }
    : candidate;
}
