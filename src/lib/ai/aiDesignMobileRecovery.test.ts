import { describe, expect, it } from 'vitest';
import {
  assertAiDesignMobileRecoveryState,
  beginMobileGesture,
  commitMobileGesture,
  consumeMobileResumeToken,
  createAiDesignMobileRecoveryState,
  createMobileResumeToken,
  discardMobileGesture,
  setMobileConnectivity,
  setMobileKeyboard,
  setMobileSelection,
  setMobileSheetSnap,
} from './aiDesignMobileRecovery';

const selection = { entityId: 'face-1', entityType: 'face' as const, workflowRevision: 3, checkpointId: 'cp-3' };

describe('AI design mobile recovery', () => {
  it('supports peek/half/expanded sheets, keyboard and safe selection preservation', () => {
    let state = createAiDesignMobileRecoveryState({ safeArea: { top: 10, right: 0, bottom: 24, left: 0 } });
    expect(state.snap).toBe('peek');
    state = setMobileSheetSnap(state, 'half');
    state = setMobileKeyboard(state, true, 300);
    expect(state).toMatchObject({ snap: 'expanded', keyboardVisible: true, keyboardHeight: 300 });
    state = setMobileSelection(state, selection, 3);
    expect(state).toMatchObject({ selection, preservedSelection: true });
    state = setMobileSelection(state, selection, 4);
    expect(state.selection).toBeNull();
    expect(() => assertAiDesignMobileRecoveryState(state)).not.toThrow();
  });

  it('discards pending gesture on camera interruption or offline and never commits it', () => {
    let state = createAiDesignMobileRecoveryState();
    state = setMobileSelection(state, selection);
    state = beginMobileGesture(state, { id: 'g-1', selection, beforeValue: 10, draftValue: 12, unit: 'mm', dirty: true });
    state = discardMobileGesture(state, 'gesture-camera');
    expect(state).toMatchObject({ gesture: null, interruption: 'gesture-camera', pendingGestureDiscarded: true, selection });
    expect(commitMobileGesture(state)).toEqual(state);
    state = beginMobileGesture({ ...state, interruption: 'none' }, { id: 'g-2', selection, beforeValue: 12, draftValue: 14, unit: 'mm', dirty: true });
    state = setMobileConnectivity(state, true);
    expect(state).toMatchObject({ offline: true, interruption: 'offline', gesture: null, pendingGestureDiscarded: true });
  });

  it('creates and consumes a revision-bound resume token', () => {
    let state = createAiDesignMobileRecoveryState();
    state = createMobileResumeToken(state, { workflowRevision: 3, checkpointId: 'cp-3', operationId: 'run-3', createdAt: '2026-08-24T00:00:00Z' });
    expect(state.resumeToken?.id).toBe('cp-3:3');
    expect(consumeMobileResumeToken(state, 2, 'cp-3', 'run-3')).toEqual(state);
    expect(consumeMobileResumeToken(state, 3, 'cp-3', 'other')).toEqual(state);
    state = consumeMobileResumeToken(state, 3, 'cp-3', 'run-3');
    expect(state.resumeToken).toBeNull();
    expect(state.offline).toBe(false);
    expect(createMobileResumeToken(createAiDesignMobileRecoveryState(), { workflowRevision: 3, checkpointId: 'cp-3', operationId: 'run-3', createdAt: 'invalid' }).resumeToken).toBeNull();
  });
});
