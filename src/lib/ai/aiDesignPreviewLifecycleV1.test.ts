import { describe, expect, it } from 'vitest';
import { advanceAiDesignPreviewLifecycle, createAiDesignPreviewLifecycle, validateAiDesignPreviewLifecycle, type AiDesignPreviewLifecycleV1 } from './aiDesignPreviewLifecycleV1';

const hash = (char: string) => char.repeat(64);

function advance(state: AiDesignPreviewLifecycleV1, action: Parameters<typeof advanceAiDesignPreviewLifecycle>[1]): AiDesignPreviewLifecycleV1 {
  const result = advanceAiDesignPreviewLifecycle(state, action);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function previewReady(): AiDesignPreviewLifecycleV1 {
  let state = createAiDesignPreviewLifecycle({ projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 4, revisionToken: 'rev-4' });
  state = advance(state, { type: 'BEGIN_DRAFT', expectedRuntimeRevision: 4, gaugeId: 'gauge-width', value: 40, unit: 'mm' });
  state = advance(state, { type: 'UPDATE_DRAFT', expectedRuntimeRevision: 4, value: 45 });
  state = advance(state, { type: 'REQUEST_PREVIEW', expectedRuntimeRevision: 4 });
  return advance(state, { type: 'RECEIVE_PREVIEW', expectedRuntimeRevision: 4, preview: {
    proposalId: 'proposal-1', proposalDigest: hash('a'), baseRuntimeRevision: 4, baseRevisionToken: 'rev-4',
    affectedRefs: [{ kind: 'dimension', id: 'dimension-width' }, { kind: 'parameter', id: 'parameter-width' }],
    summaryCodes: ['width_changed', 'drawing_update_required'], previewOnly: true,
    verification: { geometry: 'NOT_RUN', topology: 'NOT_RUN', manufacturing: 'NOT_RUN' },
  } });
}

describe('AI Design preview lifecycle V1', () => {
  it('moves a dirty gauge draft through preview and explicit concept apply', () => {
    let state = previewReady();
    expect(state).toMatchObject({ status: 'PREVIEW_READY', applyEnabled: true, rejectEnabled: true, authority: { exactCadExecutionAllowed: false, browserCanAuthorVerificationPass: false, manufacturingReleaseReady: false } });
    state = advance(state, { type: 'REQUEST_APPLY', expectedRuntimeRevision: 4, explicitConfirmation: true });
    state = advance(state, { type: 'APPLY_SUCCEEDED', expectedRuntimeRevision: 4, nextRuntimeRevision: 5, nextRevisionToken: 'rev-5' });
    expect(state).toMatchObject({ status: 'APPLIED', authoritativeRuntimeRevision: 5, authoritativeRevisionToken: 'rev-5', serverRefreshRequired: true, draft: null, preview: null });
    state = advance(state, { type: 'SERVER_REFRESH_ACKNOWLEDGED', expectedRuntimeRevision: 5, revisionToken: 'rev-5' });
    expect(state.serverRefreshRequired).toBe(false);
    expect(validateAiDesignPreviewLifecycle(state)).toEqual([]);
  });

  it('never treats preview evidence as exact verification and requires confirmation', () => {
    const state = previewReady();
    expect(state.preview?.verification).toEqual({ geometry: 'NOT_RUN', topology: 'NOT_RUN', manufacturing: 'NOT_RUN' });
    expect(advanceAiDesignPreviewLifecycle(state, { type: 'REQUEST_APPLY', expectedRuntimeRevision: 4, explicitConfirmation: false })).toEqual({ ok: false, error: 'preview_explicit_confirmation_required', state });
  });

  it('preserves only the draft and disables apply when a newer server revision arrives', () => {
    const state = advance(previewReady(), { type: 'SERVER_STATE_CHANGED', runtimeRevision: 5, revisionToken: 'rev-5' });
    expect(state).toMatchObject({ status: 'STALE', preservedDraft: true, serverRefreshRequired: true, applyEnabled: false, preview: null });
    expect(advanceAiDesignPreviewLifecycle(state, { type: 'REQUEST_APPLY', expectedRuntimeRevision: 5, explicitConfirmation: true })).toMatchObject({ ok: false, error: 'preview_not_ready' });
  });

  it('rejects clean previews, stale commands, forged PASS and invalid apply results', () => {
    let state = createAiDesignPreviewLifecycle({ projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 4, revisionToken: 'rev-4' });
    state = advance(state, { type: 'BEGIN_DRAFT', expectedRuntimeRevision: 4, gaugeId: 'gauge-width', value: 40, unit: 'mm' });
    expect(advanceAiDesignPreviewLifecycle(state, { type: 'REQUEST_PREVIEW', expectedRuntimeRevision: 4 })).toMatchObject({ ok: false, error: 'preview_dirty_draft_required' });
    expect(advanceAiDesignPreviewLifecycle(state, { type: 'UPDATE_DRAFT', expectedRuntimeRevision: 3, value: 45 })).toMatchObject({ ok: false, error: 'preview_stale_revision' });
    const forged = { proposalId: 'proposal-1', proposalDigest: hash('a'), baseRuntimeRevision: 4, baseRevisionToken: 'rev-4', affectedRefs: [], summaryCodes: [], previewOnly: true as const, verification: { geometry: 'PASS', topology: 'NOT_RUN', manufacturing: 'NOT_RUN' } };
    state = advance(state, { type: 'UPDATE_DRAFT', expectedRuntimeRevision: 4, value: 45 });
    state = advance(state, { type: 'REQUEST_PREVIEW', expectedRuntimeRevision: 4 });
    expect(advanceAiDesignPreviewLifecycle(state, { type: 'RECEIVE_PREVIEW', expectedRuntimeRevision: 4, preview: forged as never })).toMatchObject({ ok: false, error: 'preview_evidence_invalid' });
  });
});
