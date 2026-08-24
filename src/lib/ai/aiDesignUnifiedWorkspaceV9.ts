import type { DesignIntentInputKind } from './designIntentCheckpoint';
import {
  createAiDesignChatFirstWorkspaceContract,
  type AiDesignWorkspaceInputKind,
  type AiDesignWorkspaceStage,
} from './aiDesignChatFirstWorkspaceContract';
import {
  createAiDesign2d3dSyncContract,
  type SyncMapping,
} from './aiDesign2d3dSync';
import { getAiDesignWorkspaceCopy } from './aiDesignWorkspaceI18n';
import {
  createAiDesignChatActionCard,
  type AiDesignChatActionCardV1,
  type AiDesignChatActionId,
  type AiDesignChatActionV1,
} from './aiDesignChatActionCards';

export const AI_DESIGN_UNIFIED_WORKSPACE_V9_SCHEMA = 'nexyfab.ai-design-unified-workspace.v9' as const;

export type AiDesignUnifiedConnectionState = 'online' | 'offline' | 'reconnecting' | 'stale_revision' | 'conflict' | 'interrupted';

export interface AiDesignUnifiedWorkspaceSourceV9 {
  projectId: string;
  sessionId: string;
  runtimeRevision: number;
  complexRevision: number;
  staleAgainstRuntime: boolean;
  inputKinds: readonly DesignIntentInputKind[];
  workspace: {
    base: {
      layout: {
        mode: 'desktop' | 'mobile';
        primaryRegion: 'understanding' | 'generation' | 'comparison' | 'editing' | 'precision' | 'recovery';
        mobileSheet: string | null;
        stickyPrimaryAction: boolean;
      };
      model: {
        publicModelId: string | null;
        selectionStatus: 'selected' | 'blocked' | 'not_selected';
        explanation: readonly string[];
        exactGeometryAuthority: false;
      };
      intent: { questions: readonly { id: string; prompt: string }[] };
      generation: { status: string; currentStage: string | null; failure: string | null };
      candidates: { visible: boolean; selectedCandidateId: string | null };
      gauges: readonly { gaugeId: string; label: string; targetValue: number; unit: string; requiresConfirmation: boolean }[];
      primaryAction: { command: string; label: string; enabled: boolean; reason: string | null } | null;
      trust: {
        conceptOnly: true;
        precisionVerification: 'NOT_RUN' | 'STALE' | 'PASS';
        manufacturingReleaseReady: false;
      };
    };
    assemblyGauges: readonly { gaugeId: string; parameterId: string; label: string; targetValue: number; unit: string }[];
    candidateEvaluations: readonly { candidateId: string; status: string; conceptReviewReady: boolean }[];
  };
  precision: {
    status: 'NOT_RUN' | 'PASS' | 'FAIL' | 'STALE';
    requestIds: readonly string[];
    receiptIds: readonly string[];
    manufacturingReleaseReady: false;
  };
}

export interface AiDesignUnifiedRecoveryV9 {
  state: AiDesignUnifiedConnectionState;
  blocking: boolean;
  title: string;
  message: string;
  safeActions: readonly string[];
  mutationEnabled: boolean;
}

