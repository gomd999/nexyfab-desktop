/**
 * Headless interaction contract for the AI Design workspace.
 *
 * This module deliberately contains no React or browser dependencies.  A web
 * or native shell can project this state into any UI while retaining the same
 * safety rules on desktop and touch devices.
 */

export const AI_DESIGN_INTERACTION_SCHEMA = 'nexyfab.ai-design-interaction.v1' as const;
export const MIN_TOUCH_TARGET_PX = 44;
export const AI_DESIGN_TRACKS = ['concept', 'parametric', 'precision'] as const;
export const DESIGN_STAGE_STATUSES = ['pending', 'verified', 'stale', 'blocked'] as const;

export type AiDesignTrack = (typeof AI_DESIGN_TRACKS)[number];
export type DesignStageStatus = (typeof DESIGN_STAGE_STATUSES)[number];
export type PresentationMode = 'desktop' | 'mobile';
export type BottomSheetSnap = 'closed' | 'peek' | 'expanded';
export type GestureIntent = 'none' | 'edit' | 'camera';
export type OperationLifecycle = 'idle' | 'running' | 'cancelling' | 'cancelled' | 'paused' | 'completed' | 'failed';
export type ChangeImpactLevel = 'none' | 'low' | 'medium' | 'high';
export type EditMode = 'locked' | 'ready' | 'editing';
export type AxisLock = 'none' | 'x' | 'y' | 'z';

export interface StageViewModel {
  track: AiDesignTrack;
  status: DesignStageStatus;
  revision: number;
  title: string;
  summary: string;
  blockers: readonly string[];
  updatedAt?: string;
}

export interface ChangeImpact {
  level: ChangeImpactLevel;
  affectedTracks: readonly AiDesignTrack[];
  affectedArtifacts: readonly string[];
  requiresReverification: boolean;
  summary: string;
}

export type ChangeActionId = 'accept' | 'review' | 'undo' | 'retry' | 'resume';

export interface ChangeAction {
  id: ChangeActionId;
  label: string;
  enabled: boolean;
  destructive?: boolean;
}

export interface ChangeExplanation {
  id: string;
  title: string;
  reason: string;
  impact: ChangeImpact;
  actions: readonly ChangeAction[];
}

/** Safe action affordances for each lifecycle status; shells may localise labels. */
export function actionsForStageStatus(status: DesignStageStatus): readonly ChangeAction[] {
  switch (status) {
    case 'pending':
      return [{ id: 'review', label: 'Review pending work', enabled: true }];
    case 'verified':
      return [{ id: 'accept', label: 'Accept verified result', enabled: true }, { id: 'review', label: 'Review result', enabled: true }];
    case 'stale':
      return [{ id: 'review', label: 'Review stale impact', enabled: true }, { id: 'retry', label: 'Re-verify', enabled: true }];
    case 'blocked':
      return [{ id: 'review', label: 'Review blocker', enabled: true }, { id: 'retry', label: 'Retry after resolving', enabled: false }];
  }
}

export interface PresentationState {
  mode: PresentationMode;
  density: 'comfortable' | 'compact';
  navigation: 'rail' | 'bottom-sheet';
  canvasLayout: 'split' | 'stacked';
  touchTargetMinPx: number;
}

export interface BottomSheetState {
  snap: BottomSheetSnap;
  snapPoints: readonly number[];
  dismissible: boolean;
  focusTrap: boolean;
}

export interface NumericFallbackState {
  open: boolean;
  fieldId: string | null;
  rawValue: string;
  value: number | null;
  unit: string | null;
  valid: boolean;
  error: 'empty' | 'invalid' | 'out-of-range' | null;
  min: number | null;
  max: number | null;
  step: number | null;
}

export interface EditSafetyState {
  mode: EditMode;
  /** Editing is intentionally locked until the long-press gate is met. */
  lockReason: 'long-press-required' | 'none';
  longPress: { requiredMs: number; elapsedMs: number; ready: boolean };
  axisLock: AxisLock;
}

