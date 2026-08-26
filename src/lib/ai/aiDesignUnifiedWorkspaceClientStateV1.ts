/**
 * Renderer-neutral client state for the unified AI Design workspace.
 *
 * The server snapshot is the only authoritative part of this state. View
 * context and previews are deliberately separate and cannot represent an
 * exact-CAD commit, a precision PASS, or a manufacturing release.
 */

import {
  validateAiDesignUnifiedWorkspaceV9,
  type AiDesignUnifiedWorkspaceSourceV9,
  type AiDesignUnifiedWorkspaceV9,
} from './aiDesignUnifiedWorkspaceV9';

export const AI_DESIGN_UNIFIED_WORKSPACE_CLIENT_STATE_V1_SCHEMA =
  'nexyfab.ai-design-unified-workspace-client-state.v1' as const;

export type ClientCanvasModeV1 = '2d' | '3d' | 'split';
export type ClientPanelV1 = 'chat' | 'canvas' | 'inspector' | 'comparison' | 'recovery';
export type ClientConnectivityV1 = 'online' | 'offline' | 'reconnecting';

export interface UnifiedWorkspaceServerSnapshotV1 {
  readonly projectId: string;
  readonly sessionId: string;
  readonly runtimeRevision: number;
  readonly complexRevision: number;
  /** Authoritative model returned by the API as `model`. */
  readonly source: AiDesignUnifiedWorkspaceSourceV9;
  /** Renderer-neutral V9 projection returned by the API as `unified`. */
  readonly workspace: AiDesignUnifiedWorkspaceV9;
}

export interface UnifiedWorkspaceSelectionV1 {
  readonly kind: 'candidate' | 'part' | 'feature' | 'face' | 'edge' | 'vertex' | 'dimension' | 'gauge';
  readonly id: string;
}

export interface UnifiedWorkspaceLocalViewStateV1 {
  readonly canvasMode: ClientCanvasModeV1;
  readonly panel: ClientPanelV1;
  readonly selection: UnifiedWorkspaceSelectionV1 | null;
  readonly modelFallbackContext: readonly string[];
}

export interface UnifiedWorkspacePreviewDraftV1 {
  readonly id: string;
  readonly baseRuntimeRevision: number;
  readonly gaugeId: string;
  readonly value: number;
  /** The server-backed value from which this preview began. */
  readonly originalValue?: number;
  readonly unit: string;
  readonly dirty: boolean;
}

export interface UnifiedWorkspaceRecoveryStateV1 {
  readonly connectivity: ClientConnectivityV1;
  readonly staleSnapshot: boolean;
  readonly conflict: boolean;
  readonly message: string | null;
  readonly mutationBlocked: boolean;
}

export interface UnifiedWorkspaceClientStateV1 {
  readonly schema: typeof AI_DESIGN_UNIFIED_WORKSPACE_CLIENT_STATE_V1_SCHEMA;
  readonly projectId: string;
  readonly sessionId: string;
  readonly server: UnifiedWorkspaceServerSnapshotV1;
  readonly localView: UnifiedWorkspaceLocalViewStateV1;
  readonly previewDraft: UnifiedWorkspacePreviewDraftV1 | null;
  readonly recovery: UnifiedWorkspaceRecoveryStateV1;
}

export type UnifiedWorkspaceClientEventV1 =
  | { readonly type: 'SERVER_SNAPSHOT_RECEIVED'; readonly snapshot: UnifiedWorkspaceServerSnapshotV1 }
  | { readonly type: 'VIEW_CHANGED'; readonly canvasMode?: ClientCanvasModeV1; readonly panel?: ClientPanelV1 }
  | { readonly type: 'SELECTION_CHANGED'; readonly selection: UnifiedWorkspaceSelectionV1 | null }
  | { readonly type: 'MODEL_FALLBACK_CONTEXT_SET'; readonly modelIds: readonly string[] }
  | { readonly type: 'PREVIEW_STARTED'; readonly draft: Omit<UnifiedWorkspacePreviewDraftV1, 'dirty'> }
  | { readonly type: 'PREVIEW_UPDATED'; readonly value: number }
  | { readonly type: 'PREVIEW_DISCARDED' }
  | { readonly type: 'CONNECTIVITY_CHANGED'; readonly connectivity: ClientConnectivityV1; readonly message?: string | null }
  | { readonly type: 'RECOVERY_CLEARED' };

