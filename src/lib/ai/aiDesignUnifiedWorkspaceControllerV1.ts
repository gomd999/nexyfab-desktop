import type { AiDesignChatActionEffectV1 } from './aiDesignChatActionCards';
import {
  adaptAiDesignChatActionCommandV1,
  type AiDesignChatActionCommandAdapterOptions,
  type AiDesignChatActionCommandAdapterResult,
} from './aiDesignChatActionCommandAdapterV1';
import {
  advanceAiDesignPreviewLifecycle,
  createAiDesignPreviewLifecycle,
  validateAiDesignPreviewLifecycle,
  type AiDesignPreviewEvidenceV1,
  type AiDesignPreviewLifecycleV1,
} from './aiDesignPreviewLifecycleV1';
import {
  createUnifiedWorkspaceClientStateV1,
  reduceUnifiedWorkspaceClientStateV1,
  type ClientConnectivityV1,
  type UnifiedWorkspaceClientStateV1,
  type UnifiedWorkspacePreviewDraftV1,
  type UnifiedWorkspaceServerSnapshotV1,
} from './aiDesignUnifiedWorkspaceClientStateV1';

export const AI_DESIGN_UNIFIED_WORKSPACE_CONTROLLER_V1_SCHEMA = 'nexyfab.ai-design-unified-workspace-controller.v1' as const;

type AdapterOutput = Extract<AiDesignChatActionCommandAdapterResult, { ok: true }>['output'];

export interface AiDesignUnifiedWorkspaceControllerV1 {
  schema: typeof AI_DESIGN_UNIFIED_WORKSPACE_CONTROLLER_V1_SCHEMA;
  client: UnifiedWorkspaceClientStateV1;
  preview: AiDesignPreviewLifecycleV1;
  pending: AdapterOutput | null;
  lastError: string | null;
  capabilities: {
    mutationEnabled: boolean;
    previewRequestEnabled: boolean;
    conceptApplyEnabled: boolean;
    exactCadExecutionAllowed: false;
    browserCanAuthorVerificationPass: false;
    manufacturingReleaseReady: false;
  };
}

export type AiDesignUnifiedWorkspaceControllerEventV1 =
  | { type: 'BEGIN_GAUGE_DRAFT'; draft: Omit<UnifiedWorkspacePreviewDraftV1, 'dirty'> }
  | { type: 'UPDATE_GAUGE_DRAFT'; value: number }
  | { type: 'DISPATCH_CHAT_EFFECT'; effect: AiDesignChatActionEffectV1; options?: Omit<AiDesignChatActionCommandAdapterOptions, 'currentRuntimeRevision' | 'currentComplexRevision'>; explicitConfirmation?: boolean }
  | { type: 'PREVIEW_RECEIVED'; requestId: string; evidence: AiDesignPreviewEvidenceV1 }
  | { type: 'SERVER_SNAPSHOT_RECEIVED'; snapshot: UnifiedWorkspaceServerSnapshotV1; completedRequestId?: string }
  | { type: 'CONNECTIVITY_CHANGED'; connectivity: ClientConnectivityV1; message?: string | null }
  | { type: 'CLEAR_PENDING' }
  | { type: 'CLEAR_ERROR' };

export type AiDesignUnifiedWorkspaceControllerResultV1 =
  | { ok: true; state: AiDesignUnifiedWorkspaceControllerV1 }
  | { ok: false; error: string; state: AiDesignUnifiedWorkspaceControllerV1 };

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

export function createAiDesignServerRevisionTokenV1(snapshot: Pick<UnifiedWorkspaceServerSnapshotV1, 'runtimeRevision' | 'complexRevision'>): string {
  return `runtime-${snapshot.runtimeRevision}:complex-${snapshot.complexRevision}`;
}

function withCapabilities(state: Omit<AiDesignUnifiedWorkspaceControllerV1, 'capabilities'>): AiDesignUnifiedWorkspaceControllerV1 {
  const mutationEnabled = !state.client.recovery.mutationBlocked
    && !state.client.recovery.staleSnapshot
    && !state.preview.serverRefreshRequired
    && !['PREVIEWING', 'APPLYING', 'STALE', 'BLOCKED'].includes(state.preview.status);
  return Object.freeze({
    ...state,
    capabilities: {
      mutationEnabled,
      previewRequestEnabled: mutationEnabled && state.preview.status === 'DRAFT' && state.preview.draft?.dirty === true,
      conceptApplyEnabled: mutationEnabled && state.preview.applyEnabled,
      exactCadExecutionAllowed: false as const,
      browserCanAuthorVerificationPass: false as const,
      manufacturingReleaseReady: false as const,
    },
  });
}

function accepted(state: Omit<AiDesignUnifiedWorkspaceControllerV1, 'capabilities'>): AiDesignUnifiedWorkspaceControllerResultV1 {
  const next = withCapabilities(state);
  const issues = validateAiDesignUnifiedWorkspaceControllerV1(next);
  return issues.length ? { ok: false, error: issues[0], state: next } : { ok: true, state: next };
}