export interface AccessibilityFlags {
  /** Consumers should disable non-essential transitions when true. */
  reducedMotion: boolean;
  /** Every status must have text/icon/pattern semantics in addition to color. */
  nonColorStatus: boolean;
  announceStateChanges: boolean;
}

export interface DesignOperation {
  id: string | null;
  lifecycle: OperationLifecycle;
  checkpoint: string | null;
  cancelReason: string | null;
  resumeAvailable: boolean;
}

export interface AiDesignInteractionState {
  schema: typeof AI_DESIGN_INTERACTION_SCHEMA;
  revision: number;
  selectedTrack: AiDesignTrack;
  stages: Readonly<Record<AiDesignTrack, StageViewModel>>;
  presentation: PresentationState;
  bottomSheet: BottomSheetState;
  gesture: { intent: GestureIntent; pointerCount: number };
  numericFallback: NumericFallbackState;
  editSafety: EditSafetyState;
  accessibility: AccessibilityFlags;
  change: ChangeExplanation | null;
  operation: DesignOperation;
}

export interface CreateInteractionInput {
  selectedTrack?: AiDesignTrack;
  stages?: Partial<Record<AiDesignTrack, Partial<StageViewModel>>>;
  presentation?: PresentationMode;
  revision?: number;
}

const TITLES: Record<AiDesignTrack, string> = {
  concept: 'Concept',
  parametric: 'Parametric',
  precision: 'Precision',
};

function validTrack(value: unknown): value is AiDesignTrack {
  return typeof value === 'string' && (AI_DESIGN_TRACKS as readonly string[]).includes(value);
}

function validStatus(value: unknown): value is DesignStageStatus {
  return typeof value === 'string' && (DESIGN_STAGE_STATUSES as readonly string[]).includes(value);
}

function presentationFor(mode: PresentationMode): PresentationState {
  return mode === 'mobile'
    ? { mode, density: 'compact', navigation: 'bottom-sheet', canvasLayout: 'stacked', touchTargetMinPx: MIN_TOUCH_TARGET_PX }
    : { mode, density: 'comfortable', navigation: 'rail', canvasLayout: 'split', touchTargetMinPx: MIN_TOUCH_TARGET_PX };
}

function bottomSheetFor(mode: PresentationMode): BottomSheetState {
  return mode === 'mobile'
    ? { snap: 'peek', snapPoints: [0, 0.24, 0.92], dismissible: true, focusTrap: false }
    : { snap: 'closed', snapPoints: [0], dismissible: false, focusTrap: false };
}

function defaultStage(track: AiDesignTrack): StageViewModel {
  return { track, status: 'pending', revision: 0, title: TITLES[track], summary: '', blockers: [] };
}

/** Build a serialisable state with all three design tracks represented. */
export function createAiDesignInteractionState(input: CreateInteractionInput = {}): AiDesignInteractionState {
  const mode = input.presentation ?? 'desktop';
  const stages = Object.fromEntries(AI_DESIGN_TRACKS.map(track => {
    const supplied = input.stages?.[track] ?? {};
    const stageRevision = Number.isInteger(supplied.revision) && (supplied.revision as number) >= 0 ? supplied.revision as number : 0;
    return [track, {
      ...defaultStage(track),
      ...supplied,
      track,
      title: supplied.title ?? TITLES[track],
      status: validStatus(supplied.status) ? supplied.status : 'pending',
      revision: stageRevision,
      blockers: [...(supplied.blockers ?? [])],
    } satisfies StageViewModel];
  })) as unknown as Record<AiDesignTrack, StageViewModel>;
  return {
    schema: AI_DESIGN_INTERACTION_SCHEMA,
    revision: Number.isInteger(input.revision) && (input.revision as number) >= 0 ? input.revision as number : 0,
    selectedTrack: validTrack(input.selectedTrack) ? input.selectedTrack : 'concept',
    stages,
    presentation: presentationFor(mode),
    bottomSheet: bottomSheetFor(mode),
    gesture: { intent: 'none', pointerCount: 0 },
    numericFallback: { open: false, fieldId: null, rawValue: '', value: null, unit: null, valid: false, error: 'empty', min: null, max: null, step: null },
    editSafety: { mode: 'locked', lockReason: 'long-press-required', longPress: { requiredMs: 450, elapsedMs: 0, ready: false }, axisLock: 'none' },
    accessibility: { reducedMotion: false, nonColorStatus: true, announceStateChanges: true },
    change: null,
    operation: { id: null, lifecycle: 'idle', checkpoint: null, cancelReason: null, resumeAvailable: false },
  };
}