export interface AiDesignUnifiedWorkspaceV9 {
  schema: typeof AI_DESIGN_UNIFIED_WORKSPACE_V9_SCHEMA;
  projectId: string;
  sessionId: string;
  revisions: { runtime: number; complex: number; stale: boolean };
  chat: ReturnType<typeof createAiDesignChatFirstWorkspaceContract>;
  cards: readonly AiDesignChatActionCardV1[];
  canvas: {
    availableModes: readonly ['2d', '3d', 'split'];
    activeMode: '2d' | '3d' | 'split';
    desktopSideBySide: boolean;
    mobileTabs: readonly ['2d', '3d'];
    linkedSelection: true;
    switchingPreservesSelection: true;
    changePreviewUpdatesBothViews: true;
    mappingStatus: 'ready' | 'awaiting_precision_binding';
  };
  sync: ReturnType<typeof createAiDesign2d3dSyncContract>;
  model: AiDesignUnifiedWorkspaceSourceV9['workspace']['base']['model'];
  mobile: {
    startsInChat: true;
    canvasPresentation: 'full-screen';
    inspectorPresentation: 'modal-bottom-sheet';
    stickyPreviewApplyCancel: true;
    touchTargetMinPx: 44;
    gesturePolicy: 'one-finger-edit-two-finger-camera';
  };
  recovery: AiDesignUnifiedRecoveryV9;
  history: {
    aiViewUndoRedo: true;
    conceptPreviewRejectable: true;
    precisionCadCommitsUndoableHere: false;
    exactReceiptsUndoableHere: false;
  };
  authority: {
    aiDesign: 'concept-orchestration-and-preview';
    precisionCad: 'exact-geometry-and-verification';
    actualRendererOwner: 'precision-cad-or-integration';
    manufacturingReleaseReady: false;
  };
}

export interface CreateAiDesignUnifiedWorkspaceV9Options {
  locale?: string;
  recovery: AiDesignUnifiedRecoveryV9;
  twoDToThreeD?: readonly SyncMapping[];
  threeDToTwoD?: readonly SyncMapping[];
  activeCanvasMode?: '2d' | '3d' | 'split';
}

const EMPTY_REFERENCES = {
  questionId: null,
  candidateId: null,
  gaugeId: null,
  proposalId: null,
  verificationReceiptId: null,
} as const;

function inputKind(kind: DesignIntentInputKind): AiDesignWorkspaceInputKind {
  if (kind === 'image' || kind === 'sketch') return 'image_or_sketch';
  if (kind === 'selection_3d') return 'existing_3d';
  return kind;
}

function stageFor(source: AiDesignUnifiedWorkspaceSourceV9): AiDesignWorkspaceStage {
  if (!source.inputKinds.length) return 'intake';
  switch (source.workspace.base.layout.primaryRegion) {
    case 'understanding': return 'understanding';
    case 'generation': return 'generation';
    case 'comparison': return 'candidates';
    case 'editing': return 'edit';
    case 'precision': return 'precision';
    case 'recovery': return 'recovery';
  }
}

function action(id: AiDesignChatActionId, label: string, options: Partial<Pick<AiDesignChatActionV1, 'enabled' | 'reason' | 'primary'>> = {}): AiDesignChatActionV1 {
  return {
    id,
    label,
    enabled: options.enabled ?? true,
    reason: options.reason ?? null,
    primary: options.primary ?? false,
    requiresConfirmation: id === 'APPLY_CONCEPT_CHANGE' || id === 'REQUEST_PRECISION',
  };
}

function copy(locale: string) {
  return getAiDesignWorkspaceCopy(locale).cards;
}

