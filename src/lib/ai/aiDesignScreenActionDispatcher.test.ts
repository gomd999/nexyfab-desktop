import { describe, expect, it } from 'vitest';
import { dispatchAiDesignScreenAction } from './aiDesignScreenActionDispatcher';
import type { AiDesignScreenActionId, AiDesignScreenBindingV1 } from './aiDesignScreenBinding';

const ids: AiDesignScreenActionId[] = ['select-model', 'provide-input', 'generate', 'select-candidate', 'apply-candidate', 'open-numeric-input', 'preview-direct-edit', 'confirm-direct-edit', 'request-precision', 'inspect-verification', 'cancel', 'resume'];
const binding = (enabled = true): AiDesignScreenBindingV1 => ({
  schema: 'nexyfab.ai-design-screen-binding.v1', projectId: 'project-1', revisionToken: 'rev-1', mode: 'desktop',
  regions: [], modelSelector: { selectedModelId: 'gpt-luna', mode: 'auto', fallbackVisible: false, changeEnabled: true },
  gaugeOverlay: { visible: true, primaryGaugeId: 'gauge-1', numericInputAvailable: true, confirmationRequired: false },
  precisionBadge: { status: 'NOT_RUN', authoritative: false },
  actions: ids.map(id => ({ id, enabled, ...(!enabled ? { reason: 'blocked_by_workspace' } : {}) })),
  safeguards: { explicitCommitRequired: true, previewIsNonPersistent: true, staleDisablesMutation: false, exactCadBoundary: 'precision-cad' },
});

describe('AI Design screen action dispatcher', () => {
  it('maps all rendered actions to an explicit ownership boundary', () => {
    const contexts = { candidateId: 'candidate-1', gaugeId: 'gauge-1', proposalId: 'proposal-1' };
    for (const actionId of ids) {
      const result = dispatchAiDesignScreenAction({ binding: binding(), actionId, effectId: `effect:${actionId}`, expectedRuntimeRevision: 4, references: contexts });
      expect(result).toMatchObject({ ok: true, effect: { actionId, projectId: 'project-1', preservesCadSelection: true } });
    }
  });

  it('keeps preview non-persistent and routes exact requests only to Precision CAD', () => {
    expect(dispatchAiDesignScreenAction({ binding: binding(), actionId: 'preview-direct-edit', effectId: 'preview-1', expectedRuntimeRevision: 1, references: { gaugeId: 'gauge-1' } })).toMatchObject({ ok: true, effect: { boundary: 'ai-design-runtime', mutation: 'preview-only' } });
    expect(dispatchAiDesignScreenAction({ binding: binding(), actionId: 'confirm-direct-edit', effectId: 'commit-1', expectedRuntimeRevision: 1, references: { proposalId: 'proposal-1' } })).toMatchObject({ ok: true, effect: { boundary: 'precision-cad', mutation: 'exact-cad-request', explicitCommitRequired: true } });
  });

  it('fails closed for disabled actions and missing target references', () => {
    expect(dispatchAiDesignScreenAction({ binding: binding(false), actionId: 'generate', effectId: 'generate-1', expectedRuntimeRevision: 1 })).toEqual({ ok: false, error: 'blocked_by_workspace' });
    expect(dispatchAiDesignScreenAction({ binding: binding(), actionId: 'select-candidate', effectId: 'candidate-1', expectedRuntimeRevision: 1 })).toEqual({ ok: false, error: 'screen_effect_reference_required:candidateId' });
  });
});