export function selectDesignTrack(state: AiDesignInteractionState, track: AiDesignTrack): AiDesignInteractionState {
  if (!validTrack(track)) return state;
  return { ...state, selectedTrack: track, revision: state.revision + 1 };
}

export function updateDesignStage(
  state: AiDesignInteractionState,
  track: AiDesignTrack,
  update: Partial<Pick<StageViewModel, 'status' | 'revision' | 'summary' | 'blockers' | 'updatedAt'>>,
): AiDesignInteractionState {
  if (!validTrack(track)) return state;
  const stage = state.stages[track];
  const status = update.status === undefined || validStatus(update.status) ? update.status : stage.status;
  const revision = update.revision === undefined || (Number.isInteger(update.revision) && update.revision >= 0) ? update.revision : stage.revision;
  return {
    ...state,
    revision: state.revision + 1,
    stages: { ...state.stages, [track]: { ...stage, ...update, status, revision, blockers: update.blockers ? [...update.blockers] : stage.blockers } },
  };
}

export function setPresentationMode(state: AiDesignInteractionState, mode: PresentationMode): AiDesignInteractionState {
  const validMode: PresentationMode = mode === 'mobile' ? 'mobile' : 'desktop';
  const current = state.presentation.mode === validMode;
  return current ? state : { ...state, presentation: presentationFor(validMode), bottomSheet: bottomSheetFor(validMode), revision: state.revision + 1 };
}

export function setBottomSheetSnap(state: AiDesignInteractionState, snap: BottomSheetSnap): AiDesignInteractionState {
  if (state.presentation.mode !== 'mobile') return state;
  const next = snap === 'peek' || snap === 'expanded' || snap === 'closed' ? snap : 'closed';
  return { ...state, bottomSheet: { ...state.bottomSheet, snap: next, focusTrap: next === 'expanded' }, revision: state.revision + 1 };
}

export function setChangeExplanation(state: AiDesignInteractionState, change: ChangeExplanation | null): AiDesignInteractionState {
  if (change === null) return { ...state, change: null, revision: state.revision + 1 };
  const actions = change.actions.map(action => ({ ...action }));
  return { ...state, change: { ...change, actions }, revision: state.revision + 1 };
}

/**
 * Resolve touch intent before any canvas handler runs. A second finger always
 * promotes the gesture to camera navigation, preventing accidental edits.
 */
export function arbitrateGesture(input: { pointerType?: 'touch' | 'mouse' | 'pen'; activePointerCount: number }): {
  intent: GestureIntent;
  pointerCount: number;
  cancelEdit: boolean;
  minimumPointers: number;
} {
  const count = Number.isFinite(input.activePointerCount) ? Math.max(0, Math.floor(input.activePointerCount)) : 0;
  if (input.pointerType !== undefined && input.pointerType !== 'touch') {
    return { intent: count > 0 ? 'edit' : 'none', pointerCount: count, cancelEdit: false, minimumPointers: 1 };
  }
  if (count >= 2) return { intent: 'camera', pointerCount: count, cancelEdit: true, minimumPointers: 2 };
  if (count === 1) return { intent: 'edit', pointerCount: count, cancelEdit: false, minimumPointers: 1 };
  return { intent: 'none', pointerCount: 0, cancelEdit: false, minimumPointers: 1 };
}

export function updateGesture(state: AiDesignInteractionState, input: { pointerType?: 'touch' | 'mouse' | 'pen'; activePointerCount: number }): AiDesignInteractionState {
  const decision = arbitrateGesture(input);
  return { ...state, gesture: { intent: decision.intent, pointerCount: decision.pointerCount } };
}

