/** Mobile presentation and interruption recovery state for AI Design. */

export const AI_DESIGN_MOBILE_RECOVERY_SCHEMA = 'nexyfab.ai-design-mobile-recovery.v1' as const;
export type MobileSheetSnap = 'peek' | 'half' | 'expanded';
export type MobileInterruption = 'none' | 'keyboard' | 'offline' | 'app-backgrounded' | 'cancelled' | 'gesture-camera';

export interface MobileSafeArea {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface MobileSelection {
  readonly entityId: string;
  readonly entityType: 'face' | 'edge' | 'vertex' | 'feature' | 'part' | 'candidate';
  readonly workflowRevision: number;
  readonly checkpointId: string | null;
}

export interface MobileGestureDraft {
  readonly id: string;
  readonly selection: MobileSelection | null;
  readonly beforeValue: number | null;
  readonly draftValue: number | null;
  readonly unit: string | null;
  readonly dirty: boolean;
}

export interface MobileResumeToken {
  readonly id: string;
  readonly workflowRevision: number;
  readonly checkpointId: string;
  readonly operationId: string | null;
  readonly createdAt: string;
}

export interface AiDesignMobileRecoveryState {
  readonly schema: typeof AI_DESIGN_MOBILE_RECOVERY_SCHEMA;
  readonly snap: MobileSheetSnap;
  readonly safeArea: MobileSafeArea;
  readonly keyboardVisible: boolean;
  readonly keyboardHeight: number;
  readonly interruption: MobileInterruption;
  readonly offline: boolean;
  readonly lowData: boolean;
  readonly selection: MobileSelection | null;
  readonly gesture: MobileGestureDraft | null;
  readonly resumeToken: MobileResumeToken | null;
  readonly preservedSelection: boolean;
  readonly pendingGestureDiscarded: boolean;
}

export function createAiDesignMobileRecoveryState(options: Partial<Pick<AiDesignMobileRecoveryState, 'safeArea' | 'lowData'>> = {}): AiDesignMobileRecoveryState {
  return {
    schema: AI_DESIGN_MOBILE_RECOVERY_SCHEMA,
    snap: 'peek',
    safeArea: options.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 },
    keyboardVisible: false,
    keyboardHeight: 0,
    interruption: 'none',
    offline: false,
    lowData: options.lowData ?? false,
    selection: null,
    gesture: null,
    resumeToken: null,
    preservedSelection: false,
    pendingGestureDiscarded: false,
  };
}

export function setMobileSheetSnap(state: AiDesignMobileRecoveryState, snap: MobileSheetSnap): AiDesignMobileRecoveryState {
  return { ...state, snap };
}

export function setMobileSafeArea(state: AiDesignMobileRecoveryState, safeArea: Partial<MobileSafeArea>): AiDesignMobileRecoveryState {
  const number = (value: number | undefined, fallback: number): number => Number.isFinite(value) ? Math.max(0, value as number) : fallback;
  return { ...state, safeArea: { top: number(safeArea.top, state.safeArea.top), right: number(safeArea.right, state.safeArea.right), bottom: number(safeArea.bottom, state.safeArea.bottom), left: number(safeArea.left, state.safeArea.left) } };
}

export function setMobileKeyboard(state: AiDesignMobileRecoveryState, visible: boolean, height = 0): AiDesignMobileRecoveryState {
  const keyboardHeight = visible && Number.isFinite(height) ? Math.max(0, height) : 0;
  return { ...state, keyboardVisible: visible, keyboardHeight, snap: visible ? 'expanded' : state.snap };
}

export function setMobileSelection(state: AiDesignMobileRecoveryState, selection: MobileSelection | null, workflowRevision = selection?.workflowRevision): AiDesignMobileRecoveryState {
  if (!selection) return { ...state, selection: null, preservedSelection: false };
  if (workflowRevision !== undefined && selection.workflowRevision !== workflowRevision) return { ...state, selection: null, preservedSelection: false };
  return { ...state, selection, preservedSelection: true };
}

export function beginMobileGesture(state: AiDesignMobileRecoveryState, gesture: MobileGestureDraft): AiDesignMobileRecoveryState {
  return { ...state, gesture: { ...gesture, dirty: gesture.dirty || gesture.draftValue !== gesture.beforeValue }, pendingGestureDiscarded: false };
}

/** A camera gesture, interruption, or explicit cancel must never commit a draft. */
export function discardMobileGesture(state: AiDesignMobileRecoveryState, reason: Extract<MobileInterruption, 'gesture-camera' | 'cancelled' | 'offline' | 'app-backgrounded'> = 'cancelled'): AiDesignMobileRecoveryState {
  if (!state.gesture) return { ...state, interruption: reason, pendingGestureDiscarded: false };
  return { ...state, gesture: null, interruption: reason, pendingGestureDiscarded: state.gesture.dirty };
}

export function commitMobileGesture(state: AiDesignMobileRecoveryState): AiDesignMobileRecoveryState {
  if (!state.gesture || !state.gesture.dirty || state.interruption !== 'none') return state;
  return { ...state, gesture: null, pendingGestureDiscarded: false };
}

export function setMobileConnectivity(state: AiDesignMobileRecoveryState, offline: boolean): AiDesignMobileRecoveryState {
  if (offline) return discardMobileGesture({ ...state, offline: true }, 'offline');
  return { ...state, offline: false, interruption: state.interruption === 'offline' ? 'none' : state.interruption };
}

export function createMobileResumeToken(state: AiDesignMobileRecoveryState, input: Omit<MobileResumeToken, 'id'> & { id?: string }): AiDesignMobileRecoveryState {
  if (!input.checkpointId.trim() || !Number.isInteger(input.workflowRevision) || input.workflowRevision < 0) return state;
  if (input.operationId !== null && !input.operationId.trim()) return state;
  if (!input.createdAt.trim() || !Number.isFinite(Date.parse(input.createdAt))) return state;
  const id = input.id?.trim() || `${input.checkpointId}:${input.workflowRevision}`;
  return { ...state, resumeToken: { ...input, id } };
}

export function consumeMobileResumeToken(state: AiDesignMobileRecoveryState, workflowRevision: number, checkpointId: string, expectedOperationId?: string | null): AiDesignMobileRecoveryState {
  const token = state.resumeToken;
  if (!token || !token.id.trim() || !token.createdAt.trim() || !Number.isFinite(Date.parse(token.createdAt)) || token.workflowRevision !== workflowRevision || token.checkpointId !== checkpointId) return state;
  if (expectedOperationId !== undefined && token.operationId !== expectedOperationId) return state;
  return { ...state, resumeToken: null, interruption: 'none', offline: false };
}

export function setMobileLowData(state: AiDesignMobileRecoveryState, lowData: boolean): AiDesignMobileRecoveryState {
  return { ...state, lowData };
}

export function assertAiDesignMobileRecoveryState(state: AiDesignMobileRecoveryState): void {
  if (state.schema !== AI_DESIGN_MOBILE_RECOVERY_SCHEMA) throw new Error('invalid_mobile_recovery_schema');
  if (state.keyboardVisible && state.keyboardHeight < 0) throw new Error('invalid_keyboard_height');
  if (state.gesture?.dirty && state.interruption !== 'none') throw new Error('interrupted_gesture_must_be_discarded');
  if (state.selection && state.selection.workflowRevision < 0) throw new Error('invalid_selection_revision');
  if (state.resumeToken && (!state.resumeToken.id.trim() || !state.resumeToken.checkpointId.trim() || !Number.isFinite(Date.parse(state.resumeToken.createdAt)))) throw new Error('invalid_resume_token');
}
