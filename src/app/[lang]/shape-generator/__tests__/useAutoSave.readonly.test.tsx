// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutoSave, type AutoSaveState } from '../useAutoSave';

const state: AutoSaveState = {
  version: 1,
  timestamp: 1,
  selectedId: 'box',
  params: { width: 10 },
  features: [],
  isSketchMode: false,
  activeTab: 'design',
};

describe('useAutoSave read-only boundary', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not read, write, schedule, flush or delete local recovery state when disabled', () => {
    localStorage.setItem('unrelated', 'keep');
    const { result } = renderHook(() => useAutoSave(false));

    act(() => {
      result.current.save(state);
      result.current.scheduleSave(state);
      result.current.deleteSave('unrelated');
      result.current.clearAllSaves();
      window.dispatchEvent(new Event('pagehide'));
      vi.runAllTimers();
    });

    expect(localStorage.getItem('unrelated')).toBe('keep');
    expect(localStorage.getItem('nexyfab-autosave-session-active')).toBeNull();
    expect(localStorage.getItem('nexyfab-autosave-meta')).toBeNull();
    expect(result.current.loadLatest()).toBeNull();
    expect(result.current.listSaves()).toEqual([]);
    expect(result.current.hasRecovery).toBe(false);
  });
});