export function ensureTouchTarget(target: { width: number; height: number }): { width: number; height: number; min: number; adjusted: boolean } {
  const width = Number.isFinite(target.width) ? Math.max(MIN_TOUCH_TARGET_PX, target.width) : MIN_TOUCH_TARGET_PX;
  const height = Number.isFinite(target.height) ? Math.max(MIN_TOUCH_TARGET_PX, target.height) : MIN_TOUCH_TARGET_PX;
  return { width, height, min: MIN_TOUCH_TARGET_PX, adjusted: width !== target.width || height !== target.height };
}

export interface NumericFallbackInput {
  fieldId: string;
  initialValue?: number | null;
  unit?: string;
  min?: number | null;
  max?: number | null;
  step?: number | null;
}

export function openNumericFallback(state: AiDesignInteractionState, input: NumericFallbackInput): AiDesignInteractionState {
  const value = input.initialValue ?? null;
  return { ...state, numericFallback: { open: true, fieldId: input.fieldId, rawValue: value === null ? '' : String(value), value, unit: input.unit ?? null, valid: value !== null, error: value === null ? 'empty' : null, min: input.min ?? null, max: input.max ?? null, step: input.step ?? null }, revision: state.revision + 1 };
}

/** Locale-tolerant numeric input, with finite/range checks and no coercion of garbage. */
export function parseNumericFallback(rawValue: string, bounds: Pick<NumericFallbackState, 'min' | 'max'>): Pick<NumericFallbackState, 'rawValue' | 'value' | 'valid' | 'error'> {
  const raw = rawValue.trim().replace(',', '.');
  if (!raw) return { rawValue, value: null, valid: false, error: 'empty' };
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) return { rawValue, value: null, valid: false, error: 'invalid' };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { rawValue, value: null, valid: false, error: 'invalid' };
  if ((bounds.min !== null && value < bounds.min) || (bounds.max !== null && value > bounds.max)) return { rawValue, value, valid: false, error: 'out-of-range' };
  return { rawValue, value, valid: true, error: null };
}

export function updateNumericFallback(state: AiDesignInteractionState, rawValue: string): AiDesignInteractionState {
  if (!state.numericFallback.open) return state;
  const parsed = parseNumericFallback(rawValue, state.numericFallback);
  return { ...state, numericFallback: { ...state.numericFallback, ...parsed }, revision: state.revision + 1 };
}

export function closeNumericFallback(state: AiDesignInteractionState): AiDesignInteractionState {
  return { ...state, numericFallback: { ...state.numericFallback, open: false }, revision: state.revision + 1 };
}

/** Advance the explicit edit gate; pointer-down alone never unlocks editing. */
export function updateLongPress(state: AiDesignInteractionState, elapsedMs: number): AiDesignInteractionState {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const requiredMs = state.editSafety.longPress.requiredMs;
  const ready = elapsed >= requiredMs;
  return {
    ...state,
    editSafety: { ...state.editSafety, mode: ready ? 'ready' : 'locked', lockReason: ready ? 'none' : 'long-press-required', longPress: { requiredMs, elapsedMs: elapsed, ready } },
    revision: state.revision + 1,
  };
}

export function beginExplicitEdit(state: AiDesignInteractionState): AiDesignInteractionState {
  if (!state.editSafety.longPress.ready) return state;
  return { ...state, editSafety: { ...state.editSafety, mode: 'editing', lockReason: 'none' }, revision: state.revision + 1 };
}

export function lockEditMode(state: AiDesignInteractionState): AiDesignInteractionState {
  return { ...state, editSafety: { ...state.editSafety, mode: 'locked', lockReason: 'long-press-required', longPress: { ...state.editSafety.longPress, elapsedMs: 0, ready: false }, axisLock: 'none' }, revision: state.revision + 1 };
}

export function setAxisLock(state: AiDesignInteractionState, axisLock: AxisLock): AiDesignInteractionState {
  const axis: AxisLock = axisLock === 'x' || axisLock === 'y' || axisLock === 'z' ? axisLock : 'none';
  if (state.editSafety.mode === 'locked' && axis !== 'none') return state;
  return { ...state, editSafety: { ...state.editSafety, axisLock: axis }, revision: state.revision + 1 };
}

