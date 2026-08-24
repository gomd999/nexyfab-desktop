import type { AiDesignChatActionEffectV1, AiDesignChatActionId } from './aiDesignChatActionCards';
import {
  parseAiDesignWorkspaceClientCommandV2,
  type AiDesignWorkspaceClientCommandV2,
  type PublicModelSelectionV2,
} from './aiDesignWorkspaceCommandV2';

export const AI_DESIGN_CHAT_ACTION_COMMAND_ADAPTER_V1_SCHEMA = 'nexyfab.ai-design-chat-action-command-adapter.v1' as const;
export const AI_DESIGN_CONCEPT_PREVIEW_REQUEST_V1_SCHEMA = 'nexyfab.ai-design-concept-preview-request.v1' as const;
export const AI_DESIGN_CONCEPT_APPLY_REQUEST_V1_SCHEMA = 'nexyfab.ai-design-concept-apply-request.v1' as const;
export const AI_DESIGN_PRECISION_HANDOFF_V1_SCHEMA = 'nexyfab.ai-design-precision-cad-handoff.v1' as const;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

export interface AiDesignChatActionCommandAdapterOptions {
  /** The revision currently held by the server-backed client. */
  currentRuntimeRevision: number;
  currentComplexRevision?: number;
  issuedAt?: string;
  commandId?: string;
  runId?: string;
  modelSelection?: PublicModelSelectionV2;
  gauge?: { mode: 'fine' | 'coarse'; direction: 1 | -1 };
}

export interface AiDesignLocalInstructionV1 {
  kind: 'local-instruction';
  instruction:
    | 'OPEN_MULTIMODAL_INPUT'
    | 'OPEN_CLARIFICATION_INPUT'
    | 'OPEN_CANDIDATE_COMPARISON'
    | 'UNDO_AI_VIEW_STATE'
    | 'REDO_AI_VIEW_STATE'
    | 'REJECT_CONCEPT_PREVIEW'
    | 'OPEN_VERIFICATION_EVIDENCE'
    | 'REFRESH_SERVER_STATE';
  projectId: string;
  sessionId: string;
  expectedRuntimeRevision: number;
  referenceId: string | null;
  persistent: false;
}

export interface AiDesignPrecisionCadHandoffV1 {
  schema: typeof AI_DESIGN_PRECISION_HANDOFF_V1_SCHEMA;
  kind: 'precision-cad-handoff';
  requestId: string;
  projectId: string;
  sessionId: string;
  expectedRuntimeRevision: number;
  expectedComplexRevision: number;
  candidateId: string;
  explicitCommitRequired: true;
  exactExecution: false;
  verificationPass: false;
  manufacturingReleaseReady: false;
}

export interface AiDesignConceptPreviewRequestV1 {
  schema: typeof AI_DESIGN_CONCEPT_PREVIEW_REQUEST_V1_SCHEMA;
  kind: 'concept-preview-request';
  requestId: string;
  projectId: string;
  sessionId: string;
  expectedRuntimeRevision: number;
  gaugeId: string;
  adjustment: { mode: 'fine' | 'coarse'; direction: 1 | -1 };
  previewOnly: true;
  persistent: false;
  exactExecution: false;
  verificationPass: false;
}

export interface AiDesignConceptApplyRequestV1 {
  schema: typeof AI_DESIGN_CONCEPT_APPLY_REQUEST_V1_SCHEMA;
  kind: 'concept-apply-request';
  requestId: string;
  projectId: string;
  sessionId: string;
  expectedRuntimeRevision: number;
  proposalId: string;
  explicitConfirmationRequired: true;
  mutation: 'concept-session-only';
  exactExecution: false;
  verificationPass: false;
  manufacturingReleaseReady: false;
}

export interface AiDesignServerRequestV1 {
  kind: 'server-request';
  command: AiDesignWorkspaceClientCommandV2;
  referenceId: string | null;
}

export type AiDesignChatActionCommandAdapterResult =
  | { ok: true; adapterSchema: typeof AI_DESIGN_CHAT_ACTION_COMMAND_ADAPTER_V1_SCHEMA; output: AiDesignLocalInstructionV1 | AiDesignServerRequestV1 | AiDesignConceptPreviewRequestV1 | AiDesignConceptApplyRequestV1 | AiDesignPrecisionCadHandoffV1 }
  | { ok: false; error: string };

