// @vitest-environment jsdom
/**
 * useAssemblyHistory — React hook integration tests.
 *
 * Covers:
 *   - Mount returns the initial state and an "Initial" description.
 *   - recordChange updates state + bumps description.
 *   - undo / redo navigate.
 *   - canUndo / canRedo reflect stack state.
 *   - reset returns to initial.
 *   - history exposes recent entries for the UI panel.
 *   - storageKey persists the present across re-mounts.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAssemblyHistory } from '@/lib/assembly/assemblyHistory';
import {
  partInstance,
  IDENTITY_QUAT,
  type AssemblyState,
  type PartInstance,
} from '@/lib/assembly/assemblyState';

function makePart(id: string, fixed = true, x = 0): PartInstance {
  return partInstance({
    id,
    name: id,
    partTemplateId: `tpl_${id}`,
    position: { x, y: 0, z: 0 },
    orientation: IDENTITY_QUAT,
    fixed,
  });
}

function withPart(id: string, fixed = true): AssemblyState {
  return { parts: [makePart(id, fixed)], mates: [] };
}

const EMPTY: AssemblyState = { parts: [], mates: [] };

describe('useAssemblyHistory — basics', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  it('mounts with the initial state and an Initial description', () => {
    const { result } = renderHook(() => useAssemblyHistory(EMPTY));
    expect(result.current.state).toEqual(EMPTY);
    expect(result.current.description.length).toBeGreaterThan(0);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('recordChange updates state and description', () => {
    const { result } = renderHook(() => useAssemblyHistory(EMPTY));
    act(() => {
      result.current.recordChange(withPart('bracket_a'), 'Add part bracket_a');
    });
    expect(result.current.state.parts).toHaveLength(1);
    expect(result.current.state.parts[0]!.id).toBe('bracket_a');
    expect(result.current.description).toBe('Add part bracket_a');
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('undo restores the previous state and flips canRedo on', () => {
    const { result } = renderHook(() => useAssemblyHistory(EMPTY));
    act(() => result.current.recordChange(withPart('a'), 'Add a'));
    act(() => result.current.recordChange(withPart('b'), 'Add b'));
    expect(result.current.state.parts[0]!.id).toBe('b');

    act(() => result.current.undo());
    expect(result.current.state.parts[0]!.id).toBe('a');
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);
  });

  it('redo replays an undone state', () => {
    const { result } = renderHook(() => useAssemblyHistory(EMPTY));
    act(() => result.current.recordChange(withPart('a'), 'Add a'));
    act(() => result.current.undo());
    expect(result.current.state).toEqual(EMPTY);

    act(() => result.current.redo());
    expect(result.current.state.parts).toHaveLength(1);
    expect(result.current.description).toBe('Add a');
    expect(result.current.canRedo).toBe(false);
  });

  it('reset returns to the initial state and clears stacks', () => {
    const { result } = renderHook(() => useAssemblyHistory(EMPTY));
    act(() => result.current.recordChange(withPart('a'), 'Add a'));
    act(() => result.current.recordChange(withPart('b'), 'Add b'));

    act(() => result.current.reset());
    expect(result.current.state).toEqual(EMPTY);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('history list exposes recent entries for a UI panel', () => {
    const { result } = renderHook(() => useAssemblyHistory(EMPTY));
    act(() => result.current.recordChange(withPart('a'), 'Add a'));
    act(() => result.current.recordChange(withPart('b'), 'Add b'));
    act(() => result.current.recordChange(withPart('c'), 'Add c'));

    expect(result.current.history.length).toBeLessThanOrEqual(10);
    // Present is the first entry — UI lists most-recent first.
    expect(result.current.history[0]!.description).toBe('Add c');
    // All three change descriptions should appear in the recent list.
    const descs = result.current.history.map((h) => h.description);
    expect(descs).toContain('Add a');
    expect(descs).toContain('Add b');
    expect(descs).toContain('Add c');
  });

  it('history list caps at 10 entries even with many changes', () => {
    const { result } = renderHook(() => useAssemblyHistory(EMPTY));
    act(() => {
      for (let i = 0; i < 20; i++) {
        result.current.recordChange(withPart(`p${i}`), `add p${i}`);
      }
    });
    expect(result.current.history.length).toBeLessThanOrEqual(10);
    expect(result.current.history[0]!.description).toBe('add p19');
  });

  it('throwing recordChange does not advance history', () => {
    const { result } = renderHook(() => useAssemblyHistory(EMPTY));
    const bad: AssemblyState = { parts: [makePart('floating', /*fixed*/ false)], mates: [] };
    expect(() => {
      act(() => result.current.recordChange(bad, 'broken'));
    }).toThrow();
    expect(result.current.state).toEqual(EMPTY);
    expect(result.current.canUndo).toBe(false);
  });

  it('honours a custom maxHistory option', () => {
    const { result } = renderHook(() =>
      useAssemblyHistory(EMPTY, { maxHistory: 2 }),
    );
    act(() => {
      result.current.recordChange(withPart('a'), 'A');
      result.current.recordChange(withPart('b'), 'B');
      result.current.recordChange(withPart('c'), 'C');
      result.current.recordChange(withPart('d'), 'D');
    });

    // Walk back as far as possible — should only get 2 undos.
    act(() => result.current.undo());
    expect(result.current.description).toBe('C');
    act(() => result.current.undo());
    expect(result.current.description).toBe('B');
    expect(result.current.canUndo).toBe(false);
  });
});

describe('useAssemblyHistory — storageKey persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists the current present across remounts', () => {
    const KEY = 'asm:hist:test:persist1';
    const { result, unmount } = renderHook(() =>
      useAssemblyHistory(EMPTY, { storageKey: KEY }),
    );
    act(() => result.current.recordChange(withPart('alpha'), 'Add alpha'));
    // Flush the 500ms debounce inside useAssemblyStorage.
    act(() => {
      vi.advanceTimersByTime(600);
    });
    unmount();

    const { result: r2 } = renderHook(() =>
      useAssemblyHistory(EMPTY, { storageKey: KEY }),
    );
    expect(r2.current.state.parts).toHaveLength(1);
    expect(r2.current.state.parts[0]!.id).toBe('alpha');
    // After remount, history starts fresh — the rehydrated state is the
    // initial entry, not an undoable past.
    expect(r2.current.canUndo).toBe(false);
  });

  it('does not persist past/future stacks (fresh history after reload)', () => {
    const KEY = 'asm:hist:test:persist2';
    const { result, unmount } = renderHook(() =>
      useAssemblyHistory(EMPTY, { storageKey: KEY }),
    );
    act(() => result.current.recordChange(withPart('a'), 'Add a'));
    act(() => result.current.recordChange(withPart('b'), 'Add b'));
    act(() => result.current.undo());
    act(() => {
      vi.advanceTimersByTime(600);
    });
    unmount();

    const { result: r2 } = renderHook(() =>
      useAssemblyHistory(EMPTY, { storageKey: KEY }),
    );
    // The present at the moment of the last flush was state 'a' (we undid 'b').
    expect(r2.current.state.parts[0]!.id).toBe('a');
    expect(r2.current.canUndo).toBe(false);
    expect(r2.current.canRedo).toBe(false);
  });
});
