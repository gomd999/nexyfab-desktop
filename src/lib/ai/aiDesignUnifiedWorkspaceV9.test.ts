import { describe, expect, it } from 'vitest';
import { dispatchAiDesignChatAction } from './aiDesignChatActionCards';
import { preview2dTo3dImpact, type StableSyncRef } from './aiDesign2d3dSync';
import { createAiDesignUnifiedWorkspaceV9, validateAiDesignUnifiedWorkspaceV9, type AiDesignUnifiedWorkspaceSourceV9 } from './aiDesignUnifiedWorkspaceV9';

const ref = (kind: StableSyncRef['kind'], id: string): StableSyncRef => ({ kind, id });
const recovery = { state: 'online' as const, blocking: false, title: 'Online', message: 'Synchronized.', safeActions: [], mutationEnabled: true };

function source(region: AiDesignUnifiedWorkspaceSourceV9['workspace']['base']['layout']['primaryRegion'] = 'comparison', mode: 'desktop' | 'mobile' = 'desktop'): AiDesignUnifiedWorkspaceSourceV9 {
  return {
    projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 7, complexRevision: 3, staleAgainstRuntime: false,
    inputKinds: ['text', 'drawing_2d'],
    workspace: {
      base: {
        layout: { mode, primaryRegion: region, mobileSheet: mode === 'mobile' ? 'candidates' : null, stickyPrimaryAction: mode === 'mobile' },
        model: { publicModelId: 'gpt-luna', selectionStatus: 'selected', explanation: ['Selected for bounded concept work.'], exactGeometryAuthority: false },
        intent: { questions: [] }, generation: { status: 'CANDIDATE_READY', currentStage: null, failure: null },
        candidates: { visible: true, selectedCandidateId: 'candidate-1' },
        gauges: [{ gaugeId: 'gauge-1', label: 'Width', targetValue: 40, unit: 'mm', requiresConfirmation: true }],
        primaryAction: { command: 'SELECT_CANDIDATE', label: 'Select', enabled: true, reason: null },
        trust: { conceptOnly: true, precisionVerification: 'NOT_RUN', manufacturingReleaseReady: false },
      },
      assemblyGauges: [{ gaugeId: 'gauge-1', parameterId: 'parameter-width', label: 'Width', targetValue: 40, unit: 'mm' }],
      candidateEvaluations: [{ candidateId: 'candidate-1', status: 'PASS', conceptReviewReady: true }],
    },
    precision: { status: 'NOT_RUN', requestIds: [], receiptIds: [], manufacturingReleaseReady: false },
  };
}

describe('AI Design unified chat-first workspace V9', () => {
  it('composes chat, synchronized split canvas, model and executable candidate card', () => {
    const value = createAiDesignUnifiedWorkspaceV9(source(), {
      recovery,
      locale: 'ko',
      twoDToThreeD: [{ source: ref('dimension', 'dimension-width'), targets: [ref('parameter', 'parameter-width')] }],
      threeDToTwoD: [{ source: ref('parameter', 'parameter-width'), targets: [ref('dimension', 'dimension-width')] }],
    });
    expect(value).toMatchObject({ chat: { layout: 'desktop_split', stage: 'candidates' }, canvas: { activeMode: 'split', desktopSideBySide: true, linkedSelection: true, mappingStatus: 'ready' } });
    expect(validateAiDesignUnifiedWorkspaceV9(value)).toEqual([]);
    expect(dispatchAiDesignChatAction({ card: value.cards[0]!, actionId: 'SELECT_CANDIDATE', effectId: 'effect-select', expectedRuntimeRevision: 7 })).toMatchObject({ ok: true, effect: { mutation: 'session-only', boundary: 'ai-design-runtime' } });
    expect(preview2dTo3dImpact(value.sync, [ref('dimension', 'dimension-width')])).toMatchObject({ status: 'SYNCED', previewOnly: true, targets: [ref('parameter', 'parameter-width')] });
  });

  it('starts mobile in chat with 2D/3D tabs, full-screen canvas and bottom sheet', () => {
    const value = createAiDesignUnifiedWorkspaceV9(source('editing', 'mobile'), { recovery, locale: 'ko' });
    expect(value).toMatchObject({
      chat: { layout: 'mobile_chat_first', regions: { chat: 'primary' } },
      canvas: { activeMode: '3d', mobileTabs: ['2d', '3d'], mappingStatus: 'awaiting_precision_binding' },
      mobile: { startsInChat: true, canvasPresentation: 'full-screen', inspectorPresentation: 'modal-bottom-sheet', stickyPreviewApplyCancel: true },
    });
    expect(value.cards[0]).toMatchObject({ kind: 'change_preview', actions: [{ id: 'PREVIEW_CHANGE', enabled: true, primary: true }] });
  });

  it('turns ambiguous or stale state into explicit recovery instead of a hidden commit', () => {
    const value = createAiDesignUnifiedWorkspaceV9({ ...source(), staleAgainstRuntime: true }, {
      locale: 'en', recovery: { state: 'stale_revision', blocking: true, title: 'Newer revision', message: 'Refresh before editing.', safeActions: ['REFRESH_SERVER_STATE'], mutationEnabled: false },
    });
    expect(value.cards[0]).toMatchObject({ kind: 'recovery', status: 'blocked', actions: [{ id: 'REFRESH_SERVER_STATE', primary: true }] });
    expect(value.sync.commitAllowed).toBe(false);
    expect(value.authority.manufacturingReleaseReady).toBe(false);
  });
});