function validRevision(value: number | undefined): boolean {
  return Number.isSafeInteger(value) && value !== undefined && value >= 0;
}

function validDate(value: string): boolean { return Number.isFinite(Date.parse(value)); }

function commandBase(effect: AiDesignChatActionEffectV1, options: AiDesignChatActionCommandAdapterOptions, type: AiDesignWorkspaceClientCommandV2['type'], payload: Record<string, unknown>): unknown {
  return {
    schema: 'nexyfab.ai-design-workspace-command.v2',
    commandId: options.commandId ?? effect.effectId,
    projectId: effect.projectId,
    sessionId: effect.sessionId,
    expectedRuntimeRevision: effect.expectedRuntimeRevision,
    issuedAt: options.issuedAt ?? new Date().toISOString(),
    type,
    payload,
  };
}

/**
 * Adapts a rendered V9 effect into a local instruction, a validated V2 user
 * request, or a Precision CAD handoff descriptor. It does not execute a
 * command, persist a preview, or manufacture/verify geometry.
 */
export function adaptAiDesignChatActionCommandV1(
  effect: AiDesignChatActionEffectV1,
  options: AiDesignChatActionCommandAdapterOptions,
): AiDesignChatActionCommandAdapterResult {
  if (!effect || effect.schema !== 'nexyfab.ai-design-chat-action-effect.v1') return { ok: false, error: 'chat_adapter_effect_invalid' };
  if (!ID.test(effect.effectId) || !ID.test(effect.projectId) || !ID.test(effect.sessionId)) return { ok: false, error: 'chat_adapter_identity_invalid' };
  if (!validRevision(effect.expectedRuntimeRevision) || !validRevision(options.currentRuntimeRevision)) return { ok: false, error: 'chat_adapter_revision_invalid' };
  if (effect.expectedRuntimeRevision !== options.currentRuntimeRevision) return { ok: false, error: 'chat_adapter_stale_revision' };
  if (options.currentComplexRevision !== undefined && !validRevision(options.currentComplexRevision)) return { ok: false, error: 'chat_adapter_complex_revision_invalid' };
  if (options.issuedAt !== undefined && !validDate(options.issuedAt)) return { ok: false, error: 'chat_adapter_issued_at_invalid' };
  if (options.commandId !== undefined && !ID.test(options.commandId)) return { ok: false, error: 'chat_adapter_command_id_invalid' };
  if (effect.exactGeometryAuthority || effect.manufacturingReleaseReady) return { ok: false, error: 'chat_adapter_authority_escalation' };
  if (effect.referenceId !== null && !ID.test(effect.referenceId)) return { ok: false, error: 'chat_adapter_reference_invalid' };

  const local = (instruction: AiDesignLocalInstructionV1['instruction']): AiDesignChatActionCommandAdapterResult => ({
    ok: true, adapterSchema: AI_DESIGN_CHAT_ACTION_COMMAND_ADAPTER_V1_SCHEMA,
    output: { kind: 'local-instruction', instruction, projectId: effect.projectId, sessionId: effect.sessionId, expectedRuntimeRevision: effect.expectedRuntimeRevision, referenceId: effect.referenceId, persistent: false },
  });
  const server = (type: AiDesignWorkspaceClientCommandV2['type'], payload: Record<string, unknown>): AiDesignChatActionCommandAdapterResult => {
    if (effect.boundary !== 'ai-design-runtime' || effect.mutation !== 'session-only') return { ok: false, error: 'chat_adapter_runtime_boundary_invalid' };
    const parsed = parseAiDesignWorkspaceClientCommandV2(commandBase(effect, options, type, payload));
    if (!parsed.ok) return { ok: false, error: `chat_adapter_command_invalid:${parsed.issues.join(',')}` };
    return {
      ok: true, adapterSchema: AI_DESIGN_CHAT_ACTION_COMMAND_ADAPTER_V1_SCHEMA,
      output: { kind: 'server-request', command: parsed.command, referenceId: effect.referenceId },
    };
  };

  if (effect.actionId === 'REQUEST_PRECISION') {
    if (effect.boundary !== 'precision-cad' || effect.mutation !== 'exact-cad-request' || !effect.explicitCommitRequired || !effect.referenceId || !validRevision(options.currentComplexRevision)) return { ok: false, error: 'chat_adapter_precision_boundary_invalid' };
    return { ok: true, adapterSchema: AI_DESIGN_CHAT_ACTION_COMMAND_ADAPTER_V1_SCHEMA, output: {
      schema: AI_DESIGN_PRECISION_HANDOFF_V1_SCHEMA, kind: 'precision-cad-handoff', requestId: effect.effectId,
      projectId: effect.projectId, sessionId: effect.sessionId, expectedRuntimeRevision: effect.expectedRuntimeRevision,
      expectedComplexRevision: options.currentComplexRevision as number,
      candidateId: effect.referenceId, explicitCommitRequired: true, exactExecution: false, verificationPass: false, manufacturingReleaseReady: false,
    } };
  }

  switch (effect.actionId as AiDesignChatActionId) {
    case 'ADD_INPUT': return local('OPEN_MULTIMODAL_INPUT');
    case 'ANSWER_CLARIFICATION': return local('OPEN_CLARIFICATION_INPUT');
    case 'OPEN_COMPARISON': return local('OPEN_CANDIDATE_COMPARISON');
    case 'UNDO_AI_VIEW_CHANGE': return local('UNDO_AI_VIEW_STATE');
    case 'REDO_AI_VIEW_CHANGE': return local('REDO_AI_VIEW_STATE');
    case 'REJECT_PREVIEW': return local('REJECT_CONCEPT_PREVIEW');
    case 'INSPECT_VERIFICATION': return local('OPEN_VERIFICATION_EVIDENCE');
    case 'CONFIRM_UNDERSTANDING': return server('REQUEST_UNDERSTANDING_CONFIRMATION', { acknowledged: true });
    case 'START_GENERATION':
      if (!options.runId || !ID.test(options.runId) || !options.modelSelection) return { ok: false, error: 'chat_adapter_generation_request_required' };
      return server('START_GENERATION_REQUEST', { runId: options.runId, modelSelection: options.modelSelection });
    case 'CONTINUE_GENERATION': return server('RUN_GENERATION_STAGE_REQUEST', {});
    case 'SELECT_CANDIDATE':
      if (!effect.referenceId) return { ok: false, error: 'chat_adapter_candidate_reference_required' };
      return server('SELECT_CANDIDATE', { candidateId: effect.referenceId });
    case 'PREVIEW_CHANGE':
      if (effect.boundary !== 'ai-design-runtime' || effect.mutation !== 'preview-only' || effect.explicitCommitRequired || !effect.referenceId) return { ok: false, error: 'chat_adapter_preview_boundary_invalid' };
      return { ok: true, adapterSchema: AI_DESIGN_CHAT_ACTION_COMMAND_ADAPTER_V1_SCHEMA, output: {
        schema: AI_DESIGN_CONCEPT_PREVIEW_REQUEST_V1_SCHEMA, kind: 'concept-preview-request', requestId: effect.effectId,
        projectId: effect.projectId, sessionId: effect.sessionId, expectedRuntimeRevision: effect.expectedRuntimeRevision,
        gaugeId: effect.referenceId, adjustment: options.gauge ?? { mode: 'fine', direction: 1 },
        previewOnly: true, persistent: false, exactExecution: false, verificationPass: false,
      } };
    case 'APPLY_CONCEPT_CHANGE':
      if (effect.boundary !== 'ai-design-runtime' || !effect.explicitCommitRequired || effect.mutation !== 'session-only' || !effect.referenceId) return { ok: false, error: 'chat_adapter_concept_commit_invalid' };
      return { ok: true, adapterSchema: AI_DESIGN_CHAT_ACTION_COMMAND_ADAPTER_V1_SCHEMA, output: {
        schema: AI_DESIGN_CONCEPT_APPLY_REQUEST_V1_SCHEMA, kind: 'concept-apply-request', requestId: effect.effectId,
        projectId: effect.projectId, sessionId: effect.sessionId, expectedRuntimeRevision: effect.expectedRuntimeRevision,
        proposalId: effect.referenceId, explicitConfirmationRequired: true, mutation: 'concept-session-only',
        exactExecution: false, verificationPass: false, manufacturingReleaseReady: false,
      } };
    case 'REFRESH_SERVER_STATE': return local('REFRESH_SERVER_STATE');
    case 'RESUME': return server('RESUME', {});
    default: return { ok: false, error: 'chat_adapter_action_unsupported' };
  }
}

export const adaptAiDesignChatActionV1 = adaptAiDesignChatActionCommandV1;
