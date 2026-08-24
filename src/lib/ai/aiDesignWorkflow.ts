/**
 * The product-level AI design workflow.  This is deliberately UI agnostic: a
 * desktop canvas, a mobile sheet, and a headless worker all consume the same
 * guarded state transitions.
 */

export const AI_DESIGN_WORKFLOW_SCHEMA = 'nexyfab.ai-design-workflow.v1' as const;

export type AiDesignWorkflowStatus =
  | 'EMPTY'
  | 'UNDERSTANDING'
  | 'NEEDS_INPUT'
  | 'READY_TO_GENERATE'
  | 'GENERATING'
  | 'CANDIDATE_REVIEW'
  | 'PARAMETRIC_EDIT'
  | 'PRECISION_PENDING'
  | 'PRECISION_VERIFYING'
  | 'VERIFIED'
  | 'STALE'
  | 'BLOCKED'
  | 'FAILED'
  | 'CANCELLED';

export type WorkflowActionId =
  | 'provide-input'
  | 'review-input'
  | 'generate'
  | 'review-candidates'
  | 'edit-parameters'
  | 'request-precision'
  | 'start-verification'
  | 'inspect-verification'
  | 'refresh'
  | 'retry'
  | 'resume'
  | 'restart'
  | 'resolve-blocker'
  | 'cancel';

export interface WorkflowAction {
  readonly id: WorkflowActionId;
  readonly label: string;
  readonly enabled: boolean;
  readonly reason?: string;
}

export interface WorkflowCheckpoint {
  readonly id: string;
  /** Design-document revision represented by this checkpoint. */
  readonly revision: number;
  readonly digest?: string;
}

export type WorkflowEvidenceKind =
  | 'input'
  | 'understanding'
  | 'candidate'
  | 'precision-verification'
  | 'verification';

export interface WorkflowEvidence {
  readonly id: string;
  readonly kind: WorkflowEvidenceKind;
  readonly checkpointId: string;
  readonly revision: number;
  readonly status: 'PASS' | 'FAIL' | 'NOT_RUN';
  /** Immutable content digest supplied by the producing worker. */
  readonly digest?: string;
  /** Stable producer/source identity (worker receipt, not a UI-generated label). */
  readonly source?: string;
}

export interface AiDesignWorkflowState {
  readonly schema: typeof AI_DESIGN_WORKFLOW_SCHEMA;
  readonly status: AiDesignWorkflowStatus;
  /** Current design-document revision, never silently inferred from UI state. */
  readonly revision: number;
  /** Monotonic workflow event sequence, useful for optimistic UI updates. */
  readonly sequence: number;
  readonly checkpoint: WorkflowCheckpoint | null;
  readonly evidence: WorkflowEvidence | null;
  readonly runId: string | null;
  readonly blocker: string | null;
  readonly failure: string | null;
  readonly cancellation: string | null;
  /** Exact stage to restore after cancellation/failure; never guessed by the UI. */
  readonly resumeStatus: Extract<AiDesignWorkflowStatus, 'UNDERSTANDING' | 'NEEDS_INPUT' | 'READY_TO_GENERATE' | 'GENERATING' | 'CANDIDATE_REVIEW' | 'PARAMETRIC_EDIT' | 'PRECISION_PENDING' | 'PRECISION_VERIFYING'> | null;
  readonly currentAction: WorkflowActionId | null;
  readonly nextActions: readonly WorkflowAction[];
}

export type WorkflowEvent =
  | { readonly type: 'RECEIVE_INPUT'; readonly checkpoint: WorkflowCheckpoint }
  | { readonly type: 'UNDERSTANDING_COMPLETE'; readonly missingInput: boolean; readonly evidence: WorkflowEvidence }
  | { readonly type: 'INPUT_RESOLVED'; readonly checkpoint?: WorkflowCheckpoint }
  | { readonly type: 'START_GENERATION'; readonly runId: string }
  | { readonly type: 'CANDIDATES_READY'; readonly evidence: WorkflowEvidence }
  | { readonly type: 'BEGIN_PARAMETRIC_EDIT' }
  | { readonly type: 'REQUEST_PRECISION' }
  | { readonly type: 'START_PRECISION_VERIFICATION'; readonly runId: string }
  | { readonly type: 'VERIFICATION_COMPLETE'; readonly evidence: WorkflowEvidence }
  | { readonly type: 'MARK_STALE'; readonly revision: number }
  | { readonly type: 'BLOCK'; readonly reason: string }
  | { readonly type: 'FAIL'; readonly reason: string }
  | { readonly type: 'CANCEL'; readonly reason?: string }
  | { readonly type: 'RESUME'; readonly runId?: string }
  | { readonly type: 'RESTART'; readonly checkpoint?: WorkflowCheckpoint };

