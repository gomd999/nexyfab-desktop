/** @vitest-environment jsdom */
/**
 * useChatHistory — React hook coverage.
 *
 * Combines the pure history operations with localStorage persistence.
 * Tests use fake timers because the persistence layer debounces writes
 * by 500 ms (CHAT_HISTORY_AUTOSAVE_DEBOUNCE_MS).
 *
 * Coverage:
 *   - mount with empty/missing key → empty history
 *   - mount with pre-existing saved history → loads
 *   - add() returns an id and prepends
 *   - debounced write (500 ms)
 *   - markApplied stamps appliedAt and persists
 *   - clear() wipes memory + on-disk
 *   - exportJson reflects current state (even before debounce flush)
 *   - quota error surfaces via onError
 *   - unmount → no late write
 *   - maxEntries cap respected via the hook
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useChatHistory,
  saveChatHistory,
  DEFAULT_STORAGE_KEY,
  CHAT_HISTORY_AUTOSAVE_DEBOUNCE_MS,
  CHAT_HISTORY_SCHEMA_VERSION,
  type ChatHistoryEntry,
} from '@/lib/ai/aiChatHistory';

const KEY = 'nexyfab:test:ai-chat-history-hook';

function readRaw(key: string): { version: number; entries: ChatHistoryEntry[] } | null {
  const raw = window.localStorage.getItem(key);
  if (raw === null) return null;
  return JSON.parse(raw);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

// ─── mount ────────────────────────────────────────────────────────────────

describe('useChatHistory — mount', () => {
  it('empty localStorage → empty history', () => {
    const { result } = renderHook(() => useChatHistory({ storageKey: KEY }));
    expect(result.current.history).toEqual([]);
  });

  it('pre-existing saved entries → loaded on mount', () => {
    const entries: ChatHistoryEntry[] = [
      {
        id: 'preload',
        timestamp: 1000,
        prompt: 'preloaded',
        source: 'regex',
        intentKind: 'create_box_with_fillet',
        stepCount: 2,
      },
    ];
    saveChatHistory(entries, KEY);
    const { result } = renderHook(() => useChatHistory({ storageKey: KEY }));
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0]!.id).toBe('preload');
  });

  it('uses default storage key when storageKey omitted', () => {
    saveChatHistory(
      [
        {
          id: 'default-key-entry',
          timestamp: 1,
          prompt: 'hi',
          source: 'regex',
        },
      ],
      DEFAULT_STORAGE_KEY,
    );
    const { result } = renderHook(() => useChatHistory());
    expect(result.current.history[0]!.id).toBe('default-key-entry');
  });
});

// ─── add ──────────────────────────────────────────────────────────────────

describe('useChatHistory — add', () => {
  it('add → +1, returns id, prepends at index 0', () => {
    const { result } = renderHook(() => useChatHistory({ storageKey: KEY }));
    let id1 = '';
    act(() => {
      id1 = result.current.add({ prompt: 'box 10x10x10', source: 'regex' });
    });
    expect(id1).toBeTruthy();
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0]!.id).toBe(id1);

    let id2 = '';
    act(() => {
      id2 = result.current.add({ prompt: 'cylinder', source: 'llm' });
    });
    expect(id2).not.toBe(id1);
    expect(result.current.history[0]!.id).toBe(id2);
    expect(result.current.history[1]!.id).toBe(id1);
  });

  it('respects maxEntries cap', () => {
    const { result } = renderHook(() => useChatHistory({ storageKey: KEY, maxEntries: 3 }));
    act(() => {
      result.current.add({ prompt: 'p1', source: 'regex' });
      result.current.add({ prompt: 'p2', source: 'regex' });
      result.current.add({ prompt: 'p3', source: 'regex' });
      result.current.add({ prompt: 'p4', source: 'regex' });
    });
    expect(result.current.history).toHaveLength(3);
    expect(result.current.history[0]!.prompt).toBe('p4');
  });
});

// ─── debounce ─────────────────────────────────────────────────────────────

describe('useChatHistory — debounced auto-save', () => {
  it('add → no write before debounce window elapses', () => {
    const { result } = renderHook(() => useChatHistory({ storageKey: KEY }));
    act(() => {
      result.current.add({ prompt: 'p1', source: 'regex' });
    });
    act(() => {
      vi.advanceTimersByTime(CHAT_HISTORY_AUTOSAVE_DEBOUNCE_MS - 1);
    });
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('add → write occurs after 500 ms', () => {
    const { result } = renderHook(() => useChatHistory({ storageKey: KEY }));
    act(() => {
      result.current.add({ prompt: 'p1', source: 'regex' });
    });
    act(() => {
      vi.advanceTimersByTime(CHAT_HISTORY_AUTOSAVE_DEBOUNCE_MS);
    });
    const parsed = readRaw(KEY);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(CHAT_HISTORY_SCHEMA_VERSION);
    expect(parsed!.entries[0]!.prompt).toBe('p1');
  });

  it('successive add()s collapse to one write', () => {
    const { result } = renderHook(() => useChatHistory({ storageKey: KEY }));
    act(() => {
      result.current.add({ prompt: 'p1', source: 'regex' });
    });
    act(() => {
      vi.advanceTimersByTime(100);
      result.current.add({ prompt: 'p2', source: 'regex' });
    });
    act(() => {
      vi.advanceTimersByTime(100);
      result.current.add({ prompt: 'p3', source: 'regex' });
    });
    act(() => {
      vi.advanceTimersByTime(CHAT_HISTORY_AUTOSAVE_DEBOUNCE_MS);
    });
    const parsed = readRaw(KEY);
    expect(parsed!.entries).toHaveLength(3);
    expect(parsed!.entries[0]!.prompt).toBe('p3');
  });
});

// ─── markApplied ──────────────────────────────────────────────────────────

describe('useChatHistory — markApplied', () => {
  it('markApplied stamps appliedAt on the entry', () => {
    const { result } = renderHook(() => useChatHistory({ storageKey: KEY }));
    let id = '';
    act(() => {
      id = result.current.add({ prompt: 'p1', source: 'regex' });
    });
    expect(result.current.history[0]!.appliedAt).toBeUndefined();
    act(() => {
      result.current.markApplied(id);
    });
    const entry = result.current.history.find((e) => e.id === id)!;
    expect(typeof entry.appliedAt).toBe('number');
  });

  it('markApplied with unknown id is a no-op', () => {
    const { result } = renderHook(() => useChatHistory({ storageKey: KEY }));
    act(() => {
      result.current.add({ prompt: 'p1', source: 'regex' });
    });
    const before = result.current.history;
    act(() => {
      result.current.markApplied('does-not-exist');
    });
    expect(result.current.history).toBe(before);
  });

  it('markApplied persists via debounced save', () => {
    const { result } = renderHook(() => useChatHistory({ storageKey: KEY }));
    let id = '';
    act(() => {
      id = result.current.add({ prompt: 'p1', source: 'regex' });
    });
    act(() => {
      vi.advanceTimersByTime(CHAT_HISTORY_AUTOSAVE_DEBOUNCE_MS);
    });
    act(() => {
      result.current.markApplied(id);
    });
    act(() => {
      vi.advanceTimersByTime(CHAT_HISTORY_AUTOSAVE_DEBOUNCE_MS);
    });
    const parsed = readRaw(KEY);
    expect(typeof parsed!.entries[0]!.appliedAt).toBe('number');
  });
});

// ─── clear ────────────────────────────────────────────────────────────────

describe('useChatHistory — clear', () => {
  it('clear wipes memory + localStorage', () => {
    const { result } = renderHook(() => useChatHistory({ storageKey: KEY }));
    act(() => {
      result.current.add({ prompt: 'p1', source: 'regex' });
    });
    act(() => {
      vi.advanceTimersByTime(CHAT_HISTORY_AUTOSAVE_DEBOUNCE_MS);
    });
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
    act(() => {
      result.current.clear();
    });
    expect(result.current.history).toEqual([]);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('clear discards any pending debounced write', () => {
    const { result } = renderHook(() => useChatHistory({ storageKey: KEY }));
    act(() => {
      result.current.add({ prompt: 'p1', source: 'regex' });
    });
    // do NOT advance — clear before flush
    act(() => {
      result.current.clear();
    });
    act(() => {
      vi.advanceTimersByTime(CHAT_HISTORY_AUTOSAVE_DEBOUNCE_MS * 2);
    });
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

// ─── exportJson ───────────────────────────────────────────────────────────

describe('useChatHistory — exportJson', () => {
  it('reflects current in-memory state (pre-flush)', () => {
    const { result } = renderHook(() => useChatHistory({ storageKey: KEY }));
    act(() => {
      result.current.add({ prompt: 'pending-flush', source: 'regex' });
    });
    // debounce timer has NOT fired yet
    const json = result.current.exportJson();
    const parsed = JSON.parse(json);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].prompt).toBe('pending-flush');
  });
});

// ─── onError (quota) ──────────────────────────────────────────────────────

describe('useChatHistory — onError', () => {
  it('quota_exceeded surfaces via onError on debounced save', () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useChatHistory({ storageKey: KEY, onError }),
    );
    const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    });
    try {
      act(() => {
        result.current.add({ prompt: 'big', source: 'regex' });
      });
      act(() => {
        vi.advanceTimersByTime(CHAT_HISTORY_AUTOSAVE_DEBOUNCE_MS);
      });
      expect(onError).toHaveBeenCalledWith('quota_exceeded', expect.any(String));
    } finally {
      spy.mockRestore();
    }
  });
});

// ─── unmount cleanup ──────────────────────────────────────────────────────

describe('useChatHistory — unmount cleanup', () => {
  it('unmount before debounce → no write (timer cleared)', () => {
    const { result, unmount } = renderHook(() =>
      useChatHistory({ storageKey: KEY }),
    );
    act(() => {
      result.current.add({ prompt: 'never-saved', source: 'regex' });
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(CHAT_HISTORY_AUTOSAVE_DEBOUNCE_MS * 2);
    });
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('unmount → vi.getTimerCount() reports zero pending timers', () => {
    const { result, unmount } = renderHook(() =>
      useChatHistory({ storageKey: KEY }),
    );
    act(() => {
      result.current.add({ prompt: 'x', source: 'regex' });
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
