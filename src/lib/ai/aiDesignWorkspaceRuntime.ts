import { createAiDesignInteractionState, type AiDesignInteractionState } from './aiDesignInteractionContract';
import { adaptAiDesignInput, composeAiDesignCheckpoints, type AiDesignInputEvent } from './aiDesignInputAdapter';
import {
  adjustGaugeByStep,
  createGaugeUxViewModel,
  type GaugeStepMode,
  type GaugeUxOptions,
  type GaugeUxViewModel,
} from './aiDesignComparisonGaugeUx';
import {
  createDesignCandidateComparison,
  type CandidateComparisonViewModel,
  type DesignCandidate,
} from './designCandidateComparison';
import { validateDesignIntentCheckpoint, type DesignIntentCheckpointV1 } from './designIntentCheckpoint';
import type { GaugeViewModelV1 } from './gaugeViewModel';
import {
  beginAiDesignGeneration,
  assertAiDesignGenerationOrchestrator,
  cancelAiDesignGeneration,
  completeAiDesignGenerationStage,
  createAiDesignGenerationOrchestrator,
  failAiDesignGenerationStage,
  fallbackAiDesignGenerationModel,
  resumeAiDesignGeneration,
  retryAiDesignGeneration,
  type AiDesignGenerationOrchestratorV1,
  type AiDesignGenerationStage,
} from './aiDesignGenerationOrchestrator';
import {
  createAiDesignWorkflowState,
  assertAiDesignWorkflowState,
  transitionAiDesignWorkflow,
  type AiDesignWorkflowState,
  type WorkflowEvidence,
} from './aiDesignWorkflow';
import {
  AiDesignWorkspaceSessionV1,
  validateAiDesignWorkspaceSessionSnapshot,
  type WorkspaceSessionSnapshot,
} from './aiDesignWorkspaceSession';
import { createAiDesignWorkspaceViewModel, type AiDesignWorkspaceViewModel } from './aiDesignWorkspaceViewModel';
import type { ModelSelectionRequest } from './modelSelectionPolicy';

export const AI_DESIGN_WORKSPACE_RUNTIME_SCHEMA = 'nexyfab.ai-design-workspace-runtime.v1' as const;

export interface AiDesignWorkspaceRuntimeV1 {
  schema: typeof AI_DESIGN_WORKSPACE_RUNTIME_SCHEMA;
  projectId: string;
  documentRevision: number;
  revisionToken: string;
  runtimeRevision: number;
  checkpoint: DesignIntentCheckpointV1;
  workflow: AiDesignWorkflowState;
  generation: AiDesignGenerationOrchestratorV1 | null;
  modelSelectionRequest: ModelSelectionRequest | null;
  candidates: CandidateComparisonViewModel | null;
  gauges: readonly GaugeUxViewModel[];
  selectedCandidateId: string | null;
  session: WorkspaceSessionSnapshot;
  updatedAt: string;
}

export type AiDesignWorkspaceRuntimeAction =
  | { type: 'UNDERSTANDING_CONFIRMED'; actionId: string; expectedRevision: number; evidence: WorkflowEvidence; missingInput: boolean; timestamp?: string }
  | { type: 'INGEST_INPUTS'; actionId: string; expectedRevision: number; inputs: readonly AiDesignInputEvent[]; timestamp?: string }
  | { type: 'START_GENERATION'; actionId: string; expectedRevision: number; runId: string; modelSelection: ModelSelectionRequest; timestamp?: string }
  | { type: 'COMPLETE_GENERATION_STAGE'; actionId: string; expectedRevision: number; stage: AiDesignGenerationStage; outputDigest: string; source: string; codes?: readonly string[]; timestamp?: string }
  | { type: 'FAIL_GENERATION_STAGE'; actionId: string; expectedRevision: number; stage: AiDesignGenerationStage; reason: string; retryable: boolean; codes?: readonly string[]; timestamp?: string }
  | { type: 'FALLBACK_MODEL'; actionId: string; expectedRevision: number; reason: string; timestamp?: string }
  | { type: 'RETRY_GENERATION'; actionId: string; expectedRevision: number; timestamp?: string }
  | { type: 'PUBLISH_CANDIDATES'; actionId: string; expectedRevision: number; candidates: readonly DesignCandidate[]; evidence: WorkflowEvidence; timestamp?: string }
  | { type: 'SELECT_CANDIDATE'; actionId: string; expectedRevision: number; candidateId: string; timestamp?: string }
  | { type: 'BEGIN_PARAMETRIC_EDIT'; actionId: string; expectedRevision: number; timestamp?: string }
  | { type: 'ATTACH_GAUGES'; actionId: string; expectedRevision: number; gauges: readonly GaugeViewModelV1[]; options?: Readonly<Record<string, GaugeUxOptions>>; timestamp?: string }
  | { type: 'ADJUST_GAUGE'; actionId: string; expectedRevision: number; gaugeId: string; mode: GaugeStepMode; direction: 1 | -1; timestamp?: string }
  | { type: 'REQUEST_PRECISION'; actionId: string; expectedRevision: number; timestamp?: string }
  | { type: 'CANCEL'; actionId: string; expectedRevision: number; reason?: string; timestamp?: string }
  | { type: 'RESUME'; actionId: string; expectedRevision: number; timestamp?: string };

