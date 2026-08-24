import { validateDesignIntentCheckpoint, type DesignIntentCheckpointV1 } from './designIntentCheckpoint';
import {
  selectCodegenModel,
  type ModelSelectionReceipt,
  type ModelSelectionRequest,
} from './modelSelectionPolicy';

export const AI_DESIGN_GENERATION_ORCHESTRATOR_SCHEMA = 'nexyfab.ai-design-generation-orchestrator.v1' as const;
export const AI_DESIGN_GENERATION_STAGES = [
  'understanding',
  'planning',
  'candidate_generation',
  'candidate_validation',
] as const;

export type AiDesignGenerationStage = (typeof AI_DESIGN_GENERATION_STAGES)[number];
export type AiDesignGenerationStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'RETRY_WAIT'
  | 'CANDIDATE_READY'
  | 'BLOCKED'
  | 'FAILED'
  | 'CANCELLED';

export interface AiDesignGenerationStageRecord {
  stage: AiDesignGenerationStage;
  status: 'NOT_RUN' | 'RUNNING' | 'PASS' | 'FAIL';
  attempt: number;
  inputDigest: string | null;
  outputDigest: string | null;
  source: string | null;
  codes: readonly string[];
  startedAt: string | null;
  completedAt: string | null;
}

export interface AiDesignGenerationModelChange {
  fromModelId: string;
  toModelId: string;
  reason: string;
  changedAt: string;
}

export interface AiDesignGenerationProgress {
  completedStages: number;
  totalStages: number;
  currentStage: AiDesignGenerationStage | null;
  label: string;
  /** Deliberately null: the UI must not invent a percentage without worker evidence. */
  percent: null;
}

export interface AiDesignGenerationOrchestratorV1 {
  schema: typeof AI_DESIGN_GENERATION_ORCHESTRATOR_SCHEMA;
  runId: string;
  projectId: string;
  baseRevision: number;
  checkpointId: string;
  checkpointDigest: string;
  revision: number;
  status: AiDesignGenerationStatus;
  currentStage: AiDesignGenerationStage | null;
  stages: Readonly<Record<AiDesignGenerationStage, AiDesignGenerationStageRecord>>;
  modelReceipt: ModelSelectionReceipt;
  modelChanges: readonly AiDesignGenerationModelChange[];
  failure: string | null;
  cancellation: string | null;
  resumeStage: AiDesignGenerationStage | null;
  createdAt: string;
  updatedAt: string;
  progress: AiDesignGenerationProgress;
  exactGeometryAuthority: false;
}

export type AiDesignGenerationTransition =
  | { ok: true; state: AiDesignGenerationOrchestratorV1; replayed?: boolean }
  | { ok: false; state: AiDesignGenerationOrchestratorV1; error: string };

export interface AiDesignGenerationWorkerInput {
  runId: string;
  projectId: string;
  baseRevision: number;
  checkpointId: string;
  checkpointDigest: string;
  stage: AiDesignGenerationStage;
  selectedModelId: string;
  attempt: number;
  signal: AbortSignal;
}

export interface AiDesignGenerationWorkerResult {
  outputDigest: string;
  source: string;
  codes?: readonly string[];
}

export type AiDesignGenerationWorker = (
  input: AiDesignGenerationWorkerInput,
) => Promise<AiDesignGenerationWorkerResult>;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_TASK = /^[A-Za-z0-9][A-Za-z0-9._:/ -]{0,127}$/;
const MAX_MODEL_CHANGES = 16;
const MAX_CODES = 32;
const STAGE_LABELS: Record<AiDesignGenerationStage, string> = {
  understanding: 'Understanding confirmed design intent',
  planning: 'Planning an editable design',
  candidate_generation: 'Generating design candidates',
  candidate_validation: 'Checking candidate evidence',
};

function record(stage: AiDesignGenerationStage): AiDesignGenerationStageRecord {
  return {
    stage,
    status: 'NOT_RUN',
    attempt: 0,
    inputDigest: null,
    outputDigest: null,
    source: null,
    codes: [],
    startedAt: null,
    completedAt: null,
  };
}

