import type { AiDesignWorkspaceRuntimeV1 } from './aiDesignWorkspaceRuntime';
import { createAiDesignIntentGraph } from './aiDesignIntentGraph';
import { planAiDesignQuestions, type AiDesignQuestion } from './aiDesignQuestionPlanner';
import { assessAiDesignCandidateQuality, type AiDesignCandidateQualityV1 } from './aiDesignCandidateQuality';

export const AI_DESIGN_WORKSPACE_V2_VIEW_MODEL_SCHEMA = 'nexyfab.ai-design-workspace-v2-view-model.v1' as const;

export type AiDesignWorkspaceV2CommandType =
  | 'REQUEST_UNDERSTANDING_CONFIRMATION'
  | 'START_GENERATION_REQUEST'
  | 'RUN_GENERATION_STAGE_REQUEST'
  | 'RETRY_GENERATION_REQUEST'
  | 'SELECT_CANDIDATE'
  | 'BEGIN_PARAMETRIC_EDIT'
  | 'REQUEST_PRECISION'
  | 'RESUME';

export interface AiDesignWorkspaceV2ActionVm {
  command: AiDesignWorkspaceV2CommandType;
  label: string;
  enabled: boolean;
  reason: string | null;
}

export interface AiDesignWorkspaceV2ViewModel {
  schema: typeof AI_DESIGN_WORKSPACE_V2_VIEW_MODEL_SCHEMA;
  projectId: string;
  runtimeRevision: number;
  layout: {
    mode: 'desktop' | 'mobile';
    primaryRegion: 'understanding' | 'generation' | 'comparison' | 'editing' | 'precision' | 'recovery';
    mobileSheet: 'intent' | 'generation' | 'candidates' | 'gauges' | 'precision' | 'recovery' | null;
    stickyPrimaryAction: boolean;
  };
  model: {
    publicModelId: string | null;
    selectionStatus: 'selected' | 'blocked' | 'not_selected';
    explanation: readonly string[];
    exactGeometryAuthority: false;
  };
  intent: { questionCount: number; questions: readonly AiDesignQuestion[]; conflictCount: number; assumptionCount: number };
  generation: {
    status: string;
    currentStage: string | null;
    completedStages: number;
    totalStages: number;
    percent: null;
    failure: string | null;
  };
  candidates: { visible: boolean; selectedCandidateId: string | null; quality: AiDesignCandidateQualityV1 | null };
  gauges: readonly {
    gaugeId: string;
    label: string;
    targetValue: number;
    unit: string;
    fineStep: number;
    coarseStep: number;
    requiresConfirmation: boolean;
    touchTargetMinPx: 44;
  }[];
  trust: {
    conceptOnly: true;
    candidateVerification: 'NOT_RUN' | 'INCOMPLETE' | 'FAILED' | 'PASS';
    precisionVerification: 'NOT_RUN' | 'STALE' | 'PASS';
    manufacturingReleaseReady: false;
  };
  primaryAction: AiDesignWorkspaceV2ActionVm | null;
  secondaryActions: readonly AiDesignWorkspaceV2ActionVm[];
}

function action(command: AiDesignWorkspaceV2CommandType, label: string, enabled = true, reason: string | null = null): AiDesignWorkspaceV2ActionVm {
  return { command, label, enabled, reason };
}

function actions(state: AiDesignWorkspaceRuntimeV1): readonly AiDesignWorkspaceV2ActionVm[] {
  switch (state.workflow.status) {
    case 'UNDERSTANDING': return [action('REQUEST_UNDERSTANDING_CONFIRMATION', 'Confirm understanding')];
    case 'READY_TO_GENERATE': return [action('START_GENERATION_REQUEST', 'Generate design options')];
    case 'GENERATING': return state.generation?.status === 'RETRY_WAIT'
      ? [action('RETRY_GENERATION_REQUEST', 'Retry generation')]
      : [action('RUN_GENERATION_STAGE_REQUEST', state.generation?.currentStage ? `Run ${state.generation.currentStage.replaceAll('_', ' ')}` : 'Continue generation', state.generation?.status === 'RUNNING', state.generation?.status === 'RUNNING' ? null : 'Generation is not runnable')];
    case 'CANDIDATE_REVIEW': return [
      action('SELECT_CANDIDATE', 'Select a candidate', state.candidates !== null, state.candidates ? null : 'Candidates are not available'),
      action('BEGIN_PARAMETRIC_EDIT', 'Edit parameters'), action('REQUEST_PRECISION', 'Send to Precision CAD'),
    ];
    case 'PARAMETRIC_EDIT': return [action('REQUEST_PRECISION', 'Send to Precision CAD')];
    case 'PRECISION_PENDING': case 'PRECISION_VERIFYING': return [];
    case 'CANCELLED': case 'FAILED': return [action('RESUME', 'Resume')];
    default: return [];
  }
}

