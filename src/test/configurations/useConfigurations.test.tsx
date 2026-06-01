// @vitest-environment jsdom
/**
 * useConfigurations.test.tsx — hook-level coverage for the manager
 * layer. Exercises:
 *
 *   - empty initial state, then add/rename/switch/remove
 *   - subscribing component re-renders on every mutation
 *   - inert mode when store is `null` (no throws)
 *   - param overrides applied via add(name, overrides)
 *   - updateParamOverrides bulk path
 *   - switchTo(null) returns to master
 *
 * Uses @testing-library/react's `renderHook` since the hook touches
 * useSyncExternalStore which needs a real React render tree.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ConfigStore } from '@/app/[lang]/shape-generator/configurations/ConfigStore';
import { useConfigurations } from '@/app/[lang]/shape-generator/configurations/useConfigurations';

describe('useConfigurations — empty/null cases', () => {
  it('returns an inert snapshot when store is null', () => {
    const { result } = renderHook(() => useConfigurations(null));
    expect(result.current.list).toEqual([]);
    expect(result.current.activeId).toBeNull();
    expect(result.current.active).toBeNull();
  });

  it('inert remove/rename/switchTo are safe no-ops (return false)', () => {
    const { result } = renderHook(() => useConfigurations(null));
    expect(result.current.remove('x')).toBe(false);
    expect(result.current.rename('x', 'y')).toBe(false);
    expect(result.current.switchTo('x')).toBe(false);
    expect(() => result.current.updateParamOverrides('x', [['f', 'k', 1]])).not.toThrow();
  });

  it('inert add throws (callers must guard)', () => {
    const { result } = renderHook(() => useConfigurations(null));
    expect(() => result.current.add('A')).toThrow(/store is null/);
  });

  it('returns empty list for a fresh store', () => {
    const store = ConfigStore.local();
    const { result } = renderHook(() => useConfigurations(store));
    expect(result.current.list).toEqual([]);
    expect(result.current.activeId).toBeNull();
  });
});

describe('useConfigurations — add / switch / rename / remove', () => {
  it('add() creates a config and the hook re-renders', () => {
    const store = ConfigStore.local();
    const { result } = renderHook(() => useConfigurations(store));

    act(() => { result.current.add('Small'); });

    expect(result.current.list).toHaveLength(1);
    expect(result.current.list[0]!.name).toBe('Small');
    // First add auto-activates per ConfigurationTable semantics.
    expect(result.current.activeId).toBe(result.current.list[0]!.id);
    expect(result.current.active?.name).toBe('Small');
  });

  it('switchTo(null) returns to master', () => {
    const store = ConfigStore.local();
    const { result } = renderHook(() => useConfigurations(store));

    act(() => { result.current.add('A'); });
    expect(result.current.activeId).not.toBeNull();

    act(() => { result.current.switchTo(null); });
    expect(result.current.activeId).toBeNull();
    expect(result.current.active).toBeNull();
  });

  it('switchTo(id) switches between configs', () => {
    const store = ConfigStore.local();
    const { result } = renderHook(() => useConfigurations(store));

    let aId = '';
    let bId = '';
    act(() => {
      aId = result.current.add('A').id;
      bId = result.current.add('B').id;
    });
    // First-add auto-activates A, second-add does not change active.
    expect(result.current.activeId).toBe(aId);

    act(() => { result.current.switchTo(bId); });
    expect(result.current.activeId).toBe(bId);
  });

  it('rename() updates the name and triggers re-render', () => {
    const store = ConfigStore.local();
    const { result } = renderHook(() => useConfigurations(store));

    let id = '';
    act(() => { id = result.current.add('Old').id; });

    act(() => { result.current.rename(id, 'New'); });
    expect(result.current.list[0]!.name).toBe('New');
  });

  it('remove() drops the entry and clears active when it was active', () => {
    const store = ConfigStore.local();
    const { result } = renderHook(() => useConfigurations(store));

    let id = '';
    act(() => { id = result.current.add('A').id; });
    expect(result.current.activeId).toBe(id);

    act(() => { result.current.remove(id); });
    expect(result.current.list).toHaveLength(0);
    expect(result.current.activeId).toBeNull();
  });
});

describe('useConfigurations — param overrides', () => {
  it('add() applies paramOverrides map', () => {
    const store = ConfigStore.local();
    const { result } = renderHook(() => useConfigurations(store));

    let id = '';
    act(() => {
      id = result.current.add('Small', { f1: { radius: 5, depth: 10 } }).id;
    });

    const entry = store.get(id);
    expect(entry?.overrides.f1).toEqual({ params: { radius: 5, depth: 10 } });
  });

  it('updateParamOverrides bulk-applies', () => {
    const store = ConfigStore.local();
    const { result } = renderHook(() => useConfigurations(store));

    let id = '';
    act(() => { id = result.current.add('A').id; });

    act(() => {
      result.current.updateParamOverrides(id, [
        ['f1', 'r', 3],
        ['f2', 'w', 'expr*2'],
      ]);
    });

    const entry = store.get(id);
    expect(entry?.overrides.f1).toEqual({ params: { r: 3 } });
    expect(entry?.overrides.f2).toEqual({ params: { w: 'expr*2' } });
  });
});

describe('useConfigurations — subscription identity', () => {
  it('snapshot reference is stable across renders without mutation', () => {
    const store = ConfigStore.local();
    store.add('A');
    const { result, rerender } = renderHook(() => useConfigurations(store));
    const firstList = result.current.list;
    rerender();
    // No store mutation between renders → same reference.
    expect(result.current.list).toBe(firstList);
  });

  it('snapshot reference changes after a mutation', () => {
    const store = ConfigStore.local();
    const { result } = renderHook(() => useConfigurations(store));
    act(() => { store.add('A'); });
    const firstList = result.current.list;
    act(() => { store.add('B'); });
    expect(result.current.list).not.toBe(firstList);
    expect(result.current.list).toHaveLength(2);
  });
});
