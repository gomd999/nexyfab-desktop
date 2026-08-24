import type { AiDesignCandidateArtifactV1, AiDesignArtifactEvidenceStatus } from './aiDesignCandidateArtifact';

export const AI_DESIGN_CHANGE_IMPACT_SCHEMA = 'nexyfab.ai-design-change-impact.v1' as const;
export type AiDesignImpactReason = 'parameter_changed' | 'intent_changed' | 'gauge_changed' | 'artifact_changed' | 'unknown_dependency';
export type AiDesignReverificationKind = 'geometry' | 'topology' | 'manufacturing' | 'design_intent' | 'gauge';

export interface AiDesignChangedParameter { parameterId: string; intentNodeId?: string; featureId?: string; }
export interface AiDesignChangeSet {
  projectId: string;
  sessionId: string;
  fromRevision: string;
  toRevision: string;
  changedParameters?: readonly AiDesignChangedParameter[];
  changedIntentNodeIds?: readonly string[];
  changedGaugeIds?: readonly string[];
  changedArtifactIds?: readonly string[];
  unknownDependency?: boolean;
}

export interface AiDesignInvalidatedEvidence {
  artifactId: string;
  evidenceId: string;
  previousStatus: AiDesignArtifactEvidenceStatus;
  nextStatus: 'invalidated';
  reasons: readonly AiDesignImpactReason[];
}

export interface AiDesignReverificationStep {
  stepId: string;
  artifactId: string;
  kind: AiDesignReverificationKind;
  status: 'not_run';
  priority: number;
  dependsOn: readonly string[];
  reason: readonly AiDesignImpactReason[];
}

export interface AiDesignChangeImpactPlanV1 {
  schema: typeof AI_DESIGN_CHANGE_IMPACT_SCHEMA;
  fromRevision: string;
  toRevision: string;
  affectedArtifactIds: readonly string[];
  affectedGaugeIds: readonly string[];
  invalidatedEvidence: readonly AiDesignInvalidatedEvidence[];
  reverificationPlan: readonly AiDesignReverificationStep[];
  bounded: boolean;
}

const MAX = 100;
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;
const unique = (values: readonly string[]) => [...new Set(values.filter(id))];

function reasonsFor(artifact: AiDesignCandidateArtifactV1, changes: AiDesignChangeSet): AiDesignImpactReason[] {
  const reasons: AiDesignImpactReason[] = [];
  const params = new Set((changes.changedParameters ?? []).map(item => item.parameterId));
  const intents = new Set(changes.changedIntentNodeIds ?? []);
  const gauges = new Set(changes.changedGaugeIds ?? []);
  if ((changes.changedArtifactIds ?? []).includes(artifact.artifactId)) reasons.push('artifact_changed');
  if (artifact.dependencies.parameterIds.some(item => params.has(item))) reasons.push('parameter_changed');
  if (artifact.dependencies.intentNodeIds.some(item => intents.has(item)) || (changes.changedParameters ?? []).some(item => item.intentNodeId && artifact.dependencies.intentNodeIds.includes(item.intentNodeId))) reasons.push('intent_changed');
  if (artifact.dependencies.gaugeIds.some(item => gauges.has(item))) reasons.push('gauge_changed');
  if (changes.unknownDependency) reasons.push('unknown_dependency');
  return [...new Set(reasons)];
}

function kinds(reasons: readonly AiDesignImpactReason[]): AiDesignReverificationKind[] {
  const result: AiDesignReverificationKind[] = [];
  if (reasons.some(item => ['parameter_changed', 'intent_changed', 'artifact_changed', 'unknown_dependency'].includes(item))) result.push('design_intent', 'geometry', 'topology', 'manufacturing');
  if (reasons.includes('gauge_changed')) result.push('gauge', 'geometry', 'manufacturing');
  return [...new Set(result)];
}

/**
 * Creates a conservative, deterministic invalidation plan. It does not mark
 * any check PASS: every newly required check starts at NOT_RUN.
 */
export function planAiDesignChangeImpact(changes: AiDesignChangeSet, artifacts: readonly AiDesignCandidateArtifactV1[]): AiDesignChangeImpactPlanV1 {
  const boundedArtifacts = artifacts.slice(0, MAX);
  const affected: { artifact: AiDesignCandidateArtifactV1; reasons: AiDesignImpactReason[] }[] = [];
  for (const artifact of boundedArtifacts) {
    if (artifact.projectId !== changes.projectId || artifact.sessionId !== changes.sessionId) continue;
    const reasons = reasonsFor(artifact, changes);
    if (reasons.length) affected.push({ artifact, reasons });
  }
  const affectedGaugeIds = unique([
    ...(changes.changedGaugeIds ?? []),
    ...affected.flatMap(item => item.artifact.dependencies.gaugeIds),
  ]).slice(0, MAX);
  const invalidatedEvidence = affected.flatMap(({ artifact, reasons }) => artifact.evidence.map(evidence => ({ artifactId: artifact.artifactId, evidenceId: evidence.evidenceId, previousStatus: evidence.status, nextStatus: 'invalidated' as const, reasons }))).slice(0, MAX);
  const reverificationPlan: AiDesignReverificationStep[] = [];
  for (const item of affected) {
    const itemKinds = kinds(item.reasons);
    itemKinds.forEach((kind, index) => {
      if (reverificationPlan.length >= MAX) return;
      const stepId = `reverify:${item.artifact.artifactId}:${kind}`;
      const dependsOn = index === 0 ? [] : [`reverify:${item.artifact.artifactId}:${itemKinds[index - 1]}`];
      reverificationPlan.push({ stepId, artifactId: item.artifact.artifactId, kind, status: 'not_run', priority: index + 1, dependsOn, reason: item.reasons });
    });
  }
  return {
    schema: AI_DESIGN_CHANGE_IMPACT_SCHEMA,
    fromRevision: changes.fromRevision,
    toRevision: changes.toRevision,
    affectedArtifactIds: affected.map(item => item.artifact.artifactId).slice(0, MAX),
    affectedGaugeIds,
    invalidatedEvidence,
    reverificationPlan,
    bounded: artifacts.length > MAX || invalidatedEvidence.length >= MAX || reverificationPlan.length >= MAX,
  };
}

export const buildAiDesignChangeImpactPlan = planAiDesignChangeImpact;