function primaryRegion(state: AiDesignWorkspaceRuntimeV1): AiDesignWorkspaceV2ViewModel['layout']['primaryRegion'] {
  if (state.workflow.status === 'UNDERSTANDING' || state.workflow.status === 'NEEDS_INPUT') return 'understanding';
  if (state.workflow.status === 'READY_TO_GENERATE' || state.workflow.status === 'GENERATING') return 'generation';
  if (state.workflow.status === 'CANDIDATE_REVIEW') return 'comparison';
  if (state.workflow.status === 'PARAMETRIC_EDIT') return 'editing';
  if (state.workflow.status === 'PRECISION_PENDING' || state.workflow.status === 'PRECISION_VERIFYING' || state.workflow.status === 'VERIFIED') return 'precision';
  return 'recovery';
}

function mobileSheet(region: AiDesignWorkspaceV2ViewModel['layout']['primaryRegion']): NonNullable<AiDesignWorkspaceV2ViewModel['layout']['mobileSheet']> {
  return { understanding: 'intent', generation: 'generation', comparison: 'candidates', editing: 'gauges', precision: 'precision', recovery: 'recovery' }[region] as NonNullable<AiDesignWorkspaceV2ViewModel['layout']['mobileSheet']>;
}

function candidateVerification(state: AiDesignWorkspaceRuntimeV1): AiDesignWorkspaceV2ViewModel['trust']['candidateVerification'] {
  const items = state.candidates?.candidates.flatMap(candidate => [...candidate.evidence, ...candidate.metrics]) ?? [];
  if (!items.length) return 'NOT_RUN';
  if (items.some(item => item.status === 'failed')) return 'FAILED';
  if (items.some(item => item.status === 'unknown' || item.status === 'not_run')) return 'INCOMPLETE';
  return 'PASS';
}

export function createAiDesignWorkspaceV2ViewModel(state: AiDesignWorkspaceRuntimeV1, options: { viewportWidth?: number } = {}): AiDesignWorkspaceV2ViewModel {
  const mobile = (options.viewportWidth ?? 1280) < 768;
  const region = primaryRegion(state);
  const graph = createAiDesignIntentGraph(state.checkpoint);
  const questionPlan = planAiDesignQuestions(state.checkpoint, graph);
  const receipt = state.generation?.modelReceipt;
  const modelExplanation = receipt ? [
    receipt.status === 'selected' ? `Selected ${receipt.selectedModelId}` : `Selection blocked: ${receipt.reason ?? 'unknown'}`,
    ...(receipt.fallback.applied ? [`Fallback from ${receipt.fallback.fromModelId} to ${receipt.fallback.toModelId}: ${receipt.fallback.reason}`] : []),
    ...state.generation!.modelChanges.map(change => `Changed ${change.fromModelId} to ${change.toModelId}: ${change.reason}`),
  ] : ['A model is selected only when generation starts.'];
  const quality = state.candidates ? assessAiDesignCandidateQuality(state.candidates.candidates.map(candidate => ({
    id: candidate.candidateId, title: candidate.title, summary: candidate.summary,
    parameterKeys: candidate.metrics.map(metric => metric.metricId), featureKeys: candidate.featureIds,
  }))) : null;
  const availableActions = actions(state);
  return {
    schema: AI_DESIGN_WORKSPACE_V2_VIEW_MODEL_SCHEMA,
    projectId: state.projectId,
    runtimeRevision: state.runtimeRevision,
    layout: { mode: mobile ? 'mobile' : 'desktop', primaryRegion: region, mobileSheet: mobile ? mobileSheet(region) : null, stickyPrimaryAction: mobile && availableActions.length > 0 },
    model: { publicModelId: receipt?.selectedModelId ?? null, selectionStatus: receipt?.status ?? 'not_selected', explanation: modelExplanation, exactGeometryAuthority: false },
    intent: { questionCount: questionPlan.unresolvedCount, questions: questionPlan.questions, conflictCount: state.checkpoint.conflicts.length, assumptionCount: state.checkpoint.aiAssumptions.length },
    generation: { status: state.generation?.status ?? 'NOT_STARTED', currentStage: state.generation?.currentStage ?? null, completedStages: state.generation?.progress.completedStages ?? 0, totalStages: state.generation?.progress.totalStages ?? 4, percent: null, failure: state.generation?.failure ?? null },
    candidates: { visible: state.workflow.status === 'CANDIDATE_REVIEW' || state.workflow.status === 'PARAMETRIC_EDIT', selectedCandidateId: state.selectedCandidateId, quality },
    gauges: state.gauges.map(gauge => ({ gaugeId: gauge.gaugeId, label: gauge.type, targetValue: gauge.targetValue, unit: gauge.unit, fineStep: gauge.steps.fine, coarseStep: gauge.steps.coarse, requiresConfirmation: gauge.requiresConfirmation, touchTargetMinPx: 44 })),
    trust: {
      conceptOnly: true,
      candidateVerification: candidateVerification(state),
      precisionVerification: state.workflow.status === 'VERIFIED' ? 'PASS' : state.workflow.status === 'STALE' ? 'STALE' : 'NOT_RUN',
      manufacturingReleaseReady: false,
    },
    primaryAction: availableActions[0] ?? null,
    secondaryActions: availableActions.slice(1),
  };
}