export type WorkflowTransitionResult =
  | { readonly ok: true; readonly state: AiDesignWorkflowState }
  | { readonly ok: false; readonly state: AiDesignWorkflowState; readonly error: string };

const ACTION_LABELS: Record<WorkflowActionId, string> = {
  'provide-input': 'Provide missing input',
  'review-input': 'Review AI understanding',
  generate: 'Generate candidates',
  'review-candidates': 'Review candidates',
  'edit-parameters': 'Edit parameters',
  'request-precision': 'Request precision CAD',
  'start-verification': 'Start precision verification',
  'inspect-verification': 'Inspect verification evidence',
  refresh: 'Refresh from latest revision',
  retry: 'Retry',
  resume: 'Resume',
  restart: 'Restart design',
  'resolve-blocker': 'Resolve blocker',
  cancel: 'Cancel',
};

const action = (id: WorkflowActionId, enabled = true, reason?: string): WorkflowAction => ({
  id,
  label: ACTION_LABELS[id],
  enabled,
  ...(reason ? { reason } : {}),
});

function actionsFor(status: AiDesignWorkflowStatus, checkpoint: WorkflowCheckpoint | null): readonly WorkflowAction[] {
  switch (status) {
    case 'EMPTY': return [action('provide-input')];
    case 'UNDERSTANDING': return [action('review-input', false, 'Understanding is in progress'), action('cancel')];
    case 'NEEDS_INPUT': return [action('provide-input'), action('review-input')];
    case 'READY_TO_GENERATE': return [action('generate', checkpoint !== null, checkpoint ? undefined : 'A checkpoint is required'), action('review-input')];
    case 'GENERATING': return [action('cancel')];
    case 'CANDIDATE_REVIEW': return [action('review-candidates'), action('edit-parameters'), action('request-precision')];
    case 'PARAMETRIC_EDIT': return [action('edit-parameters'), action('request-precision'), action('cancel')];
    case 'PRECISION_PENDING': return [action('start-verification', checkpoint !== null, checkpoint ? undefined : 'A checkpoint is required'), action('cancel')];
    case 'PRECISION_VERIFYING': return [action('cancel')];
    case 'VERIFIED': return [action('inspect-verification'), action('edit-parameters'), action('restart')];
    case 'STALE': return [action('refresh'), action('restart')];
    case 'BLOCKED': return [action('resolve-blocker'), action('retry', false, 'Resolve the blocker before retrying'), action('restart')];
    case 'FAILED': return [action('retry'), action('restart')];
    case 'CANCELLED': return [action('resume', checkpoint !== null, checkpoint ? undefined : 'No resumable checkpoint'), action('restart')];
  }
}

function currentActionFor(status: AiDesignWorkflowStatus): WorkflowActionId | null {
  switch (status) {
    case 'UNDERSTANDING': return 'review-input';
    case 'NEEDS_INPUT': return 'provide-input';
    case 'READY_TO_GENERATE': return 'generate';
    case 'GENERATING': return 'review-candidates';
    case 'CANDIDATE_REVIEW': return 'review-candidates';
    case 'PARAMETRIC_EDIT': return 'edit-parameters';
    case 'PRECISION_PENDING': return 'start-verification';
    case 'PRECISION_VERIFYING': return 'inspect-verification';
    case 'STALE': return 'refresh';
    case 'BLOCKED': return 'resolve-blocker';
    case 'FAILED': return 'retry';
    case 'CANCELLED': return 'resume';
    default: return null;
  }
}

export function createAiDesignWorkflowState(options: { revision?: number; checkpoint?: WorkflowCheckpoint | null } = {}): AiDesignWorkflowState {
  const revision = Number.isInteger(options.revision) && (options.revision ?? 0) >= 0 ? options.revision ?? 0 : 0;
  const checkpoint = options.checkpoint ?? null;
  if (checkpoint && checkpoint.revision !== revision) throw new Error('checkpoint_revision_mismatch');
  return makeState({ status: 'EMPTY', revision, sequence: 0, checkpoint, evidence: null, runId: null, blocker: null, failure: null, cancellation: null, resumeStatus: null });
}

function makeState(input: Omit<AiDesignWorkflowState, 'schema' | 'currentAction' | 'nextActions'>): AiDesignWorkflowState {
  const currentAction = currentActionFor(input.status);
  const nextActions = actionsFor(input.status, input.checkpoint);
  return { ...input, schema: AI_DESIGN_WORKFLOW_SCHEMA, currentAction, nextActions };
}

function invalid(state: AiDesignWorkflowState, error: string): WorkflowTransitionResult { return { ok: false, state, error }; }

