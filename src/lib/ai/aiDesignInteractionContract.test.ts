import { describe, expect, it } from 'vitest';
import {
  AI_DESIGN_TRACKS,
  MIN_TOUCH_TARGET_PX,
  actionsForStageStatus,
  arbitrateGesture,
  assertAiDesignInteractionState,
  beginExplicitEdit,
  cancelDesignRun,
  closeNumericFallback,
  createAiDesignInteractionState,
  ensureTouchTarget,
  openNumericFallback,
  parseNumericFallback,
  resumeDesignRun,
  selectDesignTrack,
  setBottomSheetSnap,
  setChangeExplanation,
  setPresentationMode,
  setAccessibilityFlags,
  setAxisLock,
  lockEditMode,
  startDesignRun,
  toLowDataPayload,
  updateDesignStage,
  updateGesture,
  updateLongPress,
  updateNumericFallback,
} from './aiDesignInteractionContract';

describe('AI Design headless interaction contract', () => {
  it('always exposes concept, parametric, and precision lifecycle tracks', () => {
    const state = createAiDesignInteractionState();
    expect(Object.keys(state.stages)).toEqual(AI_DESIGN_TRACKS);
    expect(Object.values(state.stages).map(stage => stage.status)).toEqual(['pending', 'pending', 'pending']);

    const verified = updateDesignStage(state, 'concept', { status: 'verified', revision: 3, summary: 'brief verified' });
    const stale = updateDesignStage(verified, 'parametric', { status: 'stale', blockers: ['concept revision changed'] });
    const blocked = updateDesignStage(stale, 'precision', { status: 'blocked', blockers: ['precision verifier unavailable'] });
    expect(blocked.stages).toMatchObject({
      concept: { status: 'verified', revision: 3 },
      parametric: { status: 'stale', blockers: ['concept revision changed'] },
      precision: { status: 'blocked' },
    });
    expect(() => assertAiDesignInteractionState(blocked)).not.toThrow();
  });

  it('switches desktop split presentation to mobile stacked bottom-sheet presentation', () => {
    const desktop = createAiDesignInteractionState();
    expect(desktop.presentation).toMatchObject({ mode: 'desktop', navigation: 'rail', canvasLayout: 'split', touchTargetMinPx: MIN_TOUCH_TARGET_PX });
    const mobile = setPresentationMode(desktop, 'mobile');
    expect(mobile.presentation).toMatchObject({ mode: 'mobile', navigation: 'bottom-sheet', canvasLayout: 'stacked', density: 'compact' });
    expect(mobile.bottomSheet).toMatchObject({ snap: 'peek', dismissible: true });
    expect(setBottomSheetSnap(mobile, 'expanded').bottomSheet.focusTrap).toBe(true);
    expect(setBottomSheetSnap(mobile, 'closed').bottomSheet.focusTrap).toBe(false);
    expect(setBottomSheetSnap(desktop, 'expanded')).toBe(desktop);
  });

  it('arbitrates one-finger editing and two-finger camera navigation', () => {
    expect(arbitrateGesture({ activePointerCount: 0 })).toMatchObject({ intent: 'none', minimumPointers: 1 });
    expect(arbitrateGesture({ activePointerCount: 1 })).toMatchObject({ intent: 'edit', cancelEdit: false, minimumPointers: 1 });
    expect(arbitrateGesture({ activePointerCount: 2 })).toMatchObject({ intent: 'camera', cancelEdit: true, minimumPointers: 2 });
    expect(updateGesture(createAiDesignInteractionState(), { activePointerCount: 2 }).gesture).toEqual({ intent: 'camera', pointerCount: 2 });
    expect(arbitrateGesture({ pointerType: 'mouse', activePointerCount: 1 }).intent).toBe('edit');
  });

  it('keeps touch targets at or above the mobile minimum', () => {
    expect(ensureTouchTarget({ width: 24, height: 60 })).toEqual({ width: 44, height: 60, min: 44, adjusted: true });
    expect(ensureTouchTarget({ width: 50, height: 50 })).toEqual({ width: 50, height: 50, min: 44, adjusted: false });
    expect(ensureTouchTarget({ width: Number.NaN, height: Number.POSITIVE_INFINITY })).toEqual({ width: 44, height: 44, min: 44, adjusted: true });
  });

  it('supports numeric fallback when dragging cannot express a precise edit', () => {
    let state = openNumericFallback(createAiDesignInteractionState(), { fieldId: 'diameter', initialValue: 10, unit: 'mm', min: 1, max: 20, step: 0.1 });
    expect(state.numericFallback).toMatchObject({ open: true, fieldId: 'diameter', value: 10, valid: true, unit: 'mm' });
    state = updateNumericFallback(state, '12,5');
    expect(state.numericFallback).toMatchObject({ rawValue: '12,5', value: 12.5, valid: true, error: null });
    expect(parseNumericFallback('not-a-number', { min: 1, max: 20 })).toMatchObject({ valid: false, error: 'invalid' });
    expect(parseNumericFallback('21', { min: 1, max: 20 })).toMatchObject({ value: 21, valid: false, error: 'out-of-range' });
    state = closeNumericFallback(state);
    expect(state.numericFallback.open).toBe(false);
  });

  it('requires a long press before edit mode and supports an explicit axis lock', () => {
    let state = createAiDesignInteractionState();
    expect(state.editSafety).toMatchObject({ mode: 'locked', lockReason: 'long-press-required', axisLock: 'none' });
    expect(beginExplicitEdit(state)).toBe(state);
    expect(setAxisLock(state, 'x')).toBe(state);
    state = updateLongPress(state, 449);
    expect(state.editSafety.longPress.ready).toBe(false);
    state = updateLongPress(state, 450);
    expect(state.editSafety).toMatchObject({ mode: 'ready', lockReason: 'none', longPress: { ready: true } });
    state = beginExplicitEdit(state);
    expect(state.editSafety.mode).toBe('editing');
    state = setAxisLock(state, 'y');
    expect(state.editSafety.axisLock).toBe('y');
    state = lockEditMode(state);
    expect(state.editSafety).toMatchObject({ mode: 'locked', lockReason: 'long-press-required', axisLock: 'none' });
    expect(() => assertAiDesignInteractionState(state)).not.toThrow();
  });

  it('carries reduced-motion and non-color status semantics as explicit flags', () => {
    let state = createAiDesignInteractionState();
    expect(state.accessibility).toEqual({ reducedMotion: false, nonColorStatus: true, announceStateChanges: true });
    state = setAccessibilityFlags(state, { reducedMotion: true, nonColorStatus: true, announceStateChanges: false });
    expect(state.accessibility).toEqual({ reducedMotion: true, nonColorStatus: true, announceStateChanges: false });
    const compact = toLowDataPayload(state);
    expect(compact).toMatchObject({ reducedMotion: true, nonColorStatus: true, editMode: 'locked', axisLock: 'none' });
  });

  it('preserves change rationale, impact, and available actions', () => {
    expect(actionsForStageStatus('pending')[0]).toMatchObject({ id: 'review', enabled: true });
    expect(actionsForStageStatus('verified').map(action => action.id)).toEqual(['accept', 'review']);
    expect(actionsForStageStatus('stale').map(action => action.id)).toEqual(['review', 'retry']);
    expect(actionsForStageStatus('blocked')[1]).toMatchObject({ id: 'retry', enabled: false });
    const change = {
      id: 'change-1',
      title: 'Increase wall thickness',
      reason: 'Required by the selected manufacturing process.',
      impact: { level: 'high' as const, affectedTracks: ['parametric', 'precision'] as const, affectedArtifacts: ['model', 'drawing'], requiresReverification: true, summary: 'Downstream geometry is stale.' },
      actions: [{ id: 'review' as const, label: 'Review impact', enabled: true }, { id: 'undo' as const, label: 'Undo', enabled: true, destructive: true }],
    };
    const state = setChangeExplanation(createAiDesignInteractionState(), change);
    expect(state.change).toEqual(change);
    expect(setChangeExplanation(state, null).change).toBeNull();
  });

  it('cancels and resumes from a durable checkpoint', () => {
    let state = startDesignRun(createAiDesignInteractionState(), 'run-1', 'checkpoint-7');
    expect(state.operation).toMatchObject({ id: 'run-1', lifecycle: 'running', checkpoint: 'checkpoint-7' });
    state = cancelDesignRun(state, 'offline');
    expect(state.operation).toMatchObject({ lifecycle: 'cancelled', cancelReason: 'offline', resumeAvailable: true });
    state = resumeDesignRun(state);
    expect(state.operation).toMatchObject({ lifecycle: 'running', resumeAvailable: false, checkpoint: 'checkpoint-7' });
    expect(resumeDesignRun(createAiDesignInteractionState())).toEqual(createAiDesignInteractionState());
  });

  it('emits a compact low-data payload without free-form explanations', () => {
    let state = createAiDesignInteractionState({ presentation: 'mobile', revision: 4 });
    state = selectDesignTrack(state, 'precision');
    state = updateDesignStage(state, 'precision', { status: 'verified', revision: 8, summary: 'A very long summary that should not travel in low-data mode.' });
    state = setChangeExplanation(state, { id: 'c', title: 'verbose title', reason: 'verbose reason', impact: { level: 'medium', affectedTracks: ['precision'], affectedArtifacts: ['model'], requiresReverification: true, summary: 'verbose' }, actions: [] });
    const compact = toLowDataPayload(state);
    expect(compact).toEqual(expect.objectContaining({ schema: 'nexyfab.ai-design-interaction.v1', selectedTrack: 'precision', presentation: 'mobile', bottomSheet: 'peek' }));
    expect(compact.stages.precision).toEqual({ status: 'verified', revision: 8 });
    expect(JSON.stringify(compact)).not.toContain('verbose');
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(state).length);
  });
});
