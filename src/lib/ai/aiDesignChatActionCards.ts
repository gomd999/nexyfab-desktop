export const AI_DESIGN_CHAT_ACTION_CARD_SCHEMA = 'nexyfab.ai-design-chat-action-card.v1' as const;
export const AI_DESIGN_CHAT_ACTION_EFFECT_SCHEMA = 'nexyfab.ai-design-chat-action-effect.v1' as const;

export type AiDesignChatCardKind =
  | 'guidance'
  | 'clarification'
  | 'candidate'
  | 'comparison'
  | 'change_preview'
  | 'verification'
  | 'recovery';

export type AiDesignChatActionId =
  | 'ADD_INPUT'
  | 'CONFIRM_UNDERSTANDING'
  | 'START_GENERATION'
  | 'CONTINUE_GENERATION'
  | 'ANSWER_CLARIFICATION'
  | 'SELECT_CANDIDATE'
  | 'OPEN_COMPARISON'
  | 'PREVIEW_CHANGE'
  | 'APPLY_CONCEPT_CHANGE'
  | 'REJECT_PREVIEW'
  | 'UNDO_AI_VIEW_CHANGE'
  | 'REDO_AI_VIEW_CHANGE'
  | 'REQUEST_PRECISION'
  | 'INSPECT_VERIFICATION'
  | 'REFRESH_SERVER_STATE'
  | 'RESUME';

export type AiDesignChatActionBoundary = 'local-ui' | 'ai-design-runtime' | 'precision-cad';
export type AiDesignChatActionMutation = 'none' | 'session-only' | 'preview-only' | 'exact-cad-request';

export interface AiDesignChatActionV1 {
  id: AiDesignChatActionId;
  label: string;
  enabled: boolean;
  reason: string | null;
  primary: boolean;
  requiresConfirmation: boolean;
}

export interface AiDesignChatActionCardV1 {
  schema: typeof AI_DESIGN_CHAT_ACTION_CARD_SCHEMA;
  cardId: string;
  projectId: string;
  sessionId: string;
  runtimeRevision: number;
  kind: AiDesignChatCardKind;
  title: string;
  summary: string;
  status: 'ready' | 'attention' | 'blocked' | 'complete';
  references: {
    questionId: string | null;
    candidateId: string | null;
    gaugeId: string | null;
    proposalId: string | null;
    verificationReceiptId: string | null;
  };
  actions: readonly AiDesignChatActionV1[];
  authority: {
    conceptOnly: true;
    previewIsNonPersistent: true;
    exactCadBoundary: 'precision-cad';
    manufacturingReleaseReady: false;
  };
}

export interface AiDesignChatActionEffectV1 {
  schema: typeof AI_DESIGN_CHAT_ACTION_EFFECT_SCHEMA;
  effectId: string;
  cardId: string;
  projectId: string;
  sessionId: string;
  expectedRuntimeRevision: number;
  actionId: AiDesignChatActionId;
  command: string;
  boundary: AiDesignChatActionBoundary;
  mutation: AiDesignChatActionMutation;
  referenceId: string | null;
  explicitCommitRequired: boolean;
  exactGeometryAuthority: false;
  manufacturingReleaseReady: false;
}

export type AiDesignChatActionDispatchResult =
  | { ok: true; effect: AiDesignChatActionEffectV1 }
  | { ok: false; error: string };

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const MAX_TEXT_LENGTH = 2_000;

const ACTION_POLICY: Record<AiDesignChatActionId, {
  command: string;
  boundary: AiDesignChatActionBoundary;
  mutation: AiDesignChatActionMutation;
  explicitCommitRequired: boolean;
  reference: keyof AiDesignChatActionCardV1['references'] | null;
}> = {
  ADD_INPUT: { command: 'OPEN_MULTIMODAL_INPUT', boundary: 'local-ui', mutation: 'none', explicitCommitRequired: false, reference: null },
  CONFIRM_UNDERSTANDING: { command: 'CONFIRM_DESIGN_UNDERSTANDING', boundary: 'ai-design-runtime', mutation: 'session-only', explicitCommitRequired: false, reference: null },
  START_GENERATION: { command: 'START_GENERATION', boundary: 'ai-design-runtime', mutation: 'session-only', explicitCommitRequired: false, reference: null },
  CONTINUE_GENERATION: { command: 'CONTINUE_GENERATION_STAGE', boundary: 'ai-design-runtime', mutation: 'session-only', explicitCommitRequired: false, reference: null },
  ANSWER_CLARIFICATION: { command: 'OPEN_CLARIFICATION_INPUT', boundary: 'local-ui', mutation: 'none', explicitCommitRequired: false, reference: 'questionId' },
  SELECT_CANDIDATE: { command: 'SELECT_CANDIDATE', boundary: 'ai-design-runtime', mutation: 'session-only', explicitCommitRequired: false, reference: 'candidateId' },
  OPEN_COMPARISON: { command: 'OPEN_CANDIDATE_COMPARISON', boundary: 'local-ui', mutation: 'none', explicitCommitRequired: false, reference: null },
  PREVIEW_CHANGE: { command: 'PREVIEW_CONCEPT_CHANGE', boundary: 'ai-design-runtime', mutation: 'preview-only', explicitCommitRequired: false, reference: 'gaugeId' },
  APPLY_CONCEPT_CHANGE: { command: 'APPLY_CONCEPT_CHANGE_TO_SESSION', boundary: 'ai-design-runtime', mutation: 'session-only', explicitCommitRequired: true, reference: 'proposalId' },
  REJECT_PREVIEW: { command: 'REJECT_CONCEPT_PREVIEW', boundary: 'local-ui', mutation: 'none', explicitCommitRequired: false, reference: 'proposalId' },
  UNDO_AI_VIEW_CHANGE: { command: 'UNDO_AI_VIEW_STATE', boundary: 'local-ui', mutation: 'none', explicitCommitRequired: false, reference: null },
  REDO_AI_VIEW_CHANGE: { command: 'REDO_AI_VIEW_STATE', boundary: 'local-ui', mutation: 'none', explicitCommitRequired: false, reference: null },
  REQUEST_PRECISION: { command: 'REQUEST_PRECISION_CAD', boundary: 'precision-cad', mutation: 'exact-cad-request', explicitCommitRequired: true, reference: 'candidateId' },
  INSPECT_VERIFICATION: { command: 'OPEN_VERIFICATION_EVIDENCE', boundary: 'local-ui', mutation: 'none', explicitCommitRequired: false, reference: 'verificationReceiptId' },
  REFRESH_SERVER_STATE: { command: 'REFRESH_SERVER_STATE', boundary: 'ai-design-runtime', mutation: 'session-only', explicitCommitRequired: false, reference: null },
  RESUME: { command: 'RESUME_FROM_SERVER_CHECKPOINT', boundary: 'ai-design-runtime', mutation: 'session-only', explicitCommitRequired: false, reference: null },
};