export type AiDesignWorkspaceRuntimeResult =
  | { ok: true; state: AiDesignWorkspaceRuntimeV1; replayed?: boolean }
  | { ok: false; state: AiDesignWorkspaceRuntimeV1; error: string; issues?: readonly string[] };

export type CreateAiDesignWorkspaceRuntimeResult =
  | { ok: true; state: AiDesignWorkspaceRuntimeV1 }
  | { ok: false; issues: readonly string[] };

function failed(state: AiDesignWorkspaceRuntimeV1, error: string, issues?: readonly string[]): AiDesignWorkspaceRuntimeResult {
  return { ok: false, state, error, ...(issues ? { issues } : {}) };
}

function workflowTransition(state: AiDesignWorkflowState, event: Parameters<typeof transitionAiDesignWorkflow>[1]): AiDesignWorkflowState | string {
  const result = transitionAiDesignWorkflow(state, event);
  return result.ok ? result.state : result.error;
}

function sessionSummary(
  state: AiDesignWorkspaceRuntimeV1,
  action: AiDesignWorkspaceRuntimeAction,
  nextWorkflow: AiDesignWorkflowState,
  generation: AiDesignGenerationOrchestratorV1 | null,
): Record<string, string | number | null> {
  return {
    lastAction: action.type,
    workflowStatus: nextWorkflow.status,
    workflowSequence: nextWorkflow.sequence,
    generationStatus: generation?.status ?? null,
    generationRevision: generation?.revision ?? null,
    selectedCandidateId: action.type === 'SELECT_CANDIDATE' ? action.candidateId : state.selectedCandidateId,
  };
}

function reversible(action: AiDesignWorkspaceRuntimeAction): boolean {
  return action.type === 'SELECT_CANDIDATE' || action.type === 'ATTACH_GAUGES' || action.type === 'ADJUST_GAUGE';
}

function commit(
  state: AiDesignWorkspaceRuntimeV1,
  action: AiDesignWorkspaceRuntimeAction,
  patch: Partial<Omit<AiDesignWorkspaceRuntimeV1, 'schema' | 'projectId' | 'documentRevision' | 'revisionToken' | 'runtimeRevision' | 'session' | 'updatedAt'>>,
): AiDesignWorkspaceRuntimeResult {
  const timestamp = action.timestamp ?? new Date().toISOString();
  const workflow = patch.workflow ?? state.workflow;
  const generation = patch.generation === undefined ? state.generation : patch.generation;
  const restored = AiDesignWorkspaceSessionV1.fromSnapshot(state.session);
  const sessionResult = restored.apply({
    eventId: action.actionId,
    type: action.type,
    owner: reversible(action) ? 'ai' : 'user',
    reversible: reversible(action),
    target: action.type === 'REQUEST_PRECISION' ? 'session' : 'view',
    timestamp,
    bindingUpdate: {
      checkpointId: (patch.checkpoint ?? state.checkpoint).checkpointId,
      checkpointRevision: (patch.checkpoint ?? state.checkpoint).revision,
      workflowId: 'ai-design-workflow-v1',
      workflowRevision: workflow.sequence,
    },
    payload: sessionSummary(state, action, workflow, generation),
  }, restored.revision);
  if (!sessionResult.ok) return failed(state, `session_${sessionResult.error}`);
  return {
    ok: true,
    state: {
      ...state,
      ...patch,
      runtimeRevision: state.runtimeRevision + 1,
      session: sessionResult.session.exportSnapshot(),
      updatedAt: timestamp,
    },
  };
}

function actionAlreadyApplied(state: AiDesignWorkspaceRuntimeV1, actionId: string): boolean {
  return state.session.eventIds.includes(actionId);
}

