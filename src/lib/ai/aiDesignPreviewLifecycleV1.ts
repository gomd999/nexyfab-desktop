import type { StableSyncRef } from './aiDesign2d3dSync';

export const AI_DESIGN_PREVIEW_LIFECYCLE_SCHEMA = 'nexyfab.ai-design-preview-lifecycle.v1' as const;

export type AiDesignPreviewLifecycleStatus =
  | 'IDLE'
  | 'DRAFT'
  | 'PREVIEWING'
  | 'PREVIEW_READY'
  | 'APPLYING'
  | 'APPLIED'
  | 'REJECTED'
  | 'STALE'
  | 'BLOCKED';

export interface AiDesignPreviewDraftV1 {
  gaugeId: string;
  initialValue: number;
  draftValue: number;
  unit: string;
  dirty: boolean;
}

export interface AiDesignPreviewEvidenceV1 {
  proposalId: string;
  proposalDigest: string;
  baseRuntimeRevision: number;
  baseRevisionToken: string;
  affectedRefs: readonly StableSyncRef[];
  summaryCodes: readonly string[];
  previewOnly: true;
  verification: { geometry: 'NOT_RUN'; topology: 'NOT_RUN'; manufacturing: 'NOT_RUN' };
}

export interface AiDesignPreviewLifecycleV1 {
  schema: typeof AI_DESIGN_PREVIEW_LIFECYCLE_SCHEMA;
  projectId: string;
  sessionId: string;
  authoritativeRuntimeRevision: number;
  authoritativeRevisionToken: string;
  status: AiDesignPreviewLifecycleStatus;
  draft: AiDesignPreviewDraftV1 | null;
  preview: AiDesignPreviewEvidenceV1 | null;
  failureCode: string | null;
  preservedDraft: boolean;
  serverRefreshRequired: boolean;
  applyEnabled: boolean;
  rejectEnabled: boolean;
  authority: {
    mutation: 'concept-session-only';
    previewIsNonPersistent: true;
    exactCadExecutionAllowed: false;
    browserCanAuthorVerificationPass: false;
    manufacturingReleaseReady: false;
  };
}

export type AiDesignPreviewLifecycleAction =
  | { type: 'BEGIN_DRAFT'; expectedRuntimeRevision: number; gaugeId: string; value: number; unit: string }
  | { type: 'UPDATE_DRAFT'; expectedRuntimeRevision: number; value: number }
  | { type: 'REQUEST_PREVIEW'; expectedRuntimeRevision: number }
  | { type: 'RECEIVE_PREVIEW'; expectedRuntimeRevision: number; preview: AiDesignPreviewEvidenceV1 }
  | { type: 'REQUEST_APPLY'; expectedRuntimeRevision: number; explicitConfirmation: boolean }
  | { type: 'APPLY_SUCCEEDED'; expectedRuntimeRevision: number; nextRuntimeRevision: number; nextRevisionToken: string }
  | { type: 'SERVER_REFRESH_ACKNOWLEDGED'; expectedRuntimeRevision: number; revisionToken: string }
  | { type: 'REJECT'; expectedRuntimeRevision: number }
  | { type: 'SERVER_STATE_CHANGED'; runtimeRevision: number; revisionToken: string }
  | { type: 'BLOCK'; expectedRuntimeRevision: number; failureCode: string }
  | { type: 'RESET' };

export type AiDesignPreviewLifecycleResult =
  | { ok: true; state: AiDesignPreviewLifecycleV1 }
  | { ok: false; error: string; state: AiDesignPreviewLifecycleV1 };

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SAFE_UNIT = /^[A-Za-z0-9][A-Za-z0-9°/_ .-]{0,31}$/;
const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REF_KINDS = ['drawing_entity', 'dimension', 'structure_node', 'feature', 'parameter'] as const;

function result(state: AiDesignPreviewLifecycleV1): AiDesignPreviewLifecycleResult {
  return { ok: true, state: Object.freeze(state) };
}

function reject(state: AiDesignPreviewLifecycleV1, error: string): AiDesignPreviewLifecycleResult {
  return { ok: false, error, state };
}

function validRevision(revision: number): boolean {
  return Number.isSafeInteger(revision) && revision >= 0;
}

function validRef(ref: StableSyncRef): boolean {
  return REF_KINDS.includes(ref.kind) && SAFE_ID.test(ref.id);
}