function validEvidence(state: AiDesignWorkflowState, evidence: WorkflowEvidence, kinds: readonly WorkflowEvidenceKind[]): string | null {
  if (!evidence.id.trim()) return 'evidence_id_required';
  if (!kinds.includes(evidence.kind)) return 'evidence_kind_not_allowed';
  if (evidence.status !== 'PASS') return 'evidence_not_pass';
  if (!evidence.source?.trim()) return 'evidence_source_required';
  if (!state.checkpoint) return 'checkpoint_required';
  if (evidence.checkpointId !== state.checkpoint.id) return 'evidence_checkpoint_mismatch';
  if (evidence.revision !== state.revision || evidence.revision !== state.checkpoint.revision) return 'evidence_revision_mismatch';
  if (state.checkpoint.digest && !evidence.digest) return 'evidence_digest_required';
  if (state.checkpoint.digest && state.checkpoint.digest !== evidence.digest) return 'evidence_digest_mismatch';
  return null;
}

function resumable(status: AiDesignWorkflowStatus): AiDesignWorkflowState['resumeStatus'] {
  return status === 'UNDERSTANDING' || status === 'NEEDS_INPUT' || status === 'READY_TO_GENERATE' || status === 'GENERATING' || status === 'CANDIDATE_REVIEW' || status === 'PARAMETRIC_EDIT' || status === 'PRECISION_PENDING' || status === 'PRECISION_VERIFYING' ? status : null;
}

function next(state: AiDesignWorkflowState, patch: Partial<Omit<AiDesignWorkflowState, 'schema' | 'sequence' | 'currentAction' | 'nextActions'>>): AiDesignWorkflowState {
  return makeState({ ...state, ...patch, sequence: state.sequence + 1 });
}