export interface ReduceUnifiedWorkspaceClientStateResultV1 {
  readonly state: UnifiedWorkspaceClientStateV1;
  readonly accepted: boolean;
  readonly error: 'stale_server_snapshot' | 'identity_mismatch' | 'invalid_event' | null;
}

const MAX_MODEL_CONTEXT = 8;
const MAX_TEXT = 240;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SELECTION_KINDS: readonly UnifiedWorkspaceSelectionV1['kind'][] = ['candidate', 'part', 'feature', 'face', 'edge', 'vertex', 'dimension', 'gauge'];
const SAFE_UNIT = /^[A-Za-z0-9][A-Za-z0-9°/_ .-]{0,31}$/;

function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone) as T;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, clone(item)])) as T;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(item => freeze(item));
    Object.freeze(value);
  }
  return value;
}

function done(state: UnifiedWorkspaceClientStateV1): ReduceUnifiedWorkspaceClientStateResultV1 {
  return { state: freeze(state), accepted: true, error: null };
}

function rejected(state: UnifiedWorkspaceClientStateV1, error: NonNullable<ReduceUnifiedWorkspaceClientStateResultV1['error']>): ReduceUnifiedWorkspaceClientStateResultV1 {
  return { state, accepted: false, error };
}

function validServerSnapshot(server: UnifiedWorkspaceServerSnapshotV1): boolean {
  try {
    return !!server && SAFE_ID.test(server.projectId) && SAFE_ID.test(server.sessionId)
      && Number.isSafeInteger(server.runtimeRevision) && server.runtimeRevision >= 0
      && Number.isSafeInteger(server.complexRevision) && server.complexRevision >= 0
      && server.source.projectId === server.projectId && server.source.sessionId === server.sessionId
      && server.source.runtimeRevision === server.runtimeRevision && server.source.complexRevision === server.complexRevision
      && server.source.workspace.base.model.exactGeometryAuthority === false
      && server.source.workspace.base.trust.conceptOnly === true
      && server.source.workspace.base.trust.manufacturingReleaseReady === false
      && server.source.precision.manufacturingReleaseReady === false
      && server.workspace.projectId === server.projectId && server.workspace.sessionId === server.sessionId
      && server.workspace.revisions.runtime === server.runtimeRevision && server.workspace.revisions.complex === server.complexRevision
      && server.workspace.authority.manufacturingReleaseReady === false
      && server.workspace.sync.commitAllowed === false
      && validateAiDesignUnifiedWorkspaceV9(server.workspace).length === 0;
  } catch {
    return false;
  }
}

function newerThan(incoming: UnifiedWorkspaceServerSnapshotV1, current: UnifiedWorkspaceServerSnapshotV1): boolean {
  return incoming.runtimeRevision > current.runtimeRevision
    || incoming.runtimeRevision === current.runtimeRevision && incoming.complexRevision > current.complexRevision;
}

