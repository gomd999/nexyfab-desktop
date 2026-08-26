// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useKeyboardShortcuts, type KeyboardShortcutDeps } from './useKeyboardShortcuts';

function deps(isReadOnly: boolean): KeyboardShortcutDeps {
  return {
    isPreviewMode: false,
    handleCancelPreview: vi.fn(),
    isSketchMode: false,
    setIsSketchMode: vi.fn(),
    showAIAssistant: false,
    setShowAIAssistant: vi.fn(),
    editMode: 'none',
    setEditMode: vi.fn(),
    transformMode: 'off',
    setTransformMode: vi.fn(),
    measureActive: false,
    setMeasureActive: vi.fn(),
    toggleMeasure: vi.fn(),
    setShowDimensions: vi.fn(),
    handleHistoryUndo: vi.fn(),
    handleHistoryRedo: vi.fn(),
    sketchTool: 'select',
    setSketchTool: vi.fn(),
    handleSaveNfab: vi.fn(),
    handleSaveNfabCloud: vi.fn(),
    handleLoadNfab: vi.fn(),
    handleSketchRedo: vi.fn(),
    handleShowContextHelp: vi.fn(),
    isReadOnly,
  };
}

function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcuts read-only access boundary', () => {
  beforeEach(() => localStorage.clear());

  it('blocks save, cloud save, import, history and transform mutations', () => {
    const d = deps(true);
    renderHook(() => useKeyboardShortcuts(d));

    expect(press('s', { ctrlKey: true }).defaultPrevented).toBe(true);
    press('S', { ctrlKey: true, shiftKey: true });
    press('o', { ctrlKey: true });
    press('z', { ctrlKey: true });
    press('y', { ctrlKey: true });
    press('t');
    press('1');

    expect(d.handleSaveNfab).not.toHaveBeenCalled();
    expect(d.handleSaveNfabCloud).not.toHaveBeenCalled();
    expect(d.handleLoadNfab).not.toHaveBeenCalled();
    expect(d.handleHistoryUndo).not.toHaveBeenCalled();
    expect(d.handleHistoryRedo).not.toHaveBeenCalled();
    expect(d.setTransformMode).not.toHaveBeenCalled();
    expect(d.setEditMode).not.toHaveBeenCalled();
  });

  it('keeps view and measurement shortcuts available in read-only mode', () => {
    const d = deps(true);
    const view = vi.fn();
    window.addEventListener('nexyfab:view', view);
    const { unmount } = renderHook(() => useKeyboardShortcuts(d));

    press('Home');
    press('m');

    expect(view).toHaveBeenCalledTimes(1);
    expect(d.toggleMeasure).toHaveBeenCalledTimes(1);
    unmount();
    window.removeEventListener('nexyfab:view', view);
  });

  it('preserves normal editing shortcuts', () => {
    const d = deps(false);
    renderHook(() => useKeyboardShortcuts(d));

    press('s', { ctrlKey: true });
    press('o', { ctrlKey: true });
    press('z', { ctrlKey: true });
    press('t');

    expect(d.handleSaveNfab).toHaveBeenCalledTimes(1);
    expect(d.handleLoadNfab).toHaveBeenCalledTimes(1);
    expect(d.handleHistoryUndo).toHaveBeenCalledTimes(1);
    expect(d.setTransformMode).toHaveBeenCalledWith('translate');
  });

  it('ignores shortcuts from editable targets and removes listeners on unmount', () => {
    const d = deps(false);
    const { unmount } = renderHook(() => useKeyboardShortcuts(d));
    const input = document.createElement('input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    expect(d.handleSaveNfab).not.toHaveBeenCalled();
    unmount();
    press('s', { ctrlKey: true });
    expect(d.handleSaveNfab).not.toHaveBeenCalled();
  });
});