function rejected(state: AiDesignUnifiedWorkspaceControllerV1, error: string): AiDesignUnifiedWorkspaceControllerResultV1 {
  return { ok: false, error, state: withCapabilities({ ...state, lastError: error }) };
}

export function createAiDesignUnifiedWorkspaceControllerV1(server: UnifiedWorkspaceServerSnapshotV1): AiDesignUnifiedWorkspaceControllerV1 {
  const client = createUnifiedWorkspaceClientStateV1(server);
  return withCapabilities({
    schema: AI_DESIGN_UNIFIED_WORKSPACE_CONTROLLER_V1_SCHEMA,
    client,
    preview: createAiDesignPreviewLifecycle({
      projectId: server.projectId,
      sessionId: server.sessionId,
      runtimeRevision: server.runtimeRevision,
      revisionToken: createAiDesignServerRevisionTokenV1(server),
    }),
    pending: null,
    lastError: null,
  });
}

/**
 * Coordinates renderer events without executing commands itself. Server
 * requests and Precision handoffs remain explicit outputs for their owning
 * integration boundary.
 */
export function reduceAiDesignUnifiedWorkspaceControllerV1(
  state: AiDesignUnifiedWorkspaceControllerV1,
  event: AiDesignUnifiedWorkspaceControllerEventV1,
): AiDesignUnifiedWorkspaceControllerResultV1 {
  const currentIssues = validateAiDesignUnifiedWorkspaceControllerV1(state);
  if (currentIssues.length) return rejected(state, currentIssues[0]);

  switch (event.type) {
    case 'BEGIN_GAUGE_DRAFT': {
      const client = reduceUnifiedWorkspaceClientStateV1(state.client, { type: 'PREVIEW_STARTED', draft: event.draft });
      if (!client.accepted) return rejected(state, `controller_client:${client.error}`);
      const preview = advanceAiDesignPreviewLifecycle(state.preview, {
        type: 'BEGIN_DRAFT', expectedRuntimeRevision: state.client.server.runtimeRevision,
        gaugeId: event.draft.gaugeId, value: event.draft.value, unit: event.draft.unit,
      });
      if (!preview.ok) return rejected(state, `controller_preview:${preview.error}`);
      return accepted({ ...state, client: client.state, preview: preview.state, pending: null, lastError: null });
    }
    case 'UPDATE_GAUGE_DRAFT': {
      const client = reduceUnifiedWorkspaceClientStateV1(state.client, { type: 'PREVIEW_UPDATED', value: event.value });
      if (!client.accepted) return rejected(state, `controller_client:${client.error}`);
      const preview = advanceAiDesignPreviewLifecycle(state.preview, {
        type: 'UPDATE_DRAFT', expectedRuntimeRevision: state.client.server.runtimeRevision, value: event.value,
      });
      if (!preview.ok) return rejected(state, `controller_preview:${preview.error}`);
      return accepted({ ...state, client: client.state, preview: preview.state, pending: null, lastError: null });
    }
    case 'DISPATCH_CHAT_EFFECT': {
      if (state.client.recovery.mutationBlocked && event.effect.mutation !== 'none') return rejected(state, 'controller_mutation_blocked');
      const adapted = adaptAiDesignChatActionCommandV1(event.effect, {
        ...event.options,
        currentRuntimeRevision: state.client.server.runtimeRevision,
        currentComplexRevision: state.client.server.complexRevision,
      });
      if (!adapted.ok) return rejected(state, `controller_adapter:${adapted.error}`);
      if (adapted.output.kind === 'concept-preview-request') {
        if (!state.client.previewDraft || state.client.previewDraft.gaugeId !== adapted.output.gaugeId || !state.client.previewDraft.dirty) return rejected(state, 'controller_dirty_preview_draft_required');
        const preview = advanceAiDesignPreviewLifecycle(state.preview, { type: 'REQUEST_PREVIEW', expectedRuntimeRevision: state.client.server.runtimeRevision });
        if (!preview.ok) return rejected(state, `controller_preview:${preview.error}`);
        return accepted({ ...state, preview: preview.state, pending: adapted.output, lastError: null });
      }
      if (adapted.output.kind === 'concept-apply-request') {
        if (!event.explicitConfirmation) return rejected(state, 'controller_explicit_confirmation_required');
        if (state.preview.preview?.proposalId !== adapted.output.proposalId) return rejected(state, 'controller_preview_proposal_mismatch');
        const preview = advanceAiDesignPreviewLifecycle(state.preview, {
          type: 'REQUEST_APPLY', expectedRuntimeRevision: state.client.server.runtimeRevision, explicitConfirmation: true,
        });
        if (!preview.ok) return rejected(state, `controller_preview:${preview.error}`);
        return accepted({ ...state, preview: preview.state, pending: adapted.output, lastError: null });
      }
      if (event.effect.actionId === 'REJECT_PREVIEW') {
        const preview = advanceAiDesignPreviewLifecycle(state.preview, { type: 'REJECT', expectedRuntimeRevision: state.client.server.runtimeRevision });
        if (!preview.ok) return rejected(state, `controller_preview:${preview.error}`);
        const client = reduceUnifiedWorkspaceClientStateV1(state.client, { type: 'PREVIEW_DISCARDED' });
        return accepted({ ...state, client: client.state, preview: preview.state, pending: adapted.output, lastError: null });
      }
      return accepted({ ...state, pending: adapted.output, lastError: null });
    }
    case 'PREVIEW_RECEIVED': {
      if (state.client.recovery.connectivity !== 'online' || state.pending?.kind !== 'concept-preview-request' || state.pending.requestId !== event.requestId) return rejected(state, 'controller_preview_request_mismatch');
      const preview = advanceAiDesignPreviewLifecycle(state.preview, {
        type: 'RECEIVE_PREVIEW', expectedRuntimeRevision: state.client.server.runtimeRevision, preview: event.evidence,
      });
      if (!preview.ok) return rejected(state, `controller_preview:${preview.error}`);
      return accepted({ ...state, preview: preview.state, pending: null, lastError: null });
    }
    case 'SERVER_SNAPSHOT_RECEIVED': {
      const client = reduceUnifiedWorkspaceClientStateV1(state.client, { type: 'SERVER_SNAPSHOT_RECEIVED', snapshot: event.snapshot });
      if (!client.accepted) return rejected(state, `controller_client:${client.error}`);
      const revisionToken = createAiDesignServerRevisionTokenV1(event.snapshot);
      const completedApply = state.pending?.kind === 'concept-apply-request'
        && event.completedRequestId === state.pending.requestId;
      let preview = completedApply
        ? advanceAiDesignPreviewLifecycle(state.preview, {
          type: 'APPLY_SUCCEEDED', expectedRuntimeRevision: state.client.server.runtimeRevision,
          nextRuntimeRevision: event.snapshot.runtimeRevision, nextRevisionToken: revisionToken,
        })
        : advanceAiDesignPreviewLifecycle(state.preview, {
          type: 'SERVER_STATE_CHANGED', runtimeRevision: event.snapshot.runtimeRevision, revisionToken,
        });
      if (!preview.ok) return rejected(state, `controller_preview:${preview.error}`);
      if (completedApply) {
        preview = advanceAiDesignPreviewLifecycle(preview.state, {
          type: 'SERVER_REFRESH_ACKNOWLEDGED', expectedRuntimeRevision: event.snapshot.runtimeRevision, revisionToken,
        });
        if (!preview.ok) return rejected(state, `controller_preview:${preview.error}`);
      }
      return accepted({ ...state, client: client.state, preview: preview.state, pending: null, lastError: null });
    }
    case 'CONNECTIVITY_CHANGED': {
      const client = reduceUnifiedWorkspaceClientStateV1(state.client, { type: 'CONNECTIVITY_CHANGED', connectivity: event.connectivity, message: event.message });
      if (!client.accepted) return rejected(state, `controller_client:${client.error}`);
      return accepted({ ...state, client: client.state, lastError: null });
    }
    case 'CLEAR_PENDING': return accepted({ ...state, pending: null, lastError: null });
    case 'CLEAR_ERROR': return accepted({ ...state, lastError: null });
  }
}

