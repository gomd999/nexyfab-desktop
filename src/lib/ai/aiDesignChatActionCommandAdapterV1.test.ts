import { describe, expect, it } from 'vitest';
import { createAiDesignChatActionCard, dispatchAiDesignChatAction, type AiDesignChatActionV1 } from './aiDesignChatActionCards';
import { adaptAiDesignChatActionCommandV1 } from './aiDesignChatActionCommandAdapterV1';

const action = (id: AiDesignChatActionV1['id']): AiDesignChatActionV1 => ({ id, label: id, enabled: true, reason: null, primary: true, requiresConfirmation: id === 'APPLY_CONCEPT_CHANGE' || id === 'REQUEST_PRECISION' });

function effect(id: AiDesignChatActionV1['id'], references: { candidateId?: string | null; gaugeId?: string | null; proposalId?: string | null } = {}) {
  const card = createAiDesignChatActionCard({ cardId: 'card:1', projectId: 'project:1', sessionId: 'session:1', runtimeRevision: 4, kind: id === 'REQUEST_PRECISION' ? 'verification' : 'guidance', title: 'Action', summary: 'Action summary', status: 'ready', references: { questionId: null, candidateId: references.candidateId === undefined ? 'candidate:1' : references.candidateId, gaugeId: references.gaugeId === undefined ? 'gauge:1' : references.gaugeId, proposalId: references.proposalId === undefined ? 'proposal:1' : references.proposalId, verificationReceiptId: null }, actions: [action(id)] });
  const dispatched = dispatchAiDesignChatAction({ card, actionId: id, effectId: `effect:${id}`, expectedRuntimeRevision: 4 });
  if (!dispatched.ok) throw new Error(dispatched.error);
  return dispatched.effect;
}

describe('AI Design chat action command adapter V1', () => {
  it('maps a candidate CTA into a revision-bound V2 request', () => {
    const result = adaptAiDesignChatActionCommandV1(effect('SELECT_CANDIDATE'), { currentRuntimeRevision: 4, issuedAt: '2026-08-24T00:00:00.000Z' });
    expect(result).toMatchObject({ ok: true, output: { kind: 'server-request', referenceId: 'candidate:1', command: { type: 'SELECT_CANDIDATE', expectedRuntimeRevision: 4 } } });
  });
  it('keeps previews nonpersistent and requires explicit concept commit', () => {
    expect(adaptAiDesignChatActionCommandV1(effect('PREVIEW_CHANGE'), { currentRuntimeRevision: 4 })).toMatchObject({ ok: true, output: { kind: 'concept-preview-request', gaugeId: 'gauge:1', previewOnly: true, persistent: false, exactExecution: false } });
    expect(adaptAiDesignChatActionCommandV1(effect('APPLY_CONCEPT_CHANGE'), { currentRuntimeRevision: 4 })).toMatchObject({ ok: true, output: { kind: 'concept-apply-request', proposalId: 'proposal:1', explicitConfirmationRequired: true, mutation: 'concept-session-only', exactExecution: false } });
  });
  it('produces only a Precision handoff and never a PASS/execution result', () => {
    expect(adaptAiDesignChatActionCommandV1(effect('REQUEST_PRECISION'), { currentRuntimeRevision: 4, currentComplexRevision: 2 })).toMatchObject({ ok: true, output: { kind: 'precision-cad-handoff', candidateId: 'candidate:1', expectedComplexRevision: 2, exactExecution: false, verificationPass: false, manufacturingReleaseReady: false } });
  });
  it('fails closed for stale revisions, missing references, and authority escalation', () => {
    expect(adaptAiDesignChatActionCommandV1(effect('SELECT_CANDIDATE'), { currentRuntimeRevision: 5 })).toEqual({ ok: false, error: 'chat_adapter_stale_revision' });
    expect(adaptAiDesignChatActionCommandV1({ ...effect('REQUEST_PRECISION'), referenceId: null }, { currentRuntimeRevision: 4 })).toEqual({ ok: false, error: 'chat_adapter_precision_boundary_invalid' });
    expect(adaptAiDesignChatActionCommandV1({ ...effect('ADD_INPUT'), exactGeometryAuthority: true } as never, { currentRuntimeRevision: 4 })).toEqual({ ok: false, error: 'chat_adapter_authority_escalation' });
  });
});
