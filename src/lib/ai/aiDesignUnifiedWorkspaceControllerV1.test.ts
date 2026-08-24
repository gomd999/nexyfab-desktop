import { describe, expect, it } from 'vitest';
import { createAiDesignChatActionCard, dispatchAiDesignChatAction, type AiDesignChatActionId } from './aiDesignChatActionCards';
import { createAiDesignUnifiedWorkspaceV9, type AiDesignUnifiedWorkspaceSourceV9 } from './aiDesignUnifiedWorkspaceV9';
import {
  createAiDesignServerRevisionTokenV1,
  createAiDesignUnifiedWorkspaceControllerV1,
  reduceAiDesignUnifiedWorkspaceControllerV1,
  validateAiDesignUnifiedWorkspaceControllerV1,
  type AiDesignUnifiedWorkspaceControllerV1,
} from './aiDesignUnifiedWorkspaceControllerV1';
import type { UnifiedWorkspaceServerSnapshotV1 } from './aiDesignUnifiedWorkspaceClientStateV1';

const source: AiDesignUnifiedWorkspaceSourceV9 = {
  projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 4, complexRevision: 2, staleAgainstRuntime: false, inputKinds: ['text'],
  workspace: { base: { layout: { mode: 'desktop', primaryRegion: 'editing', mobileSheet: null, stickyPrimaryAction: false }, model: { publicModelId: 'model-1', selectionStatus: 'selected', explanation: [], exactGeometryAuthority: false }, intent: { questions: [] }, generation: { status: 'CANDIDATE_READY', currentStage: null, failure: null }, candidates: { visible: true, selectedCandidateId: 'candidate-1' }, gauges: [{ gaugeId: 'gauge-width', label: 'Width', targetValue: 40, unit: 'mm', requiresConfirmation: true }], primaryAction: null, trust: { conceptOnly: true, precisionVerification: 'NOT_RUN', manufacturingReleaseReady: false } }, assemblyGauges: [], candidateEvaluations: [] },
  precision: { status: 'NOT_RUN', requestIds: [], receiptIds: [], manufacturingReleaseReady: false },
};

const server = (runtimeRevision = 4, complexRevision = 2): UnifiedWorkspaceServerSnapshotV1 => ({
  projectId: 'project-1', sessionId: 'session-1', runtimeRevision, complexRevision,
  source: { ...source, runtimeRevision, complexRevision },
  workspace: createAiDesignUnifiedWorkspaceV9({ ...source, runtimeRevision, complexRevision }, { recovery: { state: 'online', blocking: false, title: 'Online', message: '', safeActions: [], mutationEnabled: true } }),
});

function effect(actionId: AiDesignChatActionId, reference: 'gauge' | 'proposal' | 'candidate') {
  const card = createAiDesignChatActionCard({
    cardId: `card-${actionId}`, projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 4,
    kind: actionId === 'REQUEST_PRECISION' ? 'verification' : actionId === 'APPLY_CONCEPT_CHANGE' ? 'change_preview' : 'guidance',
    title: 'Bounded action', summary: 'Synthetic controller fixture', status: 'ready',
    references: { questionId: null, candidateId: reference === 'candidate' ? 'candidate-1' : null, gaugeId: reference === 'gauge' ? 'gauge-width' : null, proposalId: reference === 'proposal' ? 'proposal-1' : null, verificationReceiptId: null },
    actions: [{ id: actionId, label: actionId, enabled: true, reason: null, primary: true, requiresConfirmation: actionId === 'APPLY_CONCEPT_CHANGE' || actionId === 'REQUEST_PRECISION' }],
  });
  const result = dispatchAiDesignChatAction({ card, actionId, effectId: `effect-${actionId}`, expectedRuntimeRevision: 4 });
  if (!result.ok) throw new Error(result.error);
  return result.effect;
}