export function validateAiDesignUnifiedWorkspaceControllerV1(state: AiDesignUnifiedWorkspaceControllerV1): string[] {
  const issues: string[] = [];
  if (!state || state.schema !== AI_DESIGN_UNIFIED_WORKSPACE_CONTROLLER_V1_SCHEMA) return ['controller_schema_invalid'];
  if (!SAFE_ID.test(state.client.projectId) || state.client.projectId !== state.preview.projectId || state.client.sessionId !== state.preview.sessionId) issues.push('controller_identity_invalid');
  if (state.preview.authoritativeRuntimeRevision !== state.client.server.runtimeRevision
    || state.preview.authoritativeRevisionToken !== createAiDesignServerRevisionTokenV1(state.client.server)) issues.push('controller_revision_binding_invalid');
  issues.push(...validateAiDesignPreviewLifecycle(state.preview).map(issue => `controller_${issue}`));
  if (state.pending && ('projectId' in state.pending) && (state.pending.projectId !== state.client.projectId || state.pending.sessionId !== state.client.sessionId)) issues.push('controller_pending_identity_invalid');
  if (state.capabilities.exactCadExecutionAllowed !== false || state.capabilities.browserCanAuthorVerificationPass !== false || state.capabilities.manufacturingReleaseReady !== false) issues.push('controller_authority_invalid');
  return [...new Set(issues)];
}