export function setAccessibilityFlags(state: AiDesignInteractionState, flags: Partial<AccessibilityFlags>): AiDesignInteractionState {
  return { ...state, accessibility: { ...state.accessibility, ...flags }, revision: state.revision + 1 };
}

export function startDesignRun(state: AiDesignInteractionState, id: string, checkpoint: string | null = null): AiDesignInteractionState {
  if (!id.trim() || (state.operation.lifecycle !== 'idle' && state.operation.lifecycle !== 'cancelled' && state.operation.lifecycle !== 'paused' && state.operation.lifecycle !== 'failed')) return state;
  return { ...state, operation: { id, lifecycle: 'running', checkpoint, cancelReason: null, resumeAvailable: false }, revision: state.revision + 1 };
}

export function cancelDesignRun(state: AiDesignInteractionState, reason = 'user_cancelled'): AiDesignInteractionState {
  if (state.operation.lifecycle !== 'running' && state.operation.lifecycle !== 'cancelling') return state;
  return { ...state, operation: { ...state.operation, lifecycle: 'cancelled', cancelReason: reason, resumeAvailable: state.operation.checkpoint !== null } , revision: state.revision + 1 };
}

export function resumeDesignRun(state: AiDesignInteractionState): AiDesignInteractionState {
  if (!state.operation.resumeAvailable || !state.operation.id || (state.operation.lifecycle !== 'cancelled' && state.operation.lifecycle !== 'paused')) return state;
  return { ...state, operation: { ...state.operation, lifecycle: 'running', cancelReason: null, resumeAvailable: false }, revision: state.revision + 1 };
}

/** Compact, low-data representation: no free-form explanations or duplicate stage text. */
export function toLowDataPayload(state: AiDesignInteractionState): {
  schema: typeof AI_DESIGN_INTERACTION_SCHEMA;
  revision: number;
  selectedTrack: AiDesignTrack;
  stages: Record<AiDesignTrack, { status: DesignStageStatus; revision: number }>;
  presentation: PresentationMode;
  bottomSheet: BottomSheetSnap;
  editMode: EditMode;
  axisLock: AxisLock;
  reducedMotion: boolean;
  nonColorStatus: boolean;
  operation: Pick<DesignOperation, 'id' | 'lifecycle' | 'checkpoint' | 'resumeAvailable'>;
} {
  return {
    schema: AI_DESIGN_INTERACTION_SCHEMA,
    revision: state.revision,
    selectedTrack: state.selectedTrack,
    stages: Object.fromEntries(AI_DESIGN_TRACKS.map(track => [track, { status: state.stages[track].status, revision: state.stages[track].revision }])) as Record<AiDesignTrack, { status: DesignStageStatus; revision: number }>,
    presentation: state.presentation.mode,
    bottomSheet: state.bottomSheet.snap,
    editMode: state.editSafety.mode,
    axisLock: state.editSafety.axisLock,
    reducedMotion: state.accessibility.reducedMotion,
    nonColorStatus: state.accessibility.nonColorStatus,
    operation: { id: state.operation.id, lifecycle: state.operation.lifecycle, checkpoint: state.operation.checkpoint, resumeAvailable: state.operation.resumeAvailable },
  };
}

export function assertAiDesignInteractionState(state: AiDesignInteractionState): void {
  if (state.schema !== AI_DESIGN_INTERACTION_SCHEMA) throw new Error('invalid_ai_design_interaction_schema');
  if (state.presentation.touchTargetMinPx < MIN_TOUCH_TARGET_PX) throw new Error('touch_target_below_minimum');
  if (state.editSafety.mode === 'editing' && !state.editSafety.longPress.ready) throw new Error('edit_without_long_press');
  for (const track of AI_DESIGN_TRACKS) {
    if (!state.stages[track] || !validStatus(state.stages[track].status)) throw new Error(`invalid_stage:${track}`);
  }
  if (state.presentation.mode === 'desktop' && state.bottomSheet.snap !== 'closed') throw new Error('desktop_bottom_sheet_must_be_closed');
}