function cardsFor(source: AiDesignUnifiedWorkspaceSourceV9, locale: string, recovery: AiDesignUnifiedRecoveryV9): readonly AiDesignChatActionCardV1[] {
  const text = copy(locale);
  const base = source.workspace.base;
  const candidateId = base.candidates.selectedCandidateId ?? source.workspace.candidateEvaluations[0]?.candidateId ?? null;
  const gaugeId = source.workspace.assemblyGauges[0]?.gaugeId ?? base.gauges[0]?.gaugeId ?? null;
  const question = base.intent.questions[0] ?? null;
  const references = { ...EMPTY_REFERENCES, questionId: question?.id ?? null, candidateId, gaugeId, verificationReceiptId: source.precision.receiptIds.at(-1) ?? null };
  const common = { projectId: source.projectId, sessionId: source.sessionId, runtimeRevision: source.runtimeRevision };

  if (recovery.state !== 'online') return [createAiDesignChatActionCard({
    ...common, cardId: `recovery:${source.runtimeRevision}`, kind: 'recovery', title: text.recoveryTitle,
    summary: recovery.message, status: recovery.blocking ? 'blocked' : 'attention', references,
    actions: recovery.safeActions.includes('RESUME')
      ? [action('RESUME', text.resume, { primary: true })]
      : [action('REFRESH_SERVER_STATE', text.refresh, { primary: true, enabled: recovery.state !== 'reconnecting', reason: recovery.state === 'reconnecting' ? 'reconnection_in_progress' : null })],
  })];

  const region = base.layout.primaryRegion;
  if (!source.inputKinds.length) return [createAiDesignChatActionCard({
    ...common, cardId: `intake:${source.runtimeRevision}`, kind: 'guidance', title: text.intakeTitle,
    summary: text.intakeSummary, status: 'ready', references, actions: [action('ADD_INPUT', text.add, { primary: true })],
  })];
  if (region === 'understanding') return [createAiDesignChatActionCard({
    ...common, cardId: `understanding:${source.runtimeRevision}`, kind: question ? 'clarification' : 'guidance',
    title: question ? text.questionTitle : text.confirmTitle, summary: question?.prompt ?? text.generationSummary,
    status: question ? 'attention' : 'ready', references,
    actions: [question ? action('ANSWER_CLARIFICATION', text.answer, { primary: true }) : action('CONFIRM_UNDERSTANDING', text.confirm, { primary: true })],
  })];
  if (region === 'generation') {
    const continuing = base.generation.status !== 'NOT_STARTED';
    return [createAiDesignChatActionCard({
      ...common, cardId: `generation:${source.runtimeRevision}`, kind: 'guidance', title: text.generatingTitle,
      summary: text.generationSummary, status: base.generation.failure ? 'attention' : 'ready', references,
      actions: [action(continuing ? 'CONTINUE_GENERATION' : 'START_GENERATION', continuing ? text.continue : text.start, { primary: true, enabled: base.primaryAction?.enabled ?? true, reason: base.primaryAction?.reason ?? null })],
    })];
  }
  if (region === 'comparison') return [createAiDesignChatActionCard({
    ...common, cardId: `candidate:${candidateId ?? source.runtimeRevision}`, kind: 'comparison', title: text.candidateTitle,
    summary: text.candidateSummary, status: candidateId ? 'ready' : 'attention', references,
    actions: [
      action(candidateId ? 'SELECT_CANDIDATE' : 'OPEN_COMPARISON', candidateId ? text.select : text.compare, { primary: true, enabled: candidateId !== null || base.candidates.visible, reason: candidateId === null && !base.candidates.visible ? 'candidates_not_available' : null }),
      ...(candidateId ? [action('OPEN_COMPARISON', text.compare)] : []),
    ],
  })];
  if (region === 'editing') return [createAiDesignChatActionCard({
    ...common, cardId: `edit:${gaugeId ?? source.runtimeRevision}`, kind: 'change_preview', title: text.editTitle,
    summary: text.editSummary, status: gaugeId ? 'ready' : 'attention', references,
    actions: [action('PREVIEW_CHANGE', text.preview, { primary: true, enabled: gaugeId !== null, reason: gaugeId ? null : 'gauge_not_available' })],
  })];
  if (region === 'precision') return [createAiDesignChatActionCard({
    ...common, cardId: `precision:${source.runtimeRevision}`, kind: source.precision.status === 'PASS' ? 'verification' : 'guidance',
    title: text.precisionTitle, summary: text.precisionSummary, status: source.precision.status === 'PASS' ? 'complete' : 'attention', references,
    actions: source.precision.status === 'PASS' && references.verificationReceiptId
      ? [action('INSPECT_VERIFICATION', text.inspect, { primary: true })]
      : [action('REQUEST_PRECISION', text.precision, { primary: true, enabled: candidateId !== null, reason: candidateId ? null : 'candidate_selection_required' })],
  })];
  return [createAiDesignChatActionCard({
    ...common, cardId: `recovery:${source.runtimeRevision}`, kind: 'recovery', title: text.recoveryTitle,
    summary: recovery.message, status: 'attention', references, actions: [action('RESUME', text.resume, { primary: true })],
  })];
}

