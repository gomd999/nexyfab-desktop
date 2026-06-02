/** @vitest-environment jsdom */
/**
 * useFeatureTreeHistory — React hook coverage.
 *
 * Combines the pure history stack with optional localStorage persistence
 * via useFeatureTreeStorage. Tests use renderHook + fake timers because
 * the persistence layer debounces writes by 500 ms.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFeatureTreeHistory } from '@/lib/cad/featureTreeHistory';
import {
  serializeFeatureTree,
  FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS,
} from '@/lib/cad/featureTreePersist';
import type { FeatureTree, FeatureNode, FeaturePayload } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

// ─── factories ────────────────────────────────────────────────────────────

const baseExtrude: ExtrudeFeature = {
  kind: 'extrude',
  loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  depth: 1,
  direction: 'one_sided',
  mode: 'add',
};
const basePayload: FeaturePayload = baseExtrude;

function makeNode(id: string, depth = 1): FeatureNode {
  return {
    id,
    name: id,
    dependencies: [],
    payload: { ...baseExtrude, depth } satisfies FeaturePayload,
  };
}

function makeTree(...nodes: FeatureNode[]): FeatureTree {
  return { nodes };
}

const KEY = 'nexyfab:test:history';

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

// ─── mount ────────────────────────────────────────────────────────────────

describe('useFeatureTreeHistory — mount', () => {
  it('no initialTree → starts with empty tree', () => {
    const { result } = renderHook(() => useFeatureTreeHistory());
    expect(result.current.tree.nodes).toEqual([]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('initialTree is honored as the present', () => {
    const tree = makeTree(makeNode('seed'));
    const { result } = renderHook(() => useFeatureTreeHistory(tree));
    expect(result.current.tree.nodes[0]!.id).toBe('seed');
  });

  it('storageKey with no saved data → uses initialTree', () => {
    const tree = makeTree(makeNode('seed'));
    const { result } = renderHook(() => useFeatureTreeHistory(tree, { storageKey: KEY }));
    expect(result.current.tree.nodes[0]!.id).toBe('seed');
  });

  it('storageKey with saved data → loads from storage (initialTree ignored)', () => {
    const saved = makeTree(makeNode('persisted'));
    window.localStorage.setItem(KEY, serializeFeatureTree(saved));
    const initial = makeTree(makeNode('seed'));
    const { result } = renderHook(() => useFeatureTreeHistory(initial, { storageKey: KEY }));
    expect(result.current.tree.nodes[0]!.id).toBe('persisted');
  });
});

// ─── apply / undo / redo ─────────────────────────────────────────────────

describe('useFeatureTreeHistory — apply / undo / redo', () => {
  it('apply mutates tree, canUndo flips true', () => {
    const { result } = renderHook(() => useFeatureTreeHistory(makeTree(makeNode('a'))));
    act(() => {
      result.current.apply({ type: 'set_name', nodeId: 'a', name: 'Renamed' });
    });
    expect(result.current.tree.nodes[0]!.name).toBe('Renamed');
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('undo restores prior tree, canRedo flips true', () => {
    const { result } = renderHook(() => useFeatureTreeHistory(makeTree(makeNode('a'))));
    act(() => {
      result.current.apply({ type: 'set_name', nodeId: 'a', name: 'B' });
    });
    act(() => {
      result.current.undo();
    });
    expect(result.current.tree.nodes[0]!.name).toBe('a');
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it('redo re-applies undone edit', () => {
    const { result } = renderHook(() => useFeatureTreeHistory(makeTree(makeNode('a'))));
    act(() => {
      result.current.apply({ type: 'set_name', nodeId: 'a', name: 'B' });
    });
    act(() => {
      result.current.undo();
    });
    act(() => {
      result.current.redo();
    });
    expect(result.current.tree.nodes[0]!.name).toBe('B');
    expect(result.current.canRedo).toBe(false);
  });

  it('apply after undo invalidates redo chain', () => {
    const { result } = renderHook(() => useFeatureTreeHistory(makeTree(makeNode('a'))));
    act(() => {
      result.current.apply({ type: 'set_name', nodeId: 'a', name: 'B' });
    });
    act(() => {
      result.current.apply({ type: 'set_name', nodeId: 'a', name: 'C' });
    });
    act(() => {
      result.current.undo();
    });
    expect(result.current.canRedo).toBe(true);
    act(() => {
      result.current.apply({ type: 'set_name', nodeId: 'a', name: 'Z' });
    });
    expect(result.current.canRedo).toBe(false);
    expect(result.current.tree.nodes[0]!.name).toBe('Z');
  });

  it('undo with empty past is a safe no-op (no throw, no state change)', () => {
    const { result } = renderHook(() => useFeatureTreeHistory(makeTree(makeNode('a'))));
    const before = result.current.tree;
    act(() => {
      result.current.undo();
    });
    expect(result.current.tree).toBe(before);
  });

  it('multiple sequential edits all undo-able', () => {
    const { result } = renderHook(() => useFeatureTreeHistory(makeTree(makeNode('a'))));
    for (const name of ['B', 'C', 'D', 'E']) {
      act(() => {
        result.current.apply({ type: 'set_name', nodeId: 'a', name });
      });
    }
    expect(result.current.tree.nodes[0]!.name).toBe('E');
    // undo 4 times back to "a"
    for (let i = 0; i < 4; i++) {
      act(() => {
        result.current.undo();
      });
    }
    expect(result.current.tree.nodes[0]!.name).toBe('a');
  });
});

// ─── reset ────────────────────────────────────────────────────────────────

describe('useFeatureTreeHistory — reset', () => {
  it('reset reverts to the seed and clears past/future', () => {
    const seed = makeTree(makeNode('a'));
    const { result } = renderHook(() => useFeatureTreeHistory(seed));
    act(() => {
      result.current.apply({ type: 'set_name', nodeId: 'a', name: 'B' });
    });
    act(() => {
      result.current.apply({ type: 'set_name', nodeId: 'a', name: 'C' });
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.tree.nodes[0]!.name).toBe('a');
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('reset with no initialTree returns to empty tree', () => {
    const { result } = renderHook(() => useFeatureTreeHistory());
    act(() => {
      result.current.apply({
        type: 'insert_node',
        node: makeNode('x'),
      });
    });
    expect(result.current.tree.nodes).toHaveLength(1);
    act(() => {
      result.current.reset();
    });
    expect(result.current.tree.nodes).toEqual([]);
  });
});

// ─── maxHistory ──────────────────────────────────────────────────────────

describe('useFeatureTreeHistory — maxHistory', () => {
  it('maxHistory caps undo depth', () => {
    const { result } = renderHook(() =>
      useFeatureTreeHistory(makeTree(makeNode('a')), { maxHistory: 2 }),
    );
    for (const name of ['B', 'C', 'D', 'E']) {
      act(() => {
        result.current.apply({ type: 'set_name', nodeId: 'a', name });
      });
    }
    // Only 2 past entries → can undo twice, then no further.
    expect(result.current.tree.nodes[0]!.name).toBe('E');
    act(() => { result.current.undo(); });
    expect(result.current.tree.nodes[0]!.name).toBe('D');
    act(() => { result.current.undo(); });
    expect(result.current.tree.nodes[0]!.name).toBe('C');
    expect(result.current.canUndo).toBe(false);
  });
});

// ─── persistence integration ─────────────────────────────────────────────

describe('useFeatureTreeHistory — persistence', () => {
  it('apply persists present tree to localStorage (debounced)', () => {
    const { result } = renderHook(() =>
      useFeatureTreeHistory(makeTree(makeNode('a')), { storageKey: KEY }),
    );
    act(() => {
      result.current.apply({ type: 'set_name', nodeId: 'a', name: 'B' });
    });
    // Before debounce window: no write yet.
    expect(window.localStorage.getItem(KEY)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS);
    });
    const raw = window.localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.tree.nodes[0].name).toBe('B');
  });

  it('undo also persists the reverted tree', () => {
    const { result } = renderHook(() =>
      useFeatureTreeHistory(makeTree(makeNode('a')), { storageKey: KEY }),
    );
    act(() => {
      result.current.apply({ type: 'set_name', nodeId: 'a', name: 'B' });
    });
    act(() => {
      vi.advanceTimersByTime(FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS);
    });
    act(() => {
      result.current.undo();
    });
    act(() => {
      vi.advanceTimersByTime(FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS);
    });
    const parsed = JSON.parse(window.localStorage.getItem(KEY)!);
    expect(parsed.tree.nodes[0].name).toBe('a');
  });

  it('history is NOT persisted — remount starts with empty past/future', () => {
    const tree0 = makeTree(makeNode('a'));
    const { result, unmount } = renderHook(() =>
      useFeatureTreeHistory(tree0, { storageKey: KEY }),
    );
    act(() => {
      result.current.apply({ type: 'set_name', nodeId: 'a', name: 'B' });
    });
    act(() => {
      vi.advanceTimersByTime(FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS);
    });
    expect(result.current.canUndo).toBe(true);
    unmount();

    // Remount: should load "B" from storage but with no undo history.
    const { result: r2 } = renderHook(() =>
      useFeatureTreeHistory(tree0, { storageKey: KEY }),
    );
    expect(r2.current.tree.nodes[0]!.name).toBe('B');
    expect(r2.current.canUndo).toBe(false);
    expect(r2.current.canRedo).toBe(false);
  });

  it('no storageKey → no localStorage writes', () => {
    const { result } = renderHook(() =>
      useFeatureTreeHistory(makeTree(makeNode('a'))),
    );
    act(() => {
      result.current.apply({ type: 'set_name', nodeId: 'a', name: 'B' });
    });
    act(() => {
      vi.advanceTimersByTime(FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS * 2);
    });
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

// ─── identity stability ───────────────────────────────────────────────────

describe('useFeatureTreeHistory — identity', () => {
  it('apply / undo / redo / reset callback identities are stable across renders', () => {
    const { result, rerender } = renderHook(() =>
      useFeatureTreeHistory(makeTree(makeNode('a'))),
    );
    const apply0 = result.current.apply;
    const undo0 = result.current.undo;
    const redo0 = result.current.redo;
    const reset0 = result.current.reset;
    rerender();
    expect(result.current.apply).toBe(apply0);
    expect(result.current.undo).toBe(undo0);
    expect(result.current.redo).toBe(redo0);
    expect(result.current.reset).toBe(reset0);
  });

  it('tree identity changes only on actual transitions', () => {
    const { result } = renderHook(() =>
      useFeatureTreeHistory(makeTree(makeNode('a'))),
    );
    const tree0 = result.current.tree;
    // undo with empty past is a no-op → same tree reference
    act(() => {
      result.current.undo();
    });
    expect(result.current.tree).toBe(tree0);
    // a real edit produces a new tree reference
    act(() => {
      result.current.apply({ type: 'set_name', nodeId: 'a', name: 'B' });
    });
    expect(result.current.tree).not.toBe(tree0);
  });
});

// Ensure unused factory satisfies type checker (used in cross-test refs).
void basePayload;