export function createAiDesignWorkspaceRuntime(input: {
  projectId: string;
  revisionToken: string;
  sessionId: string;
  inputs: readonly AiDesignInputEvent[];
  now?: string;
}): CreateAiDesignWorkspaceRuntimeResult {
  if (!input.inputs.length) return { ok: false, issues: ['input_required'] };
  const adapted = input.inputs.map(adaptAiDesignInput);
  const blockers = adapted.flatMap(item => item.blockers);
  const checkpoints = adapted.flatMap(item => item.checkpoint ? [item.checkpoint] : []);
  if (blockers.length || checkpoints.length !== input.inputs.length) return { ok: false, issues: [...new Set(blockers.length ? blockers : ['input_adapter_failed'])] };
  const checkpoint = composeAiDesignCheckpoints(...checkpoints);
  if (checkpoint.projectId !== input.projectId) return { ok: false, issues: ['runtime_project_binding_mismatch'] };
  // A structurally valid, rights-cleared checkpoint may still contain missing
  // values or explicit conflicts. Keep it in UNDERSTANDING so the server can
  // move to NEEDS_INPUT and the question planner can resolve it. Malformed or
  // provenance-blocked sources were already rejected by the adapters above.
  const initial = createAiDesignWorkflowState({ revision: checkpoint.revision });
  const received = workflowTransition(initial, { type: 'RECEIVE_INPUT', checkpoint: { id: checkpoint.checkpointId, revision: checkpoint.revision, digest: checkpoint.projectContentHash } });
  if (typeof received === 'string') return { ok: false, issues: [received] };
  const now = input.now ?? new Date().toISOString();
  const session = AiDesignWorkspaceSessionV1.create({
    projectId: input.projectId,
    sessionId: input.sessionId,
    checkpointId: checkpoint.checkpointId,
    checkpointRevision: checkpoint.revision,
    workflowId: 'ai-design-workflow-v1',
    workflowRevision: received.sequence,
    data: { workflowStatus: received.status },
  });
  return {
    ok: true,
    state: {
      schema: AI_DESIGN_WORKSPACE_RUNTIME_SCHEMA,
      projectId: input.projectId,
      documentRevision: checkpoint.revision,
      revisionToken: input.revisionToken,
      runtimeRevision: 0,
      checkpoint,
      workflow: received,
      generation: null,
      modelSelectionRequest: null,
      candidates: null,
      gauges: [],
      selectedCandidateId: null,
      session: session.exportSnapshot(),
      updatedAt: now,
    },
  };
}