/** Composes AI-owned V1-V8 contracts into one renderer-consumable chat-first V9 model. */
export function createAiDesignUnifiedWorkspaceV9(source: AiDesignUnifiedWorkspaceSourceV9, options: CreateAiDesignUnifiedWorkspaceV9Options): AiDesignUnifiedWorkspaceV9 {
  const receivedInputs = [...new Set(source.inputKinds.map(inputKind))];
  const mobile = source.workspace.base.layout.mode === 'mobile';
  const twoDToThreeD = options.twoDToThreeD ?? [];
  const threeDToTwoD = options.threeDToTwoD ?? [];
  const mappingReady = twoDToThreeD.length > 0 && threeDToTwoD.length > 0;
  const activeMode = options.activeCanvasMode ?? (mobile ? '3d' : 'split');
  const unified: AiDesignUnifiedWorkspaceV9 = {
    schema: AI_DESIGN_UNIFIED_WORKSPACE_V9_SCHEMA,
    projectId: source.projectId,
    sessionId: source.sessionId,
    revisions: { runtime: source.runtimeRevision, complex: source.complexRevision, stale: source.staleAgainstRuntime },
    chat: createAiDesignChatFirstWorkspaceContract({
      locale: options.locale ?? 'ko', stage: stageFor(source), layout: mobile ? 'mobile_chat_first' : 'desktop_split', receivedInputs,
    }),
    cards: cardsFor(source, options.locale ?? 'ko', options.recovery),
    canvas: {
      availableModes: ['2d', '3d', 'split'], activeMode, desktopSideBySide: !mobile,
      mobileTabs: ['2d', '3d'], linkedSelection: true, switchingPreservesSelection: true,
      changePreviewUpdatesBothViews: true, mappingStatus: mappingReady ? 'ready' : 'awaiting_precision_binding',
    },
    sync: createAiDesign2d3dSyncContract({
      projectId: source.projectId, revision: `runtime:${source.runtimeRevision}`, focus: activeMode,
      twoDToThreeD, threeDToTwoD,
    }),
    model: source.workspace.base.model,
    mobile: {
      startsInChat: true, canvasPresentation: 'full-screen', inspectorPresentation: 'modal-bottom-sheet',
      stickyPreviewApplyCancel: true, touchTargetMinPx: 44, gesturePolicy: 'one-finger-edit-two-finger-camera',
    },
    recovery: { ...options.recovery },
    history: { aiViewUndoRedo: true, conceptPreviewRejectable: true, precisionCadCommitsUndoableHere: false, exactReceiptsUndoableHere: false },
    authority: {
      aiDesign: 'concept-orchestration-and-preview', precisionCad: 'exact-geometry-and-verification',
      actualRendererOwner: 'precision-cad-or-integration', manufacturingReleaseReady: false,
    },
  };
  return Object.freeze(unified);
}

export function validateAiDesignUnifiedWorkspaceV9(value: AiDesignUnifiedWorkspaceV9): string[] {
  const issues: string[] = [];
  if (value.schema !== AI_DESIGN_UNIFIED_WORKSPACE_V9_SCHEMA) issues.push('unified_workspace_schema_invalid');
  if (value.projectId !== value.sync.projectId || value.sync.revision !== `runtime:${value.revisions.runtime}`) issues.push('unified_workspace_sync_binding_invalid');
  if (value.chat.layout === 'mobile_chat_first' && (!value.mobile.startsInChat || value.chat.regions.chat !== 'primary')) issues.push('unified_workspace_mobile_chat_invalid');
  if (value.canvas.activeMode === 'split' && !value.canvas.availableModes.includes('split')) issues.push('unified_workspace_canvas_mode_invalid');
  if (value.authority.manufacturingReleaseReady !== false || value.sync.commitAllowed !== false) issues.push('unified_workspace_authority_invalid');
  if (!value.cards.length || value.cards.some(card => card.projectId !== value.projectId || card.sessionId !== value.sessionId || card.runtimeRevision !== value.revisions.runtime)) issues.push('unified_workspace_card_binding_invalid');
  return [...new Set(issues)];
}
