import { describe, expect, it } from 'vitest';
import { createAiDesignUnifiedWorkspaceV9, type AiDesignUnifiedWorkspaceSourceV9 } from './aiDesignUnifiedWorkspaceV9';
import { assertUnifiedWorkspaceClientStateV1, createUnifiedWorkspaceClientStateV1, reduceUnifiedWorkspaceClientStateV1, type UnifiedWorkspaceServerSnapshotV1 } from './aiDesignUnifiedWorkspaceClientStateV1';

const source: AiDesignUnifiedWorkspaceSourceV9 = {
  projectId: 'p1', sessionId: 's1', runtimeRevision: 2, complexRevision: 1, staleAgainstRuntime: false, inputKinds: ['text'],
  workspace: { base: { layout: { mode: 'desktop', primaryRegion: 'comparison', mobileSheet: null, stickyPrimaryAction: false }, model: { publicModelId: 'model-a', selectionStatus: 'selected', explanation: [], exactGeometryAuthority: false }, intent: { questions: [] }, generation: { status: 'CANDIDATE_READY', currentStage: null, failure: null }, candidates: { visible: true, selectedCandidateId: 'c1' }, gauges: [{ gaugeId: 'g1', label: 'Width', targetValue: 10, unit: 'mm', requiresConfirmation: true }], primaryAction: null, trust: { conceptOnly: true, precisionVerification: 'NOT_RUN', manufacturingReleaseReady: false } }, assemblyGauges: [], candidateEvaluations: [] },
  precision: { status: 'NOT_RUN', requestIds: [], receiptIds: [], manufacturingReleaseReady: false },
};
const recovery = { state: 'online' as const, blocking: false, title: 'Online', message: '', safeActions: [], mutationEnabled: true };
const server = (revision = 2, complexRevision = 1): UnifiedWorkspaceServerSnapshotV1 => {
  const nextSource = { ...source, runtimeRevision: revision, complexRevision };
  return { projectId: 'p1', sessionId: 's1', runtimeRevision: revision, complexRevision, source: nextSource, workspace: createAiDesignUnifiedWorkspaceV9(nextSource, { recovery }) };
};
const complexServer = (complexRevision: number): UnifiedWorkspaceServerSnapshotV1 => server(2, complexRevision);

describe('UnifiedWorkspaceClientStateV1', () => {
  it('keeps local view, selection, model fallback and preview separate', () => {
    let state = createUnifiedWorkspaceClientStateV1(server(), { selection: { kind: 'candidate', id: 'c1' }, modelFallbackContext: ['model-a', 'model-b'] });
    state = reduceUnifiedWorkspaceClientStateV1(state, { type: 'VIEW_CHANGED', canvasMode: '3d', panel: 'canvas' }).state;
    state = reduceUnifiedWorkspaceClientStateV1(state, { type: 'PREVIEW_STARTED', draft: { id: 'd1', baseRuntimeRevision: 2, gaugeId: 'g1', value: 10, unit: 'mm' } }).state;
    expect(state.localView).toMatchObject({ canvasMode: '3d', selection: { id: 'c1' }, modelFallbackContext: ['model-a', 'model-b'] });
    expect(state.previewDraft).toMatchObject({ id: 'd1', dirty: false });
    expect(state.server.runtimeRevision).toBe(2);
  });
  it('rejects stale or foreign snapshots without losing local context', () => {
    const initial = createUnifiedWorkspaceClientStateV1(server(), { canvasMode: '2d', selection: { kind: 'face', id: 'f1' } });
    const stale = reduceUnifiedWorkspaceClientStateV1(initial, { type: 'SERVER_SNAPSHOT_RECEIVED', snapshot: server(1) });
    expect(stale).toMatchObject({ accepted: false, error: 'stale_server_snapshot' });
    expect(stale.state).toBe(initial);
    const foreign = reduceUnifiedWorkspaceClientStateV1(initial, { type: 'SERVER_SNAPSHOT_RECEIVED', snapshot: { ...server(3), projectId: 'other' } });
    expect(foreign.error).toBe('identity_mismatch');
    expect(foreign.state.localView.selection).toEqual({ kind: 'face', id: 'f1' });
  });
  it('blocks preview mutation offline and asserts authority boundary', () => {
    const initial = createUnifiedWorkspaceClientStateV1(server());
    const offline = reduceUnifiedWorkspaceClientStateV1(initial, { type: 'CONNECTIVITY_CHANGED', connectivity: 'offline', message: 'Disconnected' });
    expect(offline.state.recovery.mutationBlocked).toBe(true);
    expect(reduceUnifiedWorkspaceClientStateV1(offline.state, { type: 'PREVIEW_STARTED', draft: { id: 'd1', baseRuntimeRevision: 2, gaugeId: 'g1', value: 10, unit: 'mm' } }).accepted).toBe(false);
    expect(() => assertUnifiedWorkspaceClientStateV1({ ...initial, localView: { ...initial.localView, exactCad: true } } as never)).toThrow('local_authority_forbidden');
    expect(createAiDesignUnifiedWorkspaceV9(source, { recovery }).authority.manufacturingReleaseReady).toBe(false);
  });
  it('accepts a newer complex revision, discards an uncommitted preview, and rejects invalid selections', () => {
    let state = createUnifiedWorkspaceClientStateV1(server());
    state = reduceUnifiedWorkspaceClientStateV1(state, { type: 'PREVIEW_STARTED', draft: { id: 'd1', baseRuntimeRevision: 2, gaugeId: 'g1', value: 10, unit: 'mm' } }).state;
    const refreshed = reduceUnifiedWorkspaceClientStateV1(state, { type: 'SERVER_SNAPSHOT_RECEIVED', snapshot: complexServer(2) });
    expect(refreshed).toMatchObject({ accepted: true, state: { server: { runtimeRevision: 2, complexRevision: 2 }, previewDraft: null, recovery: { message: 'uncommitted_preview_discarded' } } });
    expect(reduceUnifiedWorkspaceClientStateV1(refreshed.state, { type: 'SELECTION_CHANGED', selection: { kind: 'feature', id: '../bad' } })).toMatchObject({ accepted: false, error: 'invalid_event' });
  });
});