function step(state: AiDesignUnifiedWorkspaceControllerV1, event: Parameters<typeof reduceAiDesignUnifiedWorkspaceControllerV1>[1]) {
  const result = reduceAiDesignUnifiedWorkspaceControllerV1(state, event);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function previewReady(): AiDesignUnifiedWorkspaceControllerV1 {
  let state = createAiDesignUnifiedWorkspaceControllerV1(server());
  state = step(state, { type: 'BEGIN_GAUGE_DRAFT', draft: { id: 'draft-1', baseRuntimeRevision: 4, gaugeId: 'gauge-width', value: 40, unit: 'mm' } });
  state = step(state, { type: 'UPDATE_GAUGE_DRAFT', value: 45 });
  state = step(state, { type: 'DISPATCH_CHAT_EFFECT', effect: effect('PREVIEW_CHANGE', 'gauge') });
  return step(state, { type: 'PREVIEW_RECEIVED', requestId: 'effect-PREVIEW_CHANGE', evidence: {
    proposalId: 'proposal-1', proposalDigest: 'a'.repeat(64), baseRuntimeRevision: 4,
    baseRevisionToken: createAiDesignServerRevisionTokenV1(server()), affectedRefs: [{ kind: 'dimension', id: 'dimension-width' }],
    summaryCodes: ['width_changed'], previewOnly: true,
    verification: { geometry: 'NOT_RUN', topology: 'NOT_RUN', manufacturing: 'NOT_RUN' },
  } });
}

describe('AI Design unified workspace controller V1', () => {
  it('coordinates a nonpersistent draft and exact-free preview', () => {
    const state = previewReady();
    expect(state).toMatchObject({ preview: { status: 'PREVIEW_READY', applyEnabled: true }, pending: null, capabilities: { conceptApplyEnabled: true, exactCadExecutionAllowed: false, browserCanAuthorVerificationPass: false, manufacturingReleaseReady: false } });
    expect(state.client.server.runtimeRevision).toBe(4);
    expect(validateAiDesignUnifiedWorkspaceControllerV1(state)).toEqual([]);
  });

  it('requires explicit confirmation and a matching server completion to apply', () => {
    const ready = previewReady();
    expect(reduceAiDesignUnifiedWorkspaceControllerV1(ready, { type: 'DISPATCH_CHAT_EFFECT', effect: effect('APPLY_CONCEPT_CHANGE', 'proposal') })).toMatchObject({ ok: false, error: 'controller_explicit_confirmation_required' });
    let applying = step(ready, { type: 'DISPATCH_CHAT_EFFECT', effect: effect('APPLY_CONCEPT_CHANGE', 'proposal'), explicitConfirmation: true });
    expect(applying.preview.status).toBe('APPLYING');
    applying = step(applying, { type: 'SERVER_SNAPSHOT_RECEIVED', snapshot: server(5, 3), completedRequestId: 'effect-APPLY_CONCEPT_CHANGE' });
    expect(applying).toMatchObject({ preview: { status: 'APPLIED', authoritativeRuntimeRevision: 5, serverRefreshRequired: false }, client: { server: { runtimeRevision: 5, complexRevision: 3 }, previewDraft: null }, capabilities: { mutationEnabled: true } });
  });

  it('marks an active preview stale when another server revision arrives', () => {
    const state = step(previewReady(), { type: 'SERVER_SNAPSHOT_RECEIVED', snapshot: server(5, 2) });
    expect(state).toMatchObject({ preview: { status: 'STALE', preservedDraft: true, applyEnabled: false }, client: { previewDraft: null }, capabilities: { mutationEnabled: false } });
  });

  it('blocks mutations offline and emits only a revision-bound Precision handoff', () => {
    const initial = createAiDesignUnifiedWorkspaceControllerV1(server());
    const offline = step(initial, { type: 'CONNECTIVITY_CHANGED', connectivity: 'offline', message: 'offline' });
    expect(reduceAiDesignUnifiedWorkspaceControllerV1(offline, { type: 'BEGIN_GAUGE_DRAFT', draft: { id: 'draft-1', baseRuntimeRevision: 4, gaugeId: 'gauge-width', value: 40, unit: 'mm' } })).toMatchObject({ ok: false });
    const precision = step(initial, { type: 'DISPATCH_CHAT_EFFECT', effect: effect('REQUEST_PRECISION', 'candidate'), explicitConfirmation: true });
    expect(precision.pending).toMatchObject({ kind: 'precision-cad-handoff', expectedRuntimeRevision: 4, expectedComplexRevision: 2, exactExecution: false, verificationPass: false, manufacturingReleaseReady: false });
  });
});