function validText(value: string): boolean {
  return value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH;
}

export function createAiDesignChatActionCard(input: Omit<AiDesignChatActionCardV1, 'schema' | 'authority'>): AiDesignChatActionCardV1 {
  if (![input.cardId, input.projectId, input.sessionId].every(value => SAFE_ID.test(value))) throw new Error('chat_card_identity_invalid');
  if (!Number.isSafeInteger(input.runtimeRevision) || input.runtimeRevision < 0) throw new Error('chat_card_revision_invalid');
  if (!validText(input.title) || !validText(input.summary)) throw new Error('chat_card_copy_invalid');
  if (!input.actions.length || input.actions.length > 8) throw new Error('chat_card_actions_invalid');
  if (new Set(input.actions.map(action => action.id)).size !== input.actions.length) throw new Error('chat_card_action_duplicate');
  if (input.actions.filter(action => action.primary && action.enabled).length > 1) throw new Error('chat_card_primary_action_ambiguous');
  for (const action of input.actions) {
    if (!ACTION_POLICY[action.id] || !validText(action.label) || (!action.enabled && !action.reason?.trim())) throw new Error('chat_card_action_invalid');
    if (action.requiresConfirmation !== ACTION_POLICY[action.id].explicitCommitRequired) throw new Error('chat_card_confirmation_policy_invalid');
  }
  const references = { ...input.references };
  for (const value of Object.values(references)) if (value !== null && !SAFE_ID.test(value)) throw new Error('chat_card_reference_invalid');
  const card: AiDesignChatActionCardV1 = {
    ...input,
    schema: AI_DESIGN_CHAT_ACTION_CARD_SCHEMA,
    references,
    actions: input.actions.map(action => Object.freeze({ ...action })),
    authority: {
      conceptOnly: true as const,
      previewIsNonPersistent: true as const,
      exactCadBoundary: 'precision-cad',
      manufacturingReleaseReady: false as const,
    },
  };
  return Object.freeze(card);
}

/** Maps one rendered chat CTA into a bounded effect. It never executes CAD. */
export function dispatchAiDesignChatAction(input: {
  card: AiDesignChatActionCardV1;
  actionId: AiDesignChatActionId;
  effectId: string;
  expectedRuntimeRevision: number;
}): AiDesignChatActionDispatchResult {
  if (!SAFE_ID.test(input.effectId) || !Number.isSafeInteger(input.expectedRuntimeRevision) || input.expectedRuntimeRevision < 0) return { ok: false, error: 'chat_effect_identity_invalid' };
  if (input.expectedRuntimeRevision !== input.card.runtimeRevision) return { ok: false, error: 'chat_card_stale_revision' };
  const action = input.card.actions.find(candidate => candidate.id === input.actionId);
  if (!action) return { ok: false, error: 'chat_action_not_rendered' };
  if (!action.enabled) return { ok: false, error: action.reason ?? 'chat_action_disabled' };
  const policy = ACTION_POLICY[action.id];
  const referenceId = policy.reference ? input.card.references[policy.reference] : null;
  if (policy.reference && !referenceId) return { ok: false, error: `chat_action_reference_required:${policy.reference}` };
  return {
    ok: true,
    effect: {
      schema: AI_DESIGN_CHAT_ACTION_EFFECT_SCHEMA,
      effectId: input.effectId,
      cardId: input.card.cardId,
      projectId: input.card.projectId,
      sessionId: input.card.sessionId,
      expectedRuntimeRevision: input.expectedRuntimeRevision,
      actionId: action.id,
      command: policy.command,
      boundary: policy.boundary,
      mutation: policy.mutation,
      referenceId,
      explicitCommitRequired: policy.explicitCommitRequired,
      exactGeometryAuthority: false,
      manufacturingReleaseReady: false,
    },
  };
}
