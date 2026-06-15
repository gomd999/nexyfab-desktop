/** @vitest-environment jsdom */
/**
 * useFeatureTreeStorage — hook-level coverage for the localStorage adapter.
 *
 * Validates:
 *   - mount with empty/missing key → empty tree
 *   - setTree → debounced (500 ms) write
 *   - key change → reload from new key + flush previous key
 *   - corrupted localStorage payload → fallback to empty tree
 *   - shared key, two hook instances → last setter wins
 *   - unmount → debounce timer cleared (no late write, no leaked timer)
 *
 * Uses vi.useFakeTimers() so the 500 ms debounce doesn't make the test
 * suite slow; the real-time behaviour is verified by advancing timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useFeatureTreeStorage,
  serializeFeatureTree,
  FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS,
} from '@/lib/cad/featureTreePersist';
import type { FeatureTree, FeatureNode, FeaturePayload } from '@/lib/cad/featureTree';

const extrudePayload: FeaturePayload = {
  kind: 'extrude',
  loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  depth: 2,
  direction: 'one_sided',
  mode: 'add',
};

function makeNode(id: string): FeatureNode {
  return { id, name: id, dependencies: [], payload: extrudePayload };
}

const KEY = 'nexyfab:test:tree';

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('useFeatureTreeStorage — mount', () => {
  it('empty localStorage → empty tree on mount', () => {
    const { result } = renderHook(() => useFeatureTreeStorage(KEY));
    expect(result.current[0].nodes).toEqual([]);
  });

  it('valid pre-existing blob → loads tree on mount', () => {
    const tree: FeatureTree = { nodes: [makeNode('preload')] };
    window.localStorage.setItem(KEY, serializeFeatureTree(tree));
    const { result } = renderHook(() => useFeatureTreeStorage(KEY));
    expect(result.current[0].nodes).toHaveLength(1);
    expect(result.current[0].nodes[0]!.id).toBe('preload');
  });

  it('corrupted localStorage payload → falls back to empty tree (no throw)', () => {
    window.localStorage.setItem(KEY, '{not valid json');
    const { result } = renderHook(() => useFeatureTreeStorage(KEY));
    expect(result.current[0].nodes).toEqual([]);
  });

  it('valid JSON but wrong schema version → falls back to empty tree', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ version: 99, tree: { nodes: [] } }));
    const { result } = renderHook(() => useFeatureTreeStorage(KEY));
    expect(result.current[0].nodes).toEqual([]);
  });
});

describe('useFeatureTreeStorage — auto-save debounce', () => {
  it('setTree → no write before debounce window elapses', () => {
    const { result } = renderHook(() => useFeatureTreeStorage(KEY));
    act(() => {
      result.current[1]({ nodes: [makeNode('a')] });
    });
    // immediately before 500ms: nothing should be in storage yet
    act(() => {
      vi.advanceTimersByTime(FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS - 1);
    });
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('setTree → write occurs after 500 ms', () => {
    const { result } = renderHook(() => useFeatureTreeStorage(KEY));
    act(() => {
      result.current[1]({ nodes: [makeNode('a')] });
    });
    act(() => {
      vi.advanceTimersByTime(FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS);
    });
    const raw = window.localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.tree.nodes[0].id).toBe('a');
  });

  it('successive setTree calls collapse to one write', () => {
    const { result } = renderHook(() => useFeatureTreeStorage(KEY));
    act(() => {
      result.current[1]({ nodes: [makeNode('a')] });
    });
    act(() => {
      vi.advanceTimersByTime(100);
      result.current[1]({ nodes: [makeNode('b')] });
    });
    act(() => {
      vi.advanceTimersByTime(100);
      result.current[1]({ nodes: [makeNode('c')] });
    });
    // total elapsed = 200ms + 500ms more = 700ms → 1 write of the last value
    act(() => {
      vi.advanceTimersByTime(FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS);
    });
    const parsed = JSON.parse(window.localStorage.getItem(KEY)!);
    expect(parsed.tree.nodes[0].id).toBe('c');
  });

  it('setTree with updater function reads previous state', () => {
    const { result } = renderHook(() => useFeatureTreeStorage(KEY));
    act(() => {
      result.current[1]({ nodes: [makeNode('a')] });
    });
    act(() => {
      result.current[1]((prev) => ({ nodes: [...prev.nodes, makeNode('b')] }));
    });
    act(() => {
      vi.advanceTimersByTime(FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS);
    });
    const parsed = JSON.parse(window.localStorage.getItem(KEY)!);
    expect(parsed.tree.nodes.map((n: { id: string }) => n.id)).toEqual(['a', 'b']);
  });
});

describe('useFeatureTreeStorage — key change', () => {
  it('rerender with a new key → loads new tree', () => {
    const treeA: FeatureTree = { nodes: [makeNode('from-a')] };
    const treeB: FeatureTree = { nodes: [makeNode('from-b')] };
    window.localStorage.setItem('keyA', serializeFeatureTree(treeA));
    window.localStorage.setItem('keyB', serializeFeatureTree(treeB));

    const { result, rerender } = renderHook(({ k }: { k: string }) => useFeatureTreeStorage(k), {
      initialProps: { k: 'keyA' },
    });
    expect(result.current[0].nodes[0]!.id).toBe('from-a');

    rerender({ k: 'keyB' });
    expect(result.current[0].nodes[0]!.id).toBe('from-b');
  });

  it('key change flushes any pending write for the previous key', () => {
    const { result, rerender } = renderHook(({ k }: { k: string }) => useFeatureTreeStorage(k), {
      initialProps: { k: 'keyA' },
    });
    act(() => {
      result.current[1]({ nodes: [makeNode('to-a')] });
    });
    // before debounce fires, switch keys → previous write should flush
    rerender({ k: 'keyB' });
    const rawA = window.localStorage.getItem('keyA');
    expect(rawA).not.toBeNull();
    const parsedA = JSON.parse(rawA!);
    expect(parsedA.tree.nodes[0].id).toBe('to-a');
  });
});

describe('useFeatureTreeStorage — multiple instances same key', () => {
  it('two hooks, last setter writes last value', () => {
    const { result: h1 } = renderHook(() => useFeatureTreeStorage(KEY));
    const { result: h2 } = renderHook(() => useFeatureTreeStorage(KEY));
    act(() => {
      h1.current[1]({ nodes: [makeNode('from-h1')] });
    });
    act(() => {
      vi.advanceTimersByTime(FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS);
    });
    act(() => {
      h2.current[1]({ nodes: [makeNode('from-h2')] });
    });
    act(() => {
      vi.advanceTimersByTime(FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS);
    });
    const parsed = JSON.parse(window.localStorage.getItem(KEY)!);
    expect(parsed.tree.nodes[0].id).toBe('from-h2');
  });
});

describe('useFeatureTreeStorage — unmount cleanup', () => {
  it('unmount before debounce → no write (timer cleared)', () => {
    const { result, unmount } = renderHook(() => useFeatureTreeStorage(KEY));
    act(() => {
      result.current[1]({ nodes: [makeNode('never-saved')] });
    });
    // unmount before 500 ms
    unmount();
    act(() => {
      vi.advanceTimersByTime(FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS * 2);
    });
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('unmount → vi.getTimerCount() reports zero pending timers', () => {
    const { result, unmount } = renderHook(() => useFeatureTreeStorage(KEY));
    act(() => {
      result.current[1]({ nodes: [makeNode('x')] });
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useFeatureTreeStorage — onError callback', () => {
  it('quota_exceeded surfaces via onError', () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useFeatureTreeStorage(KEY, { onError }));

    // Patch setItem to simulate QuotaExceededError.
    const original = window.localStorage.setItem.bind(window.localStorage);
    const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    });
    try {
      act(() => {
        result.current[1]({ nodes: [makeNode('big')] });
      });
      act(() => {
        vi.advanceTimersByTime(FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS);
      });
      expect(onError).toHaveBeenCalledWith('quota_exceeded', expect.any(String));
    } finally {
      spy.mockRestore();
      // restore reference so afterEach.clear works
      window.localStorage.setItem = original;
    }
  });
});
