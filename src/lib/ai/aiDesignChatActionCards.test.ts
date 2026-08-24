import { describe, expect, it } from 'vitest';
import {
  createAiDesignChatActionCard,
  dispatchAiDesignChatAction,
  type AiDesignChatActionV1,
} from './aiDesignChatActionCards';

const action = (value: Partial<AiDesignChatActionV1> & Pick<AiDesignChatActionV1, 'id' | 'label'>): AiDesignChatActionV1 => ({
  enabled: true,
  reason: null,
  primary: false,
  requiresConfirmation: ['APPLY_CONCEPT_CHANGE', 'REQUEST_PRECISION'].includes(value.id),
  ...value,
});

function card() {
  return createAiDesignChatActionCard({
    cardId: 'card:preview-1',
    projectId: 'project-1',
    sessionId: 'session-1',
    runtimeRevision: 4,
    kind: 'change_preview',
    title: 'Preview width change',
    summary: 'Review synchronized 2D and 3D impacts before applying the concept change.',
    status: 'ready',
    references: { questionId: null, candidateId: 'candidate-1', gaugeId: 'gauge-1', proposalId: 'proposal-1', verificationReceiptId: null },
    actions: [
      action({ id: 'PREVIEW_CHANGE', label: 'Preview', primary: true }),
      action({ id: 'APPLY_CONCEPT_CHANGE', label: 'Apply concept change' }),
      action({ id: 'REQUEST_PRECISION', label: 'Send to Precision CAD' }),
    ],
  });
}

describe('AI Design chat action cards', () => {
  it('keeps one recommended action and exposes the concept/exact authority boundary', () => {
    const value = card();
    expect(value.actions.filter(item => item.primary && item.enabled)).toHaveLength(1);
    expect(value.authority).toEqual({ conceptOnly: true, previewIsNonPersistent: true, exactCadBoundary: 'precision-cad', manufacturingReleaseReady: false });
  });

  it('routes preview, concept apply and exact requests to distinct boundaries', () => {
    expect(dispatchAiDesignChatAction({ card: card(), actionId: 'PREVIEW_CHANGE', effectId: 'effect-preview', expectedRuntimeRevision: 4 })).toMatchObject({ ok: true, effect: { boundary: 'ai-design-runtime', mutation: 'preview-only', explicitCommitRequired: false } });
    expect(dispatchAiDesignChatAction({ card: card(), actionId: 'APPLY_CONCEPT_CHANGE', effectId: 'effect-apply', expectedRuntimeRevision: 4 })).toMatchObject({ ok: true, effect: { boundary: 'ai-design-runtime', mutation: 'session-only', explicitCommitRequired: true, exactGeometryAuthority: false } });
    expect(dispatchAiDesignChatAction({ card: card(), actionId: 'REQUEST_PRECISION', effectId: 'effect-precision', expectedRuntimeRevision: 4 })).toMatchObject({ ok: true, effect: { boundary: 'precision-cad', mutation: 'exact-cad-request', manufacturingReleaseReady: false } });
  });

  it('fails closed for stale cards and missing exact-request references', () => {
    expect(dispatchAiDesignChatAction({ card: card(), actionId: 'PREVIEW_CHANGE', effectId: 'effect-stale', expectedRuntimeRevision: 5 })).toEqual({ ok: false, error: 'chat_card_stale_revision' });
    const missing = createAiDesignChatActionCard({
      cardId: 'card:missing', projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 1,
      kind: 'verification', title: 'Verify', summary: 'Send the selected concept to Precision CAD.', status: 'attention',
      references: { questionId: null, candidateId: null, gaugeId: null, proposalId: null, verificationReceiptId: null },
      actions: [action({ id: 'REQUEST_PRECISION', label: 'Send to Precision CAD', primary: true })],
    });
    expect(dispatchAiDesignChatAction({ card: missing, actionId: 'REQUEST_PRECISION', effectId: 'effect-missing', expectedRuntimeRevision: 1 })).toEqual({ ok: false, error: 'chat_action_reference_required:candidateId' });
  });

  it('rejects ambiguous primary actions and confirmation-policy drift', () => {
    expect(() => createAiDesignChatActionCard({
      cardId: 'card:bad', projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 1,
      kind: 'guidance', title: 'Choose', summary: 'Choose one next step.', status: 'ready',
      references: { questionId: null, candidateId: null, gaugeId: null, proposalId: null, verificationReceiptId: null },
      actions: [action({ id: 'OPEN_COMPARISON', label: 'Compare', primary: true }), action({ id: 'RESUME', label: 'Resume', primary: true })],
    })).toThrow('chat_card_primary_action_ambiguous');
    expect(() => createAiDesignChatActionCard({
      cardId: 'card:bad-policy', projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 1,
      kind: 'candidate', title: 'Apply', summary: 'Apply a concept change.', status: 'ready',
      references: { questionId: null, candidateId: null, gaugeId: null, proposalId: 'proposal-1', verificationReceiptId: null },
      actions: [action({ id: 'APPLY_CONCEPT_CHANGE', label: 'Apply', requiresConfirmation: false })],
    })).toThrow('chat_card_confirmation_policy_invalid');
  });
});