function validPreview(preview: AiDesignPreviewEvidenceV1, state: AiDesignPreviewLifecycleV1): boolean {
  return SAFE_ID.test(preview.proposalId)
    && SHA256.test(preview.proposalDigest)
    && preview.baseRuntimeRevision === state.authoritativeRuntimeRevision
    && preview.baseRevisionToken === state.authoritativeRevisionToken
    && preview.affectedRefs.length <= 2_000
    && preview.affectedRefs.every(validRef)
    && preview.summaryCodes.length <= 32
    && preview.summaryCodes.every(code => SAFE_CODE.test(code))
    && preview.previewOnly === true
    && preview.verification.geometry === 'NOT_RUN'
    && preview.verification.topology === 'NOT_RUN'
    && preview.verification.manufacturing === 'NOT_RUN';
}

function withCapabilities(state: Omit<AiDesignPreviewLifecycleV1, 'applyEnabled' | 'rejectEnabled'>): AiDesignPreviewLifecycleV1 {
  return {
    ...state,
    applyEnabled: state.status === 'PREVIEW_READY' && !state.serverRefreshRequired,
    rejectEnabled: ['DRAFT', 'PREVIEWING', 'PREVIEW_READY'].includes(state.status),
  };
}

export function createAiDesignPreviewLifecycle(input: {
  projectId: string;
  sessionId: string;
  runtimeRevision: number;
  revisionToken: string;
}): AiDesignPreviewLifecycleV1 {
  if (!SAFE_ID.test(input.projectId) || !SAFE_ID.test(input.sessionId) || !SAFE_ID.test(input.revisionToken) || !validRevision(input.runtimeRevision)) throw new Error('preview_lifecycle_identity_invalid');
  return Object.freeze(withCapabilities({
    schema: AI_DESIGN_PREVIEW_LIFECYCLE_SCHEMA,
    projectId: input.projectId,
    sessionId: input.sessionId,
    authoritativeRuntimeRevision: input.runtimeRevision,
    authoritativeRevisionToken: input.revisionToken,
    status: 'IDLE',
    draft: null,
    preview: null,
    failureCode: null,
    preservedDraft: false,
    serverRefreshRequired: false,
    authority: {
      mutation: 'concept-session-only', previewIsNonPersistent: true, exactCadExecutionAllowed: false,
      browserCanAuthorVerificationPass: false, manufacturingReleaseReady: false,
    },
  }));
}