function progress(
  stages: AiDesignGenerationOrchestratorV1['stages'],
  currentStage: AiDesignGenerationStage | null,
): AiDesignGenerationProgress {
  const completedStages = AI_DESIGN_GENERATION_STAGES.filter(stage => stages[stage].status === 'PASS').length;
  return {
    completedStages,
    totalStages: AI_DESIGN_GENERATION_STAGES.length,
    currentStage,
    label: currentStage ? STAGE_LABELS[currentStage] : completedStages === AI_DESIGN_GENERATION_STAGES.length ? 'Candidates ready for review' : 'Generation paused',
    percent: null,
  };
}

function withRevision(
  state: AiDesignGenerationOrchestratorV1,
  patch: Partial<Omit<AiDesignGenerationOrchestratorV1, 'schema' | 'revision' | 'progress' | 'exactGeometryAuthority'>>,
  updatedAt: string,
): AiDesignGenerationOrchestratorV1 {
  const next = { ...state, ...patch, revision: state.revision + 1, updatedAt };
  return { ...next, progress: progress(next.stages, next.currentStage) };
}

function invalid(state: AiDesignGenerationOrchestratorV1, error: string): AiDesignGenerationTransition {
  return { ok: false, state, error };
}

function requireExpectedRevision(
  state: AiDesignGenerationOrchestratorV1,
  expectedRevision: number,
): string | null {
  return expectedRevision === state.revision ? null : 'generation_revision_conflict';
}

