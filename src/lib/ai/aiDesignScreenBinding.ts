import type {
  AiDesignWorkspaceViewModel,
  WorkspacePanelState,
  WorkspaceVerificationState,
} from './aiDesignWorkspaceViewModel';

export const AI_DESIGN_SCREEN_BINDING_SCHEMA = 'nexyfab.ai-design-screen-binding.v1' as const;

export type AiDesignScreenRegionId =
  | 'header'
  | 'intake'
  | 'canvas'
  | 'candidates'
  | 'assistant'
  | 'verification'
  | 'action_bar'
  | 'mobile_sheet';

export type AiDesignScreenActionId =
  | 'select-model'
  | 'provide-input'
  | 'generate'
  | 'select-candidate'
  | 'apply-candidate'
  | 'open-numeric-input'
  | 'preview-direct-edit'
  | 'confirm-direct-edit'
  | 'request-precision'
  | 'inspect-verification'
  | 'cancel'
  | 'resume';

export interface AiDesignScreenBindingV1 {
  schema: typeof AI_DESIGN_SCREEN_BINDING_SCHEMA;
  projectId: string;
  revisionToken: string;
  mode: 'desktop' | 'mobile';
  regions: ReadonlyArray<{
    id: AiDesignScreenRegionId;
    visible: boolean;
    state: WorkspacePanelState | 'ready';
  }>;
  modelSelector: {
    selectedModelId: string | null;
    mode: string | null;
    fallbackVisible: boolean;
    changeEnabled: boolean;
  };
  gaugeOverlay: {
    visible: boolean;
    primaryGaugeId: string | null;
    numericInputAvailable: boolean;
    confirmationRequired: boolean;
  };
  precisionBadge: {
    status: WorkspaceVerificationState;
    authoritative: boolean;
  };
  actions: ReadonlyArray<{ id: AiDesignScreenActionId; enabled: boolean; reason?: string }>;
  safeguards: {
    explicitCommitRequired: true;
    previewIsNonPersistent: true;
    staleDisablesMutation: boolean;
    exactCadBoundary: 'precision-cad';
  };
}

function regionState(view: AiDesignWorkspaceViewModel, id: AiDesignScreenRegionId): WorkspacePanelState | 'ready' {
  if (id === 'intake') return view.panels.intake;
  if (id === 'candidates') return view.panels.candidates;
  if (id === 'verification') return view.panels.verification;
  if (id === 'assistant') return view.safety === 'BLOCKED' ? 'blocked' : view.safety === 'ATTENTION' ? 'attention' : 'ready';
  return 'ready';
}

function visibleRegions(view: AiDesignWorkspaceViewModel): AiDesignScreenRegionId[] {
  if (view.presentation.mode === 'mobile') return ['header', 'canvas', 'action_bar', 'mobile_sheet'];
  return ['header', 'intake', 'canvas', 'candidates', 'assistant', 'verification', 'action_bar'];
}

function actions(view: AiDesignWorkspaceViewModel): AiDesignScreenBindingV1['actions'] {
  const blocked = view.safety === 'BLOCKED';
  const stale = view.header.workflowStatus === 'STALE';
  const candidateReady = view.candidates.count > 0;
  const gaugeReady = view.edit.gaugeCount > 0 && !blocked && !stale;
  const directPreviewReady = view.edit.proposalState === 'PREVIEW';
  return [
    { id: 'select-model', enabled: !blocked },
    { id: 'provide-input', enabled: view.intake.missing > 0 || view.intake.conflicts > 0 || view.header.workflowStatus === 'EMPTY' },
    { id: 'generate', enabled: view.header.workflowStatus === 'READY_TO_GENERATE' && !blocked },
    { id: 'select-candidate', enabled: candidateReady && !blocked },
    { id: 'apply-candidate', enabled: candidateReady && !view.candidates.verificationRequired && !blocked && !stale, ...(view.candidates.verificationRequired ? { reason: 'candidate_verification_required' } : {}) },
    { id: 'open-numeric-input', enabled: gaugeReady },
    { id: 'preview-direct-edit', enabled: gaugeReady },
    { id: 'confirm-direct-edit', enabled: directPreviewReady && !view.edit.requiresConfirmation && !blocked, ...(view.edit.requiresConfirmation ? { reason: 'explicit_confirmation_required' } : {}) },
    { id: 'request-precision', enabled: (view.header.workflowStatus === 'CANDIDATE_REVIEW' || view.header.workflowStatus === 'PARAMETRIC_EDIT') && !blocked },
    { id: 'inspect-verification', enabled: view.verification.receiptAccepted },
    { id: 'cancel', enabled: ['UNDERSTANDING', 'GENERATING', 'PARAMETRIC_EDIT', 'PRECISION_PENDING', 'PRECISION_VERIFYING'].includes(view.header.workflowStatus) },
    { id: 'resume', enabled: view.header.workflowStatus === 'CANCELLED' || view.header.workflowStatus === 'FAILED' },
  ];
}

/** Maps the headless workspace into stable slots consumed by Precision CAD UI. */
export function createAiDesignScreenBinding(view: AiDesignWorkspaceViewModel): AiDesignScreenBindingV1 {
  const visible = new Set(visibleRegions(view));
  const regionIds: AiDesignScreenRegionId[] = ['header', 'intake', 'canvas', 'candidates', 'assistant', 'verification', 'action_bar', 'mobile_sheet'];
  return {
    schema: AI_DESIGN_SCREEN_BINDING_SCHEMA,
    projectId: view.projectId,
    revisionToken: view.revisionToken,
    mode: view.presentation.mode,
    regions: regionIds.map(id => ({ id, visible: visible.has(id), state: regionState(view, id) })),
    modelSelector: {
      selectedModelId: view.header.selectedModelId,
      mode: view.header.modelMode,
      fallbackVisible: view.header.modelFallback,
      changeEnabled: view.safety !== 'BLOCKED',
    },
    gaugeOverlay: {
      visible: view.edit.gaugeCount > 0 && view.panels.edit !== 'blocked',
      primaryGaugeId: view.edit.primaryGaugeId,
      numericInputAvailable: view.edit.gaugeCount > 0 && view.safety !== 'BLOCKED',
      confirmationRequired: view.edit.requiresConfirmation,
    },
    precisionBadge: {
      status: view.header.precisionStatus,
      authoritative: view.verification.receiptAccepted
        && view.verification.geometry === 'PASS'
        && view.verification.topology === 'PASS',
    },
    actions: actions(view),
    safeguards: {
      explicitCommitRequired: true,
      previewIsNonPersistent: true,
      staleDisablesMutation: view.header.workflowStatus === 'STALE',
      exactCadBoundary: 'precision-cad',
    },
  };
}