export function dispatchAiDesignWorkspaceAction(
  state: AiDesignWorkspaceRuntimeV1,
  action: AiDesignWorkspaceRuntimeAction,
): AiDesignWorkspaceRuntimeResult {
  if (actionAlreadyApplied(state, action.actionId)) return { ok: true, state, replayed: true };
  if (action.expectedRevision !== state.runtimeRevision) return failed(state, 'runtime_revision_conflict');
  const timestamp = action.timestamp ?? new Date().toISOString();
  switch (action.type) {
    case 'UNDERSTANDING_CONFIRMED': {
      const workflow = workflowTransition(state.workflow, { type: 'UNDERSTANDING_COMPLETE', missingInput: action.missingInput, evidence: action.evidence });
      return typeof workflow === 'string' ? failed(state, workflow) : commit(state, action, { workflow });
    }
    case 'INGEST_INPUTS': {
      if (state.workflow.status !== 'NEEDS_INPUT') return failed(state, 'input_is_not_needed');
      const adapted = action.inputs.map(adaptAiDesignInput);
      const blockers = adapted.flatMap(item => item.blockers);
      if (blockers.length || adapted.some(item => !item.checkpoint)) return failed(state, 'input_adapter_failed', [...new Set(blockers)]);
      const checkpoint = composeAiDesignCheckpoints(state.checkpoint, ...adapted.map(item => item.checkpoint!));
      if (!checkpoint.readiness.ready) return failed(state, 'input_not_ready', checkpoint.readiness.blockers);
      const workflow = workflowTransition(state.workflow, { type: 'INPUT_RESOLVED', checkpoint: { id: checkpoint.checkpointId, revision: checkpoint.revision, digest: checkpoint.projectContentHash } });
      return typeof workflow === 'string' ? failed(state, workflow) : commit(state, action, { checkpoint, workflow });
    }
    case 'START_GENERATION': {
      const created = createAiDesignGenerationOrchestrator({ runId: action.runId, checkpoint: state.checkpoint, modelSelection: action.modelSelection, now: timestamp });
      if (created.status === 'BLOCKED') return failed(state, created.failure ?? 'generation_blocked');
      const begun = beginAiDesignGeneration(created, created.revision, timestamp);
      if (!begun.ok) return failed(state, begun.error);
      const workflow = workflowTransition(state.workflow, { type: 'START_GENERATION', runId: action.runId });
      return typeof workflow === 'string' ? failed(state, workflow) : commit(state, action, { workflow, generation: begun.state, modelSelectionRequest: action.modelSelection });
    }
    case 'COMPLETE_GENERATION_STAGE': {
      if (!state.generation) return failed(state, 'generation_missing');
      const result = completeAiDesignGenerationStage(state.generation, { expectedRevision: state.generation.revision, stage: action.stage, outputDigest: action.outputDigest, source: action.source, codes: action.codes, now: timestamp });
      return result.ok ? commit(state, action, { generation: result.state }) : failed(state, result.error);
    }
    case 'FAIL_GENERATION_STAGE': {
      if (!state.generation) return failed(state, 'generation_missing');
      const result = failAiDesignGenerationStage(state.generation, { expectedRevision: state.generation.revision, stage: action.stage, reason: action.reason, retryable: action.retryable, codes: action.codes, now: timestamp });
      if (!result.ok) return failed(state, result.error);
      if (result.state.status !== 'FAILED') return commit(state, action, { generation: result.state });
      const workflow = workflowTransition(state.workflow, { type: 'FAIL', reason: action.reason });
      return typeof workflow === 'string' ? failed(state, workflow) : commit(state, action, { generation: result.state, workflow });
    }
    case 'FALLBACK_MODEL': {
      if (!state.generation || !state.modelSelectionRequest) return failed(state, 'generation_or_model_request_missing');
      const result = fallbackAiDesignGenerationModel(state.generation, { expectedRevision: state.generation.revision, request: state.modelSelectionRequest, reason: action.reason, now: timestamp });
      return result.ok ? commit(state, action, { generation: result.state }) : failed(state, result.error);
    }
    case 'RETRY_GENERATION': {
      if (!state.generation) return failed(state, 'generation_missing');
      const result = retryAiDesignGeneration(state.generation, state.generation.revision, timestamp);
      return result.ok ? commit(state, action, { generation: result.state }) : failed(state, result.error);
    }
    case 'PUBLISH_CANDIDATES': {
      if (state.generation?.status !== 'CANDIDATE_READY') return failed(state, 'generation_candidates_not_ready');
      const selectedModel = state.generation.modelReceipt.selectedModelId;
      if (!action.candidates.length || action.candidates.length > 3) return failed(state, 'candidate_count_invalid');
      if (action.candidates.some(candidate => candidate.baseRevision !== state.revisionToken)) return failed(state, 'candidate_revision_mismatch');
      if (action.candidates.some(candidate => candidate.modelId && candidate.modelId !== selectedModel)) return failed(state, 'candidate_model_binding_mismatch');
      const candidates = createDesignCandidateComparison(state.revisionToken, action.candidates);
      const workflow = workflowTransition(state.workflow, { type: 'CANDIDATES_READY', evidence: action.evidence });
      return typeof workflow === 'string' ? failed(state, workflow) : commit(state, action, { workflow, candidates });
    }
    case 'SELECT_CANDIDATE':
      if (!state.candidates?.selectableCandidateIds.includes(action.candidateId)) return failed(state, 'candidate_not_selectable');
      return commit(state, action, { selectedCandidateId: action.candidateId });
    case 'BEGIN_PARAMETRIC_EDIT': {
      const workflow = workflowTransition(state.workflow, { type: 'BEGIN_PARAMETRIC_EDIT' });
      return typeof workflow === 'string' ? failed(state, workflow) : commit(state, action, { workflow });
    }
    case 'ATTACH_GAUGES': {
      if (action.gauges.some(gauge => gauge.baseRevision !== state.revisionToken)) return failed(state, 'gauge_revision_mismatch');
      const gauges = action.gauges.map(gauge => createGaugeUxViewModel(gauge, action.options?.[gauge.gaugeId]));
      return commit(state, action, { gauges });
    }
    case 'ADJUST_GAUGE': {
      const index = state.gauges.findIndex(gauge => gauge.gaugeId === action.gaugeId);
      if (index < 0) return failed(state, 'gauge_not_found');
      const adjusted = adjustGaugeByStep(state.gauges[index]!, action.mode, action.direction);
      if (!adjusted.ok) return failed(state, 'gauge_adjustment_blocked', adjusted.issues);
      const gauges = state.gauges.map((gauge, gaugeIndex) => gaugeIndex === index ? adjusted.gauge : gauge);
      return commit(state, action, { gauges });
    }
    case 'REQUEST_PRECISION': {
      const workflow = workflowTransition(state.workflow, { type: 'REQUEST_PRECISION' });
      return typeof workflow === 'string' ? failed(state, workflow) : commit(state, action, { workflow });
    }
    case 'CANCEL': {
      const workflow = workflowTransition(state.workflow, { type: 'CANCEL', reason: action.reason });
      if (typeof workflow === 'string') return failed(state, workflow);
      let generation = state.generation;
      if (generation && (generation.status === 'RUNNING' || generation.status === 'RETRY_WAIT')) {
        const cancelled = cancelAiDesignGeneration(generation, { expectedRevision: generation.revision, reason: action.reason, now: timestamp });
        if (!cancelled.ok) return failed(state, cancelled.error);
        generation = cancelled.state;
      }
      return commit(state, action, { workflow, generation });
    }
    case 'RESUME': {
      const workflow = workflowTransition(state.workflow, { type: 'RESUME', runId: state.generation?.runId });
      if (typeof workflow === 'string') return failed(state, workflow);
      let generation = state.generation;
      if (generation?.status === 'CANCELLED') {
        const resumed = resumeAiDesignGeneration(generation, generation.revision, timestamp);
        if (!resumed.ok) return failed(state, resumed.error);
        generation = resumed.state;
      }
      return commit(state, action, { workflow, generation });
    }
  }
}