/** Pure, guarded transition. Every successful state change is bound to its checkpoint. */
export function transitionAiDesignWorkflow(state: AiDesignWorkflowState, event: WorkflowEvent): WorkflowTransitionResult {
  switch (event.type) {
    case 'RECEIVE_INPUT':
      if (state.status !== 'EMPTY' && state.status !== 'STALE') return invalid(state, 'input_not_allowed_in_current_state');
      if (event.checkpoint.revision !== state.revision) return invalid(state, 'checkpoint_revision_mismatch');
      return { ok: true, state: next(state, { status: 'UNDERSTANDING', checkpoint: event.checkpoint, evidence: null, blocker: null, failure: null, cancellation: null, resumeStatus: null }) };
    case 'UNDERSTANDING_COMPLETE': {
      if (state.status !== 'UNDERSTANDING') return invalid(state, 'understanding_not_in_progress');
      const evidenceError = validEvidence(state, event.evidence, ['understanding']);
      if (evidenceError) return invalid(state, evidenceError);
      return { ok: true, state: next(state, { status: event.missingInput ? 'NEEDS_INPUT' : 'READY_TO_GENERATE', evidence: event.evidence }) };
    }
    case 'INPUT_RESOLVED': {
      if (state.status !== 'NEEDS_INPUT') return invalid(state, 'input_is_not_needed');
      const checkpoint = event.checkpoint ?? state.checkpoint;
      if (!checkpoint) return invalid(state, 'checkpoint_required');
      if (checkpoint.revision !== state.revision) return invalid(state, 'checkpoint_revision_mismatch');
      return { ok: true, state: next(state, { status: 'READY_TO_GENERATE', checkpoint, evidence: null }) };
    }
    case 'START_GENERATION':
      if (state.status !== 'READY_TO_GENERATE' || !state.checkpoint) return invalid(state, 'generation_not_ready');
      if (!event.runId.trim()) return invalid(state, 'run_id_required');
      return { ok: true, state: next(state, { status: 'GENERATING', runId: event.runId, evidence: null, resumeStatus: null }) };
    case 'CANDIDATES_READY': {
      if (state.status !== 'GENERATING') return invalid(state, 'generation_not_in_progress');
      const evidenceError = validEvidence(state, event.evidence, ['candidate']);
      if (evidenceError) return invalid(state, evidenceError);
      return { ok: true, state: next(state, { status: 'CANDIDATE_REVIEW', evidence: event.evidence }) };
    }
    case 'BEGIN_PARAMETRIC_EDIT':
      if (state.status !== 'CANDIDATE_REVIEW' && state.status !== 'VERIFIED') return invalid(state, 'parametric_edit_not_allowed');
      return { ok: true, state: next(state, { status: 'PARAMETRIC_EDIT', evidence: null }) };
    case 'REQUEST_PRECISION':
      if (state.status !== 'CANDIDATE_REVIEW' && state.status !== 'PARAMETRIC_EDIT') return invalid(state, 'precision_request_not_allowed');
      if (!state.checkpoint) return invalid(state, 'checkpoint_required');
      return { ok: true, state: next(state, { status: 'PRECISION_PENDING', evidence: null }) };
    case 'START_PRECISION_VERIFICATION':
      if (state.status !== 'PRECISION_PENDING' || !state.checkpoint) return invalid(state, 'precision_verification_not_ready');
      if (!event.runId.trim()) return invalid(state, 'run_id_required');
      return { ok: true, state: next(state, { status: 'PRECISION_VERIFYING', runId: event.runId, evidence: null, resumeStatus: null }) };
    case 'VERIFICATION_COMPLETE': {
      if (state.status !== 'PRECISION_VERIFYING' || !state.checkpoint) return invalid(state, 'precision_verification_not_in_progress');
      if (event.evidence.status !== 'PASS') return invalid(state, 'verification_not_pass');
      if (!event.evidence.digest || !event.evidence.source) return invalid(state, 'verification_evidence_incomplete');
      const evidenceError = validEvidence(state, event.evidence, ['verification', 'precision-verification']);
      if (evidenceError) return invalid(state, evidenceError);
      if (!state.checkpoint.digest || event.evidence.digest !== state.checkpoint.digest) return invalid(state, 'verification_digest_unbound');
      return { ok: true, state: next(state, { status: 'VERIFIED', evidence: event.evidence, failure: null, blocker: null, resumeStatus: null }) };
    }
    case 'MARK_STALE':
      if (event.revision <= state.revision) return invalid(state, 'stale_revision_must_increase');
      return { ok: true, state: next(state, { status: 'STALE', revision: event.revision, checkpoint: null, evidence: null, blocker: null, failure: null }) };
    case 'BLOCK':
      if (!event.reason.trim()) return invalid(state, 'blocker_reason_required');
      return { ok: true, state: next(state, { status: 'BLOCKED', blocker: event.reason, evidence: null }) };
    case 'FAIL':
      if (!event.reason.trim()) return invalid(state, 'failure_reason_required');
      return { ok: true, state: next(state, { status: 'FAILED', failure: event.reason, evidence: null, resumeStatus: resumable(state.status) }) };
    case 'CANCEL':
      if (state.status === 'EMPTY' || state.status === 'VERIFIED' || state.status === 'STALE') return invalid(state, 'cancel_not_allowed');
      return { ok: true, state: next(state, { status: 'CANCELLED', cancellation: event.reason?.trim() || 'user_cancelled', resumeStatus: resumable(state.status) }) };
    case 'RESUME':
      if (state.status !== 'CANCELLED' && state.status !== 'FAILED') return invalid(state, 'resume_not_allowed');
      if (!state.checkpoint) return invalid(state, 'checkpoint_required');
      if (!state.resumeStatus) return invalid(state, 'resume_stage_missing');
      return { ok: true, state: next(state, { status: state.resumeStatus, runId: event.runId ?? state.runId, cancellation: null, failure: null, resumeStatus: null }) };
    case 'RESTART':
      if (event.checkpoint && event.checkpoint.revision !== state.revision) return invalid(state, 'checkpoint_revision_mismatch');
      return { ok: true, state: next(state, { status: event.checkpoint ? 'UNDERSTANDING' : 'EMPTY', checkpoint: event.checkpoint ?? null, evidence: null, runId: null, blocker: null, failure: null, cancellation: null, resumeStatus: null }) };
  }
}

export function assertAiDesignWorkflowState(state: AiDesignWorkflowState): void {
  if (state.schema !== AI_DESIGN_WORKFLOW_SCHEMA) throw new Error('invalid_ai_design_workflow_schema');
  if (!Number.isInteger(state.revision) || state.revision < 0) throw new Error('invalid_workflow_revision');
  if (!Number.isInteger(state.sequence) || state.sequence < 0) throw new Error('invalid_workflow_sequence');
  if (state.checkpoint && state.checkpoint.revision !== state.revision) throw new Error('checkpoint_revision_mismatch');
  if (state.status === 'VERIFIED' && !state.evidence) throw new Error('verified_requires_evidence');
  if (state.status === 'VERIFIED' && (state.evidence?.status !== 'PASS' || !state.evidence.digest || !state.evidence.source)) throw new Error('verified_requires_passing_evidence');
  if (state.evidence && (!state.checkpoint || state.evidence.checkpointId !== state.checkpoint.id || state.evidence.revision !== state.revision)) throw new Error('evidence_not_bound');
}

export function canTransitionAiDesignWorkflow(state: AiDesignWorkflowState, event: WorkflowEvent): boolean {
  return transitionAiDesignWorkflow(state, event).ok;
}
