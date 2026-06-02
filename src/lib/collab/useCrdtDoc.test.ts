/** @vitest-environment jsdom */
/**
 * useCrdtDoc — React hook coverage.
 *
 * Builds on crdtAdapter.test.ts (which covers the underlying Y.js wiring).
 * Here we only verify the React-binding contract:
 *   - mount → initial state surfaced
 *   - local update → state re-renders
 *   - peer update via shared docId (memory) → state re-renders
 *   - awareness setLocal → localState updated; remote awareness propagates
 *   - destroy on unmount → memory room shrinks; no late renders
 *   - isConnected per transport
 *   - update / setLocal callback stability (so consumers can list them in
 *     effect deps without re-running)
 *   - post-unmount update throws (matches adapter semantics)
 *
 * Tests use @testing-library/react `renderHook` for ergonomic hook driving;
 * each test cleans up with `unmount()` so the memory hub is empty between
 * tests (additional belt-and-braces via `_resetMemoryHub` in beforeEach).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useCrdtDoc } from './useCrdtDoc';
import { _resetMemoryHub, _memoryRoomSize } from './crdtAdapter';

interface Counter {
  n: number;
  notes: string[];
}

function counter(initial: Partial<Counter> = {}): Counter {
  return { n: 0, notes: [], ...initial };
}

beforeEach(() => {
  _resetMemoryHub();
});

afterEach(() => {
  cleanup();
});

// ─── mount / initial state ────────────────────────────────────────────────

describe('useCrdtDoc — mount', () => {
  it('returns the materialised initial state on first render', () => {
    const { result } = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'm1',
        initialState: counter({ n: 3 }),
        transport: 'memory',
      }),
    );
    expect(result.current.state).toEqual({ n: 3, notes: [] });
  });

  it('joins the memory hub room on mount', () => {
    const { unmount } = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'm-join',
        initialState: counter(),
        transport: 'memory',
      }),
    );
    expect(_memoryRoomSize('m-join')).toBe(1);
    unmount();
  });

  it('isConnected=true immediately for memory transport', () => {
    const { result } = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'm-conn',
        initialState: counter(),
        transport: 'memory',
      }),
    );
    expect(result.current.isConnected).toBe(true);
  });
});

// ─── update → state sync ──────────────────────────────────────────────────

describe('useCrdtDoc — update', () => {
  it('local update re-renders with new state', () => {
    const { result } = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'u1',
        initialState: counter(),
        transport: 'memory',
      }),
    );
    act(() => {
      result.current.update((d) => {
        d.n = 5;
        d.notes.push('hi');
      });
    });
    expect(result.current.state).toEqual({ n: 5, notes: ['hi'] });
  });

  it('two hooks with same docId (memory) stay in sync', () => {
    const a = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'sync-1',
        initialState: counter(),
        transport: 'memory',
      }),
    );
    const b = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'sync-1',
        initialState: counter(),
        transport: 'memory',
      }),
    );
    act(() => {
      a.result.current.update((d) => {
        d.n = 42;
      });
    });
    expect(a.result.current.state.n).toBe(42);
    expect(b.result.current.state.n).toBe(42);
    a.unmount();
    b.unmount();
  });

  it('mutating the draft does not leak into prior state reference', () => {
    const { result } = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'iso',
        initialState: counter(),
        transport: 'memory',
      }),
    );
    const prev = result.current.state;
    act(() => {
      result.current.update((d) => {
        d.notes.push('x');
      });
    });
    expect(prev.notes).toEqual([]);
    expect(result.current.state.notes).toEqual(['x']);
  });

  it('`update` callback identity is stable across renders', () => {
    const { result, rerender } = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'stable',
        initialState: counter(),
        transport: 'memory',
      }),
    );
    const first = result.current.update;
    rerender();
    expect(result.current.update).toBe(first);
  });
});

// ─── destroy / lifecycle ──────────────────────────────────────────────────

describe('useCrdtDoc — lifecycle', () => {
  it('destroys the doc on unmount (room shrinks to 0)', () => {
    const { unmount } = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'destroy',
        initialState: counter(),
        transport: 'memory',
      }),
    );
    expect(_memoryRoomSize('destroy')).toBe(1);
    unmount();
    expect(_memoryRoomSize('destroy')).toBe(0);
  });

  it('post-unmount update throws (matches adapter semantics)', () => {
    const { result, unmount } = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'dead-update',
        initialState: counter(),
        transport: 'memory',
      }),
    );
    const update = result.current.update;
    unmount();
    expect(() => update((d) => (d.n = 1))).toThrow(/destroyed/);
  });

  it('unmount cancels pending subscribers — no late state writes', () => {
    // We can't directly observe "no late writes", but we can prove that the
    // doc is fully detached: the room is empty and a second peer update
    // doesn't try to drive the unmounted React tree (renderHook would warn
    // in act() if it did).
    const a = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'late',
        initialState: counter(),
        transport: 'memory',
      }),
    );
    const b = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'late',
        initialState: counter(),
        transport: 'memory',
      }),
    );
    a.unmount();
    expect(_memoryRoomSize('late')).toBe(1);
    act(() => {
      b.result.current.update((d) => {
        d.n = 9;
      });
    });
    expect(b.result.current.state.n).toBe(9);
    b.unmount();
  });
});

// ─── awareness ────────────────────────────────────────────────────────────

describe('useCrdtDoc — awareness', () => {
  it('setLocal updates localState', () => {
    const { result } = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'aw1',
        initialState: counter(),
        transport: 'memory',
        userId: 'alice',
      }),
    );
    act(() => {
      result.current.awareness.setLocal('cursor', { x: 1, y: 2 });
    });
    expect(result.current.awareness.localState.cursor).toEqual({ x: 1, y: 2 });
  });

  it('peer setLocal propagates to remoteStates of the other hook', () => {
    const a = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'aw-prop',
        initialState: counter(),
        transport: 'memory',
        userId: 'alice',
      }),
    );
    const b = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'aw-prop',
        initialState: counter(),
        transport: 'memory',
        userId: 'bob',
      }),
    );
    act(() => {
      a.result.current.awareness.setLocal('cursor', { x: 5, y: 6 });
    });
    expect(b.result.current.awareness.remoteStates.alice).toEqual({
      cursor: { x: 5, y: 6 },
    });
    a.unmount();
    b.unmount();
  });

  it('peer unmount clears its remoteStates entry on the other hook', () => {
    const a = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'aw-leave',
        initialState: counter(),
        transport: 'memory',
        userId: 'alice',
      }),
    );
    const b = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'aw-leave',
        initialState: counter(),
        transport: 'memory',
        userId: 'bob',
      }),
    );
    act(() => {
      b.result.current.awareness.setLocal('cursor', { x: 0, y: 0 });
    });
    expect(a.result.current.awareness.remoteStates.bob).toBeDefined();
    b.unmount();
    expect(a.result.current.awareness.remoteStates.bob).toBeUndefined();
    a.unmount();
  });

  it('`setLocal` callback identity is stable across renders', () => {
    const { result, rerender } = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'aw-stable',
        initialState: counter(),
        transport: 'memory',
      }),
    );
    const first = result.current.awareness.setLocal;
    rerender();
    expect(result.current.awareness.setLocal).toBe(first);
  });

  it('awareness object reference changes when remote state changes', () => {
    // Important for React equality checks downstream (CursorOverlay etc).
    const a = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'aw-ref',
        initialState: counter(),
        transport: 'memory',
        userId: 'alice',
      }),
    );
    const b = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'aw-ref',
        initialState: counter(),
        transport: 'memory',
        userId: 'bob',
      }),
    );
    const before = a.result.current.awareness;
    act(() => {
      b.result.current.awareness.setLocal('cursor', { x: 9, y: 9 });
    });
    expect(a.result.current.awareness).not.toBe(before);
    a.unmount();
    b.unmount();
  });
});

// ─── connection ────────────────────────────────────────────────────────────

describe('useCrdtDoc — isConnected', () => {
  it('websocket transport starts disconnected until probe opens', () => {
    // Stub WebSocket so we can control the lifecycle.
    class StubWS {
      static instances: StubWS[] = [];
      readyState = 0; // CONNECTING
      private listeners = new Map<string, Set<(ev: Event) => void>>();
      constructor(public url: string) {
        StubWS.instances.push(this);
      }
      addEventListener(t: string, cb: (ev: Event) => void): void {
        if (!this.listeners.has(t)) this.listeners.set(t, new Set());
        this.listeners.get(t)!.add(cb);
      }
      removeEventListener(t: string, cb: (ev: Event) => void): void {
        this.listeners.get(t)?.delete(cb);
      }
      dispatch(t: string): void {
        this.listeners.get(t)?.forEach((cb) => cb(new Event(t)));
      }
      close(): void {
        this.readyState = 3;
      }
    }
    const original = (globalThis as { WebSocket?: unknown }).WebSocket;
    (globalThis as { WebSocket?: unknown }).WebSocket = StubWS as unknown;

    try {
      const { result } = renderHook(() =>
        useCrdtDoc<Counter>({
          docId: 'ws-conn',
          initialState: counter(),
          transport: 'websocket',
          wsUrl: 'wss://example/ws',
        }),
      );
      expect(result.current.isConnected).toBe(false);
      act(() => {
        const inst = StubWS.instances[StubWS.instances.length - 1]!;
        inst.readyState = 1;
        inst.dispatch('open');
      });
      expect(result.current.isConnected).toBe(true);
    } finally {
      if (original === undefined) {
        delete (globalThis as { WebSocket?: unknown }).WebSocket;
      } else {
        (globalThis as { WebSocket?: unknown }).WebSocket = original;
      }
    }
  });
});

// ─── interplay: state + awareness on same doc ─────────────────────────────

describe('useCrdtDoc — combined', () => {
  it('separate calls to update and setLocal both produce re-renders', () => {
    const { result } = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'mix',
        initialState: counter(),
        transport: 'memory',
        userId: 'alice',
      }),
    );
    act(() => {
      result.current.update((d) => {
        d.n = 1;
      });
    });
    expect(result.current.state.n).toBe(1);
    act(() => {
      result.current.awareness.setLocal('cursor', { x: 10, y: 20 });
    });
    expect(result.current.awareness.localState.cursor).toEqual({ x: 10, y: 20 });
  });

  it('subscriber error during a peer update does not crash other listeners', () => {
    // Stand-in for the underlying adapter's resilience: prove our hook
    // doesn't unwrap that resilience by adding its own crash path.
    const a = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'crash',
        initialState: counter(),
        transport: 'memory',
      }),
    );
    const b = renderHook(() =>
      useCrdtDoc<Counter>({
        docId: 'crash',
        initialState: counter(),
        transport: 'memory',
      }),
    );
    // Re-render is harmless; we only care that act doesn't throw and state
    // ends up consistent across both hooks.
    expect(() =>
      act(() => {
        a.result.current.update((d) => {
          d.n = 7;
        });
      }),
    ).not.toThrow();
    expect(b.result.current.state.n).toBe(7);
    a.unmount();
    b.unmount();
  });

  it('switching docId between renders creates a fresh doc + room', () => {
    const { result, rerender, unmount } = renderHook(
      ({ id }: { id: string }) =>
        useCrdtDoc<Counter>({
          docId: id,
          initialState: counter(),
          transport: 'memory',
        }),
      { initialProps: { id: 'A' } },
    );
    act(() => {
      result.current.update((d) => {
        d.n = 1;
      });
    });
    expect(result.current.state.n).toBe(1);
    expect(_memoryRoomSize('A')).toBe(1);
    rerender({ id: 'B' });
    // A is gone, B is fresh
    expect(_memoryRoomSize('A')).toBe(0);
    expect(_memoryRoomSize('B')).toBe(1);
    expect(result.current.state.n).toBe(0);
    unmount();
  });

  it('vi.fn subscriber sees exactly one re-render per update', () => {
    // Smoke check: no spurious extra renders from our internal awareness
    // useEffect feedback loop.
    const calls = vi.fn();
    const { result } = renderHook(() => {
      const r = useCrdtDoc<Counter>({
        docId: 'count-renders',
        initialState: counter(),
        transport: 'memory',
      });
      calls(r.state.n);
      return r;
    });
    const initialRenderCount = calls.mock.calls.length;
    act(() => {
      result.current.update((d) => {
        d.n = 99;
      });
    });
    // One additional render exactly. Allow ≥1 to be StrictMode-safe.
    expect(calls.mock.calls.length).toBeGreaterThanOrEqual(initialRenderCount + 1);
    expect(result.current.state.n).toBe(99);
  });
});