export function runtimeToAiDesignWorkspaceViewModel(
  state: AiDesignWorkspaceRuntimeV1,
  interaction: AiDesignInteractionState = createAiDesignInteractionState(),
): AiDesignWorkspaceViewModel {
  return createAiDesignWorkspaceViewModel({
    projectId: state.projectId,
    revision: state.documentRevision,
    revisionToken: state.revisionToken,
    checkpoint: state.checkpoint,
    workflow: state.workflow,
    interaction,
    modelSelection: state.generation?.modelReceipt ?? null,
    candidates: state.candidates,
    gauges: state.gauges,
  });
}

export function assertAiDesignWorkspaceRuntime(state: AiDesignWorkspaceRuntimeV1): void {
  if (state.schema !== AI_DESIGN_WORKSPACE_RUNTIME_SCHEMA) throw new Error('invalid_workspace_runtime_schema');
  if (!state.projectId.trim() || state.projectId !== state.checkpoint.projectId) throw new Error('runtime_project_binding_mismatch');
  if (!Number.isSafeInteger(state.documentRevision) || state.documentRevision < 0 || state.documentRevision !== state.checkpoint.revision) throw new Error('runtime_document_revision_mismatch');
  if (!Number.isSafeInteger(state.runtimeRevision) || state.runtimeRevision < 0 || !state.revisionToken.trim()) throw new Error('invalid_runtime_revision');
  const checkpointIssues = validateDesignIntentCheckpoint(state.checkpoint);
  if (checkpointIssues.length) throw new Error(`invalid_runtime_checkpoint:${checkpointIssues.join(',')}`);
  assertAiDesignWorkflowState(state.workflow);
  if (state.workflow.revision !== state.documentRevision || state.workflow.checkpoint?.id !== state.checkpoint.checkpointId) throw new Error('runtime_workflow_binding_mismatch');
  if (state.generation) {
    assertAiDesignGenerationOrchestrator(state.generation);
    if (state.generation.projectId !== state.projectId || state.generation.baseRevision !== state.documentRevision
      || state.generation.checkpointId !== state.checkpoint.checkpointId || state.generation.checkpointDigest !== state.checkpoint.projectContentHash) throw new Error('runtime_generation_binding_mismatch');
  }
  if (state.candidates && state.candidates.baseRevision !== state.revisionToken) throw new Error('runtime_candidate_revision_mismatch');
  if (state.gauges.some(gauge => gauge.baseRevision !== state.revisionToken)) throw new Error('runtime_gauge_revision_mismatch');
  if (state.selectedCandidateId && !state.candidates?.selectableCandidateIds.includes(state.selectedCandidateId)) throw new Error('runtime_candidate_selection_invalid');
  const sessionValidation = validateAiDesignWorkspaceSessionSnapshot(state.session);
  if (!sessionValidation.valid) throw new Error(`invalid_runtime_session:${sessionValidation.error}`);
  if (state.session.projectId !== state.projectId || state.session.bindings.checkpointId !== state.checkpoint.checkpointId
    || state.session.bindings.checkpointRevision !== state.checkpoint.revision
    || state.session.bindings.workflowId !== 'ai-design-workflow-v1'
    || state.session.bindings.workflowRevision !== state.workflow.sequence) throw new Error('runtime_session_binding_mismatch');
  if (!Number.isFinite(Date.parse(state.updatedAt))) throw new Error('invalid_runtime_timestamp');
}