export function createUnifiedWorkspaceClientStateV1(server: UnifiedWorkspaceServerSnapshotV1, options: Partial<Pick<UnifiedWorkspaceLocalViewStateV1, 'canvasMode' | 'panel' | 'selection' | 'modelFallbackContext'>> = {}): UnifiedWorkspaceClientStateV1 {
  const state: UnifiedWorkspaceClientStateV1 = {
    schema: AI_DESIGN_UNIFIED_WORKSPACE_CLIENT_STATE_V1_SCHEMA,
    projectId: server.projectId,
    sessionId: server.sessionId,
    server: clone(server),
    localView: {
      canvasMode: options.canvasMode ?? 'split',
      panel: options.panel ?? 'chat',
      selection: options.selection ?? null,
      modelFallbackContext: [...(options.modelFallbackContext ?? [])].slice(0, MAX_MODEL_CONTEXT),
    },
    previewDraft: null,
    recovery: { connectivity: 'online', staleSnapshot: false, conflict: false, message: null, mutationBlocked: false },
  };
  assertUnifiedWorkspaceClientStateV1(state);
  return freeze(state);
}

export function reduceUnifiedWorkspaceClientStateV1(state: UnifiedWorkspaceClientStateV1, event: UnifiedWorkspaceClientEventV1): ReduceUnifiedWorkspaceClientStateResultV1 {
  try { assertUnifiedWorkspaceClientStateV1(state); } catch { return rejected(state, 'invalid_event'); }
  if (!event || typeof event.type !== 'string') return rejected(state, 'invalid_event');

  switch (event.type) {
    case 'SERVER_SNAPSHOT_RECEIVED': {
      const next = event.snapshot;
      if (!next || typeof next !== 'object') return rejected(state, 'invalid_event');
      if (next.projectId !== state.projectId || next.sessionId !== state.sessionId) return rejected(state, 'identity_mismatch');
      if (!validServerSnapshot(next)) return rejected(state, 'invalid_event');
      if (!newerThan(next, state.server)) return rejected(state, 'stale_server_snapshot');
      const discardedPreview = state.previewDraft !== null;
      const nextState = {
        ...state,
        server: clone(next),
        previewDraft: null,
        recovery: {
          ...state.recovery,
          staleSnapshot: false,
          conflict: false,
          mutationBlocked: state.recovery.connectivity !== 'online',
          message: discardedPreview ? 'uncommitted_preview_discarded' : null,
        },
      };
      assertUnifiedWorkspaceClientStateV1(nextState);
      return done(nextState);
    }
    case 'VIEW_CHANGED': {
      if (event.canvasMode !== undefined && !['2d', '3d', 'split'].includes(event.canvasMode)) return rejected(state, 'invalid_event');
      if (event.panel !== undefined && !['chat', 'canvas', 'inspector', 'comparison', 'recovery'].includes(event.panel)) return rejected(state, 'invalid_event');
      const localView = { ...state.localView, ...(event.canvasMode ? { canvasMode: event.canvasMode } : {}), ...(event.panel ? { panel: event.panel } : {}) };
      return done({ ...state, localView });
    }
    case 'SELECTION_CHANGED':
      if (event.selection && (!SAFE_ID.test(event.selection.id) || !SELECTION_KINDS.includes(event.selection.kind))) return rejected(state, 'invalid_event');
      return done({ ...state, localView: { ...state.localView, selection: event.selection ? { ...event.selection } : null } });
    case 'MODEL_FALLBACK_CONTEXT_SET':
      if (event.modelIds.length > MAX_MODEL_CONTEXT || event.modelIds.some(id => !SAFE_ID.test(id))) return rejected(state, 'invalid_event');
      return done({ ...state, localView: { ...state.localView, modelFallbackContext: [...event.modelIds] } });
    case 'PREVIEW_STARTED': {
      if (state.recovery.mutationBlocked || event.draft.baseRuntimeRevision !== state.server.runtimeRevision
        || !SAFE_ID.test(event.draft.id) || !SAFE_ID.test(event.draft.gaugeId) || !Number.isFinite(event.draft.value)
        || (event.draft.originalValue !== undefined && !Number.isFinite(event.draft.originalValue)) || !SAFE_UNIT.test(event.draft.unit)) return rejected(state, 'invalid_event');
      const draft = { ...event.draft, originalValue: event.draft.originalValue ?? event.draft.value, dirty: false };
      return done({ ...state, previewDraft: draft, localView: { ...state.localView, panel: 'inspector' } });
    }
    case 'PREVIEW_UPDATED': {
      if (!state.previewDraft || !Number.isFinite(event.value) || state.recovery.connectivity !== 'online') return rejected(state, 'invalid_event');
      return done({ ...state, previewDraft: { ...state.previewDraft, value: event.value, dirty: event.value !== (state.previewDraft.originalValue ?? state.previewDraft.value) } });
    }
    case 'PREVIEW_DISCARDED': return done({ ...state, previewDraft: null });
    case 'CONNECTIVITY_CHANGED': {
      if (!['online', 'offline', 'reconnecting'].includes(event.connectivity) || (event.message !== undefined && event.message !== null && (typeof event.message !== 'string' || event.message.length > MAX_TEXT))) return rejected(state, 'invalid_event');
      const blocked = event.connectivity !== 'online' || state.recovery.staleSnapshot;
      return done({ ...state, recovery: { ...state.recovery, connectivity: event.connectivity, mutationBlocked: blocked, message: event.message ?? null } });
    }
    case 'RECOVERY_CLEARED': return done({ ...state, recovery: { ...state.recovery, staleSnapshot: false, conflict: false, mutationBlocked: state.recovery.connectivity !== 'online', message: null } });
    default: return rejected(state, 'invalid_event');
  }
}

