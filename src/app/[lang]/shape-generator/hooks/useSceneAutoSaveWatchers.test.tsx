// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSceneAutoSaveWatchers } from './useSceneAutoSaveWatchers';

function makeDeps(enabled: boolean) {
  return {
    enabled,
    viewMode: 'workspace' as const,
    selectedId: 'shape-a',
    params: { width: 10 },
    features: [] as unknown[],
    isSketchMode: false,
    sketchProfile: { closed: false },
    sketchConfig: {},
    scheduleSave: vi.fn(),
    autoSave: vi.fn(),
    buildAutoSaveState: vi.fn(() => ({}) as never),
    markNfabDirty: vi.fn(),
  };
}

describe('useSceneAutoSaveWatchers access boundary', () => {
  it('does not schedule, save, build or dirty a read-only session', () => {
    const deps = makeDeps(false);
    const { rerender } = renderHook(
      ({ selectedId }) => useSceneAutoSaveWatchers({ ...deps, selectedId }),
      { initialProps: { selectedId: 'shape-a' } },
    );
    rerender({ selectedId: 'shape-b' });

    expect(deps.scheduleSave).not.toHaveBeenCalled();
    expect(deps.autoSave).not.toHaveBeenCalled();
    expect(deps.buildAutoSaveState).not.toHaveBeenCalled();
    expect(deps.markNfabDirty).not.toHaveBeenCalled();
  });

  it('keeps transition baselines current while disabled', () => {
    const deps = makeDeps(false);
    const { rerender } = renderHook(
      ({ enabled, selectedId }) => useSceneAutoSaveWatchers({ ...deps, enabled, selectedId }),
      { initialProps: { enabled: false, selectedId: 'shape-a' } },
    );
    rerender({ enabled: false, selectedId: 'shape-b' });
    rerender({ enabled: true, selectedId: 'shape-b' });

    expect(deps.autoSave).not.toHaveBeenCalled();
    expect(deps.scheduleSave).toHaveBeenCalledTimes(1);
    expect(deps.markNfabDirty).toHaveBeenCalledTimes(1);
  });

  it('preserves normal workspace persistence', () => {
    const deps = makeDeps(true);
    renderHook(() => useSceneAutoSaveWatchers(deps));
    expect(deps.scheduleSave).toHaveBeenCalledTimes(1);
    expect(deps.markNfabDirty).toHaveBeenCalledTimes(1);
  });
});