/** Advances a local concept-preview state machine; it never executes or verifies exact CAD. */
export function advanceAiDesignPreviewLifecycle(state: AiDesignPreviewLifecycleV1, action: AiDesignPreviewLifecycleAction): AiDesignPreviewLifecycleResult {
  if (state.schema !== AI_DESIGN_PREVIEW_LIFECYCLE_SCHEMA) return reject(state, 'preview_lifecycle_schema_invalid');
  if (action.type === 'RESET') {
    if (!['APPLIED', 'REJECTED', 'STALE', 'BLOCKED'].includes(state.status)) return reject(state, 'preview_reset_not_allowed');
    return result(withCapabilities({ ...state, status: 'IDLE', draft: null, preview: null, failureCode: null, preservedDraft: false, serverRefreshRequired: false }));
  }
  if (action.type === 'SERVER_STATE_CHANGED') {
    if (!validRevision(action.runtimeRevision) || !SAFE_ID.test(action.revisionToken) || action.runtimeRevision < state.authoritativeRuntimeRevision) return reject(state, 'preview_server_revision_invalid');
    if (action.runtimeRevision === state.authoritativeRuntimeRevision && action.revisionToken === state.authoritativeRevisionToken) return result(state);
    const active = ['DRAFT', 'PREVIEWING', 'PREVIEW_READY', 'APPLYING'].includes(state.status);
    return result(withCapabilities({
      ...state,
      authoritativeRuntimeRevision: action.runtimeRevision,
      authoritativeRevisionToken: action.revisionToken,
      status: active ? 'STALE' : state.status,
      failureCode: active ? 'server_revision_changed' : state.failureCode,
      preservedDraft: active && state.draft !== null,
      serverRefreshRequired: active,
      preview: active ? null : state.preview,
    }));
  }
  if (action.expectedRuntimeRevision !== state.authoritativeRuntimeRevision) return reject(state, 'preview_stale_revision');

  switch (action.type) {
    case 'BEGIN_DRAFT':
      if (!['IDLE', 'APPLIED', 'REJECTED'].includes(state.status)) return reject(state, 'preview_draft_not_allowed');
      if (!SAFE_ID.test(action.gaugeId) || !Number.isFinite(action.value) || !SAFE_UNIT.test(action.unit)) return reject(state, 'preview_draft_invalid');
      return result(withCapabilities({ ...state, status: 'DRAFT', draft: { gaugeId: action.gaugeId, initialValue: action.value, draftValue: action.value, unit: action.unit, dirty: false }, preview: null, failureCode: null, preservedDraft: false, serverRefreshRequired: false }));
    case 'UPDATE_DRAFT':
      if (state.status !== 'DRAFT' || !state.draft) return reject(state, 'preview_draft_missing');
      if (!Number.isFinite(action.value)) return reject(state, 'preview_value_invalid');
      return result(withCapabilities({ ...state, draft: { ...state.draft, draftValue: action.value, dirty: action.value !== state.draft.initialValue } }));
    case 'REQUEST_PREVIEW':
      if (state.status !== 'DRAFT' || !state.draft?.dirty) return reject(state, 'preview_dirty_draft_required');
      return result(withCapabilities({ ...state, status: 'PREVIEWING', preview: null, failureCode: null }));
    case 'RECEIVE_PREVIEW':
      if (state.status !== 'PREVIEWING' || !state.draft) return reject(state, 'preview_request_missing');
      if (!validPreview(action.preview, state)) return reject(state, 'preview_evidence_invalid');
      return result(withCapabilities({ ...state, status: 'PREVIEW_READY', preview: structuredClone(action.preview), failureCode: null }));
    case 'REQUEST_APPLY':
      if (state.status !== 'PREVIEW_READY' || !state.preview || !state.draft) return reject(state, 'preview_not_ready');
      if (!action.explicitConfirmation) return reject(state, 'preview_explicit_confirmation_required');
      return result(withCapabilities({ ...state, status: 'APPLYING', failureCode: null }));
    case 'APPLY_SUCCEEDED':
      if (state.status !== 'APPLYING' || !state.preview) return reject(state, 'preview_apply_not_running');
      if (!validRevision(action.nextRuntimeRevision) || action.nextRuntimeRevision <= state.authoritativeRuntimeRevision || !SAFE_ID.test(action.nextRevisionToken)) return reject(state, 'preview_apply_result_invalid');
      return result(withCapabilities({ ...state, authoritativeRuntimeRevision: action.nextRuntimeRevision, authoritativeRevisionToken: action.nextRevisionToken, status: 'APPLIED', draft: null, preview: null, failureCode: null, preservedDraft: false, serverRefreshRequired: true }));
    case 'SERVER_REFRESH_ACKNOWLEDGED':
      if (state.status !== 'APPLIED' || !state.serverRefreshRequired || action.revisionToken !== state.authoritativeRevisionToken) return reject(state, 'preview_server_refresh_invalid');
      return result(withCapabilities({ ...state, serverRefreshRequired: false }));
    case 'REJECT':
      if (!['DRAFT', 'PREVIEWING', 'PREVIEW_READY'].includes(state.status)) return reject(state, 'preview_reject_not_allowed');
      return result(withCapabilities({ ...state, status: 'REJECTED', draft: null, preview: null, failureCode: null, preservedDraft: false, serverRefreshRequired: false }));
    case 'BLOCK':
      if (!SAFE_CODE.test(action.failureCode)) return reject(state, 'preview_failure_code_invalid');
      return result(withCapabilities({ ...state, status: 'BLOCKED', preview: null, failureCode: action.failureCode, preservedDraft: state.draft !== null, serverRefreshRequired: false }));
  }
}

export function validateAiDesignPreviewLifecycle(state: AiDesignPreviewLifecycleV1): string[] {
  const issues: string[] = [];
  if (state.schema !== AI_DESIGN_PREVIEW_LIFECYCLE_SCHEMA) issues.push('preview_lifecycle_schema_invalid');
  if (!SAFE_ID.test(state.projectId) || !SAFE_ID.test(state.sessionId) || !SAFE_ID.test(state.authoritativeRevisionToken) || !validRevision(state.authoritativeRuntimeRevision)) issues.push('preview_lifecycle_binding_invalid');
  if (state.applyEnabled !== (state.status === 'PREVIEW_READY' && !state.serverRefreshRequired)) issues.push('preview_apply_capability_invalid');
  if (state.rejectEnabled !== ['DRAFT', 'PREVIEWING', 'PREVIEW_READY'].includes(state.status)) issues.push('preview_reject_capability_invalid');
  if (state.preview && !validPreview(state.preview, state)) issues.push('preview_evidence_invalid');
  if (state.authority.exactCadExecutionAllowed !== false || state.authority.browserCanAuthorVerificationPass !== false || state.authority.manufacturingReleaseReady !== false) issues.push('preview_authority_invalid');
  return issues;
}