export function assertUnifiedWorkspaceClientStateV1(state: UnifiedWorkspaceClientStateV1): void {
  if (!state || state.schema !== AI_DESIGN_UNIFIED_WORKSPACE_CLIENT_STATE_V1_SCHEMA) throw new Error('invalid_client_state_schema');
  if (!SAFE_ID.test(state.projectId) || !SAFE_ID.test(state.sessionId) || state.server.projectId !== state.projectId || state.server.sessionId !== state.sessionId) throw new Error('invalid_client_state_identity');
  if (!validServerSnapshot(state.server)) throw new Error('invalid_server_revision');
  if (!['2d', '3d', 'split'].includes(state.localView.canvasMode) || !['chat', 'canvas', 'inspector', 'comparison', 'recovery'].includes(state.localView.panel)) throw new Error('invalid_local_view');
  if (state.localView.selection && (!SAFE_ID.test(state.localView.selection.id) || !SELECTION_KINDS.includes(state.localView.selection.kind))) throw new Error('invalid_selection');
  if (state.localView.modelFallbackContext.length > MAX_MODEL_CONTEXT || state.localView.modelFallbackContext.some(id => !SAFE_ID.test(id))) throw new Error('invalid_model_context');
  if (state.previewDraft && (state.previewDraft.baseRuntimeRevision !== state.server.runtimeRevision || !SAFE_ID.test(state.previewDraft.id) || !SAFE_ID.test(state.previewDraft.gaugeId) || !Number.isFinite(state.previewDraft.value) || (state.previewDraft.originalValue !== undefined && !Number.isFinite(state.previewDraft.originalValue)) || typeof state.previewDraft.dirty !== 'boolean' || !SAFE_UNIT.test(state.previewDraft.unit))) throw new Error('invalid_preview_draft');
  if (!['online', 'offline', 'reconnecting'].includes(state.recovery.connectivity) || typeof state.recovery.mutationBlocked !== 'boolean' || typeof state.recovery.staleSnapshot !== 'boolean' || typeof state.recovery.conflict !== 'boolean') throw new Error('invalid_recovery_state');
  if (state.recovery.message !== null && state.recovery.message.length > MAX_TEXT) throw new Error('invalid_recovery_message');
  // Local state is intentionally incapable of carrying authority claims.
  const local = state.localView as unknown as Record<string, unknown>;
  for (const forbidden of ['exactCad', 'precisionPass', 'manufacturingReleaseReady', 'commitAllowed']) if (forbidden in local) throw new Error('local_authority_forbidden');
}