function nextStage(stage: AiDesignGenerationStage): AiDesignGenerationStage | null {
  const index = AI_DESIGN_GENERATION_STAGES.indexOf(stage);
  return AI_DESIGN_GENERATION_STAGES[index + 1] ?? null;
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function startStage(
  stages: AiDesignGenerationOrchestratorV1['stages'],
  stage: AiDesignGenerationStage,
  inputDigest: string,
  now: string,
  incrementAttempt: boolean,
): AiDesignGenerationOrchestratorV1['stages'] {
  const current = stages[stage];
  return {
    ...stages,
    [stage]: {
      ...current,
      status: 'RUNNING',
      attempt: current.attempt + (incrementAttempt ? 1 : 0),
      inputDigest,
      outputDigest: null,
      source: null,
      codes: [],
      startedAt: now,
      completedAt: null,
    },
  };
}

export function createAiDesignGenerationOrchestrator(input: {
  runId: string;
  checkpoint: DesignIntentCheckpointV1;
  modelSelection: ModelSelectionRequest;
  now?: string;
}): AiDesignGenerationOrchestratorV1 {
  const now = input.now ?? new Date().toISOString();
  if (!SAFE_ID.test(input.runId) || !validTimestamp(now)) throw new Error('invalid_generation_identity');
  const checkpointIssues = validateDesignIntentCheckpoint(input.checkpoint);
  const selection = selectCodegenModel(input.modelSelection);
  const taskInvalid = selection.receipt.task !== null && !SAFE_TASK.test(selection.receipt.task);
  const stages = Object.fromEntries(AI_DESIGN_GENERATION_STAGES.map(stage => [stage, record(stage)])) as Record<AiDesignGenerationStage, AiDesignGenerationStageRecord>;
  const blocked = checkpointIssues.length > 0 || !input.checkpoint.readiness.ready || !selection.ok || taskInvalid;
  const failure = checkpointIssues.length
    ? `checkpoint_invalid:${checkpointIssues.join(',')}`
    : !input.checkpoint.readiness.ready
      ? `checkpoint_not_ready:${input.checkpoint.readiness.blockers.join(',')}`
      : taskInvalid
        ? 'generation_task_invalid'
        : !selection.ok
        ? `model_selection_blocked:${selection.receipt.reason ?? 'unknown'}`
        : null;
  const state: AiDesignGenerationOrchestratorV1 = {
    schema: AI_DESIGN_GENERATION_ORCHESTRATOR_SCHEMA,
    runId: input.runId,
    projectId: input.checkpoint.projectId,
    baseRevision: input.checkpoint.revision,
    checkpointId: input.checkpoint.checkpointId,
    checkpointDigest: input.checkpoint.projectContentHash,
    revision: 0,
    status: blocked ? 'BLOCKED' : 'QUEUED',
    currentStage: null,
    stages,
    modelReceipt: selection.receipt,
    modelChanges: [],
    failure,
    cancellation: null,
    resumeStage: null,
    createdAt: now,
    updatedAt: now,
    progress: progress(stages, null),
    exactGeometryAuthority: false,
  };
  assertAiDesignGenerationOrchestrator(state);
  return state;
}

export function beginAiDesignGeneration(
  state: AiDesignGenerationOrchestratorV1,
  expectedRevision: number,
  now = new Date().toISOString(),
): AiDesignGenerationTransition {
  const revisionError = requireExpectedRevision(state, expectedRevision);
  if (revisionError) return invalid(state, revisionError);
  if (state.status !== 'QUEUED') return invalid(state, 'generation_not_queued');
  if (!state.modelReceipt.selectedModelId) return invalid(state, 'generation_model_missing');
  const stage = AI_DESIGN_GENERATION_STAGES[0];
  const stages = startStage(state.stages, stage, state.checkpointDigest, now, true);
  return { ok: true, state: withRevision(state, { status: 'RUNNING', currentStage: stage, stages, failure: null }, now) };
}

export function completeAiDesignGenerationStage(
  state: AiDesignGenerationOrchestratorV1,
  input: { expectedRevision: number; stage: AiDesignGenerationStage; outputDigest: string; source: string; codes?: readonly string[]; now?: string },
): AiDesignGenerationTransition {
  const revisionError = requireExpectedRevision(state, input.expectedRevision);
  if (revisionError) return invalid(state, revisionError);
  if (state.status !== 'RUNNING' || state.currentStage !== input.stage || state.stages[input.stage].status !== 'RUNNING') return invalid(state, 'generation_stage_not_running');
  if (!SHA256.test(input.outputDigest)) return invalid(state, 'generation_output_digest_invalid');
  if (!SAFE_ID.test(input.source)) return invalid(state, 'generation_source_invalid');
  if ((input.codes?.length ?? 0) > MAX_CODES || input.codes?.some(code => !SAFE_CODE.test(code))) return invalid(state, 'generation_codes_invalid');
  const now = input.now ?? new Date().toISOString();
  const completed = {
    ...state.stages,
    [input.stage]: {
      ...state.stages[input.stage],
      status: 'PASS' as const,
      outputDigest: input.outputDigest,
      source: input.source,
      codes: [...new Set(input.codes ?? [])],
      completedAt: now,
    },
  };
  const following = nextStage(input.stage);
  if (!following) {
    return { ok: true, state: withRevision(state, { status: 'CANDIDATE_READY', currentStage: null, stages: completed, failure: null, resumeStage: null }, now) };
  }
  const stages = startStage(completed, following, input.outputDigest, now, true);
  return { ok: true, state: withRevision(state, { currentStage: following, stages, failure: null }, now) };
}

export function failAiDesignGenerationStage(
  state: AiDesignGenerationOrchestratorV1,
  input: { expectedRevision: number; stage: AiDesignGenerationStage; reason: string; retryable: boolean; codes?: readonly string[]; now?: string },
): AiDesignGenerationTransition {
  const revisionError = requireExpectedRevision(state, input.expectedRevision);
  if (revisionError) return invalid(state, revisionError);
  if (state.status !== 'RUNNING' || state.currentStage !== input.stage) return invalid(state, 'generation_stage_not_running');
  if (!input.reason.trim() || input.reason.length > 512) return invalid(state, 'generation_failure_reason_invalid');
  if ((input.codes?.length ?? 0) > MAX_CODES || input.codes?.some(code => !SAFE_CODE.test(code))) return invalid(state, 'generation_codes_invalid');
  const now = input.now ?? new Date().toISOString();
  const stages = {
    ...state.stages,
    [input.stage]: {
      ...state.stages[input.stage],
      status: 'FAIL' as const,
      codes: [...new Set(input.codes ?? [])].slice(0, MAX_CODES),
      completedAt: now,
    },
  };
  return {
    ok: true,
    state: withRevision(state, {
      status: input.retryable ? 'RETRY_WAIT' : 'FAILED',
      stages,
      failure: input.reason,
      resumeStage: input.retryable ? input.stage : null,
    }, now),
  };
}

export function retryAiDesignGeneration(
  state: AiDesignGenerationOrchestratorV1,
  expectedRevision: number,
  now = new Date().toISOString(),
): AiDesignGenerationTransition {
  const revisionError = requireExpectedRevision(state, expectedRevision);
  if (revisionError) return invalid(state, revisionError);
  if (state.status !== 'RETRY_WAIT' || !state.resumeStage) return invalid(state, 'generation_retry_not_available');
  if (state.stages[state.resumeStage].attempt >= 3) return invalid(state, 'generation_retry_limit_reached');
  const priorInput = state.stages[state.resumeStage].inputDigest ?? state.checkpointDigest;
  const stages = startStage(state.stages, state.resumeStage, priorInput, now, true);
  return { ok: true, state: withRevision(state, { status: 'RUNNING', currentStage: state.resumeStage, stages, failure: null }, now) };
}

export function fallbackAiDesignGenerationModel(
  state: AiDesignGenerationOrchestratorV1,
  input: { expectedRevision: number; request: ModelSelectionRequest; reason: string; now?: string },
): AiDesignGenerationTransition {
  const revisionError = requireExpectedRevision(state, input.expectedRevision);
  if (revisionError) return invalid(state, revisionError);
  if (state.status !== 'RETRY_WAIT') return invalid(state, 'model_fallback_not_available');
  if (!input.reason.trim() || input.reason.length > 256) return invalid(state, 'model_fallback_reason_invalid');
  const currentModelId = state.modelReceipt.selectedModelId;
  if (!currentModelId) return invalid(state, 'generation_model_missing');
  const attemptedModelIds = state.modelChanges.flatMap(change => [change.fromModelId, change.toModelId]);
  const excludedModelIds = [...new Set([...(input.request.constraints?.excludedModelIds ?? []), ...attemptedModelIds, currentModelId])];
  const selected = selectCodegenModel({
    ...input.request,
    constraints: { ...input.request.constraints, excludedModelIds },
  });
  if (!selected.ok || !selected.receipt.selectedModelId) return invalid(state, 'no_fallback_model_available');
  const now = input.now ?? new Date().toISOString();
  const change: AiDesignGenerationModelChange = {
    fromModelId: currentModelId,
    toModelId: selected.receipt.selectedModelId,
    reason: input.reason,
    changedAt: now,
  };
  return {
    ok: true,
    state: withRevision(state, {
      modelReceipt: selected.receipt,
      modelChanges: [...state.modelChanges, change].slice(-MAX_MODEL_CHANGES),
    }, now),
  };
}

export function cancelAiDesignGeneration(
  state: AiDesignGenerationOrchestratorV1,
  input: { expectedRevision: number; reason?: string; now?: string },
): AiDesignGenerationTransition {
  const revisionError = requireExpectedRevision(state, input.expectedRevision);
  if (revisionError) return invalid(state, revisionError);
  if ((state.status !== 'RUNNING' && state.status !== 'RETRY_WAIT') || !state.currentStage) return invalid(state, 'generation_cancel_not_available');
  const now = input.now ?? new Date().toISOString();
  return {
    ok: true,
    state: withRevision(state, {
      status: 'CANCELLED',
      cancellation: input.reason?.trim() || 'user_cancelled',
      resumeStage: state.currentStage,
    }, now),
  };
}

export function resumeAiDesignGeneration(
  state: AiDesignGenerationOrchestratorV1,
  expectedRevision: number,
  now = new Date().toISOString(),
): AiDesignGenerationTransition {
  const revisionError = requireExpectedRevision(state, expectedRevision);
  if (revisionError) return invalid(state, revisionError);
  if (state.status !== 'CANCELLED' || !state.resumeStage || state.currentStage !== state.resumeStage) return invalid(state, 'generation_resume_not_available');
  const current = state.stages[state.resumeStage];
  if (current.status === 'FAIL' && current.attempt >= 3) return invalid(state, 'generation_retry_limit_reached');
  const stages = current.status === 'FAIL'
    ? startStage(state.stages, state.resumeStage, current.inputDigest ?? state.checkpointDigest, now, true)
    : state.stages;
  return { ok: true, state: withRevision(state, { status: 'RUNNING', stages, cancellation: null, failure: null, resumeStage: null }, now) };
}

export async function executeCurrentAiDesignGenerationStage(
  state: AiDesignGenerationOrchestratorV1,
  worker: AiDesignGenerationWorker,
  options: { timeoutMs?: number; now?: () => string } = {},
): Promise<AiDesignGenerationTransition> {
  if (state.status !== 'RUNNING' || !state.currentStage || !state.modelReceipt.selectedModelId) return invalid(state, 'generation_stage_not_running');
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 30_000, 1), 120_000);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('generation_stage_timeout'));
      }, timeoutMs);
    });
    const result = await Promise.race([worker({
      runId: state.runId,
      projectId: state.projectId,
      baseRevision: state.baseRevision,
      checkpointId: state.checkpointId,
      checkpointDigest: state.checkpointDigest,
      stage: state.currentStage,
      selectedModelId: state.modelReceipt.selectedModelId,
      attempt: state.stages[state.currentStage].attempt,
      signal: controller.signal,
    }), timeout]);
    return completeAiDesignGenerationStage(state, {
      expectedRevision: state.revision,
      stage: state.currentStage,
      outputDigest: result.outputDigest,
      source: result.source,
      codes: result.codes,
      now: options.now?.(),
    });
  } catch (error) {
    const timeout = error instanceof Error && error.message === 'generation_stage_timeout';
    const reason = timeout ? 'generation_stage_timeout' : 'generation_worker_failed';
    return failAiDesignGenerationStage(state, {
      expectedRevision: state.revision,
      stage: state.currentStage,
      reason,
      retryable: true,
      codes: [timeout ? 'stage_timeout' : 'worker_failed'],
      now: options.now?.(),
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function assertAiDesignGenerationOrchestrator(state: AiDesignGenerationOrchestratorV1): void {
  if (state.schema !== AI_DESIGN_GENERATION_ORCHESTRATOR_SCHEMA) throw new Error('invalid_generation_orchestrator_schema');
  if (!SAFE_ID.test(state.runId) || !SAFE_ID.test(state.projectId) || !SAFE_ID.test(state.checkpointId)) throw new Error('invalid_generation_identity');
  if (!SHA256.test(state.checkpointDigest)) throw new Error('invalid_generation_checkpoint_digest');
  if (!Number.isSafeInteger(state.baseRevision) || state.baseRevision < 0 || !Number.isSafeInteger(state.revision) || state.revision < 0) throw new Error('invalid_generation_revision');
  if (!validTimestamp(state.createdAt) || !validTimestamp(state.updatedAt) || Date.parse(state.updatedAt) < Date.parse(state.createdAt)) throw new Error('invalid_generation_timestamp');
  if (state.exactGeometryAuthority !== false || state.modelReceipt.policy.exactGeometryAuthority !== false) throw new Error('generation_exact_geometry_authority_forbidden');
  if (state.modelChanges.length > MAX_MODEL_CHANGES) throw new Error('generation_model_history_too_large');
  for (const stage of AI_DESIGN_GENERATION_STAGES) {
    const item = state.stages[stage];
    if (!item || item.stage !== stage || item.attempt < 0 || !Number.isSafeInteger(item.attempt)) throw new Error('invalid_generation_stage');
    if (item.inputDigest && !SHA256.test(item.inputDigest)) throw new Error('invalid_generation_stage_input_digest');
    if (item.outputDigest && !SHA256.test(item.outputDigest)) throw new Error('invalid_generation_stage_output_digest');
    if (item.status === 'PASS' && (!item.outputDigest || !item.source || !item.completedAt)) throw new Error('generation_pass_evidence_missing');
    if (item.codes.length > MAX_CODES || item.codes.some(code => !SAFE_CODE.test(code))) throw new Error('generation_codes_invalid');
  }
  if (state.status === 'RUNNING' && (!state.currentStage || state.stages[state.currentStage].status !== 'RUNNING')) throw new Error('generation_running_stage_missing');
  if (state.status === 'CANDIDATE_READY' && AI_DESIGN_GENERATION_STAGES.some(stage => state.stages[stage].status !== 'PASS')) throw new Error('candidate_ready_without_passed_stages');
  const expectedProgress = progress(state.stages, state.currentStage);
  if (JSON.stringify(expectedProgress) !== JSON.stringify(state.progress)) throw new Error('generation_progress_tampered');
}
