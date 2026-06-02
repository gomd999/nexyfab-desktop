/** @vitest-environment jsdom */
/**
 * aiChatHistory — pure (non-hook) coverage.
 *
 * Validates:
 *   - load returns [] for empty/missing/corrupted localStorage
 *   - addEntry prepends + respects maxEntries (oldest evicted)
 *   - addEntry default cap = 50
 *   - markApplied stamps appliedAt, preserves other entries by reference
 *   - markApplied is no-op when id missing (returns same array ref)
 *   - saveChatHistory + loadChatHistory round-trip
 *   - clearHistory wipes
 *   - exportJson is parseable, includes version + entries + exportedAt
 *   - version mismatch on read → []
 *   - corrupted entry shape → []
 *   - quota error surfaces structured result
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadChatHistory,
  saveChatHistory,
  clearHistory,
  addEntry,
  markApplied,
  exportJson,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_STORAGE_KEY,
  CHAT_HISTORY_SCHEMA_VERSION,
  type ChatHistoryEntry,
} from './aiChatHistory';

const KEY = 'nexyfab:test:ai-chat-history';

function makeEntry(overrides: Partial<ChatHistoryEntry> = {}): ChatHistoryEntry {
  return {
    id: overrides.id ?? `id_${Math.random().toString(36).slice(2)}`,
    timestamp: overrides.timestamp ?? Date.now(),
    prompt: overrides.prompt ?? 'box 10x10x10',
    source: overrides.source ?? 'regex',
    intentKind: overrides.intentKind,
    stepCount: overrides.stepCount,
    warnings: overrides.warnings,
    appliedAt: overrides.appliedAt,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

// ─── load ─────────────────────────────────────────────────────────────────

describe('loadChatHistory', () => {
  it('empty localStorage → []', () => {
    expect(loadChatHistory(KEY)).toEqual([]);
  });

  it('uses default storage key when omitted', () => {
    // No payload under default key
    expect(loadChatHistory()).toEqual([]);
    // Seed under default key, expect to load it
    const entries = [makeEntry({ id: 'a', prompt: 'cylinder 5 10' })];
    saveChatHistory(entries);
    expect(loadChatHistory()).toHaveLength(1);
    expect(loadChatHistory()[0]!.id).toBe('a');
    // Cleanup so other tests aren't polluted
    clearHistory();
  });

  it('invalid JSON → []', () => {
    window.localStorage.setItem(KEY, '{not valid json');
    expect(loadChatHistory(KEY)).toEqual([]);
  });

  it('valid JSON but wrong envelope shape → []', () => {
    window.localStorage.setItem(KEY, JSON.stringify(['just', 'an', 'array']));
    expect(loadChatHistory(KEY)).toEqual([]);
  });

  it('version mismatch → []', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ version: 999, entries: [makeEntry({ id: 'x' })] }),
    );
    expect(loadChatHistory(KEY)).toEqual([]);
  });

  it('missing entries array → []', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ version: CHAT_HISTORY_SCHEMA_VERSION, entries: 'not an array' }),
    );
    expect(loadChatHistory(KEY)).toEqual([]);
  });

  it('corrupted single entry → entire load returns []', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: CHAT_HISTORY_SCHEMA_VERSION,
        entries: [makeEntry({ id: 'good' }), { id: 'bad' /* missing timestamp/prompt/source */ }],
      }),
    );
    expect(loadChatHistory(KEY)).toEqual([]);
  });
});

// ─── save + round-trip ────────────────────────────────────────────────────

describe('saveChatHistory + loadChatHistory round-trip', () => {
  it('save then load returns identical entries', () => {
    const entries = [
      makeEntry({ id: 'a', prompt: 'box 10x10x10', source: 'regex', intentKind: 'create_box_with_fillet', stepCount: 2 }),
      makeEntry({ id: 'b', prompt: 'cylinder r5 h10', source: 'llm', intentKind: 'create_cylinder', stepCount: 1, warnings: ['warn1'] }),
    ];
    const res = saveChatHistory(entries, KEY);
    expect(res.ok).toBe(true);
    const loaded = loadChatHistory(KEY);
    expect(loaded).toEqual(entries);
  });

  it('save with appliedAt round-trips the field', () => {
    const entries = [makeEntry({ id: 'a', appliedAt: 12345 })];
    saveChatHistory(entries, KEY);
    const loaded = loadChatHistory(KEY);
    expect(loaded[0]!.appliedAt).toBe(12345);
  });

  it('save empty array, load returns []', () => {
    saveChatHistory([], KEY);
    expect(loadChatHistory(KEY)).toEqual([]);
  });

  it('save returns ok:true with no storage failure', () => {
    const res = saveChatHistory([makeEntry()], KEY);
    expect(res).toEqual({ ok: true });
  });
});

// ─── addEntry ─────────────────────────────────────────────────────────────

describe('addEntry', () => {
  it('empty + 1 = 1 entry at index 0', () => {
    const next = addEntry([], makeEntry({ id: 'a' }));
    expect(next).toHaveLength(1);
    expect(next[0]!.id).toBe('a');
  });

  it('prepends newest at index 0', () => {
    const a = makeEntry({ id: 'a' });
    const b = makeEntry({ id: 'b' });
    const c = makeEntry({ id: 'c' });
    let h: ChatHistoryEntry[] = [];
    h = addEntry(h, a);
    h = addEntry(h, b);
    h = addEntry(h, c);
    expect(h.map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('does not mutate input array', () => {
    const input = [makeEntry({ id: 'a' })];
    const result = addEntry(input, makeEntry({ id: 'b' }));
    expect(input).toHaveLength(1);
    expect(input[0]!.id).toBe('a');
    expect(result).not.toBe(input);
  });

  it('respects maxEntries cap: 5 + 6th → oldest evicted', () => {
    let h: ChatHistoryEntry[] = [];
    for (let i = 0; i < 5; i++) {
      h = addEntry(h, makeEntry({ id: `e${i}` }), 5);
    }
    expect(h).toHaveLength(5);
    h = addEntry(h, makeEntry({ id: 'e5' }), 5);
    expect(h).toHaveLength(5);
    expect(h[0]!.id).toBe('e5');
    expect(h.map((e) => e.id)).toEqual(['e5', 'e4', 'e3', 'e2', 'e1']);
  });

  it('default maxEntries = 50', () => {
    let h: ChatHistoryEntry[] = [];
    for (let i = 0; i < 60; i++) {
      h = addEntry(h, makeEntry({ id: `e${i}` }));
    }
    expect(h).toHaveLength(DEFAULT_MAX_ENTRIES);
    expect(h[0]!.id).toBe('e59');
    expect(h[49]!.id).toBe('e10');
  });

  it('invalid maxEntries (0/NaN/negative) → falls back to default 50', () => {
    let h: ChatHistoryEntry[] = [];
    for (let i = 0; i < 55; i++) {
      h = addEntry(h, makeEntry({ id: `e${i}` }), 0);
    }
    expect(h).toHaveLength(DEFAULT_MAX_ENTRIES);
    let h2: ChatHistoryEntry[] = [];
    for (let i = 0; i < 55; i++) {
      h2 = addEntry(h2, makeEntry({ id: `e${i}` }), -10);
    }
    expect(h2).toHaveLength(DEFAULT_MAX_ENTRIES);
  });

  it('maxEntries = 1 keeps only the newest', () => {
    const h = addEntry(addEntry([], makeEntry({ id: 'a' }), 1), makeEntry({ id: 'b' }), 1);
    expect(h).toHaveLength(1);
    expect(h[0]!.id).toBe('b');
  });
});

// ─── markApplied ──────────────────────────────────────────────────────────

describe('markApplied', () => {
  it('sets appliedAt on matching id', () => {
    const before = Date.now();
    const h = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })];
    const out = markApplied(h, 'a');
    const target = out.find((e) => e.id === 'a')!;
    expect(target.appliedAt).toBeGreaterThanOrEqual(before);
  });

  it('preserves non-matching entries by reference', () => {
    const h = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' }), makeEntry({ id: 'c' })];
    const out = markApplied(h, 'b');
    expect(out[0]).toBe(h[0]);
    expect(out[2]).toBe(h[2]);
    expect(out[1]).not.toBe(h[1]);
  });

  it('returns input array unchanged when id absent (referential identity)', () => {
    const h = [makeEntry({ id: 'a' })];
    const out = markApplied(h, 'does-not-exist');
    expect(out).toBe(h);
  });

  it('does not mutate input entries', () => {
    const original = makeEntry({ id: 'a' });
    const h = [original];
    markApplied(h, 'a');
    expect(original.appliedAt).toBeUndefined();
  });

  it('marking already-applied entry updates appliedAt', () => {
    const h = [makeEntry({ id: 'a', appliedAt: 1 })];
    const out = markApplied(h, 'a');
    expect(out[0]!.appliedAt).toBeGreaterThan(1);
  });
});

// ─── clearHistory ─────────────────────────────────────────────────────────

describe('clearHistory', () => {
  it('removes the on-disk entry', () => {
    saveChatHistory([makeEntry({ id: 'a' })], KEY);
    expect(loadChatHistory(KEY)).toHaveLength(1);
    clearHistory(KEY);
    expect(loadChatHistory(KEY)).toEqual([]);
  });

  it('clearing an already-empty key is a no-op', () => {
    expect(() => clearHistory(KEY)).not.toThrow();
    expect(loadChatHistory(KEY)).toEqual([]);
  });
});

// ─── exportJson ───────────────────────────────────────────────────────────

describe('exportJson', () => {
  it('produces valid JSON with envelope shape', () => {
    const h = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })];
    const out = exportJson(h);
    const parsed = JSON.parse(out);
    expect(parsed.version).toBe(CHAT_HISTORY_SCHEMA_VERSION);
    expect(typeof parsed.exportedAt).toBe('number');
    expect(Array.isArray(parsed.entries)).toBe(true);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0].id).toBe('a');
  });

  it('empty history → still produces a valid envelope', () => {
    const out = exportJson([]);
    const parsed = JSON.parse(out);
    expect(parsed.version).toBe(CHAT_HISTORY_SCHEMA_VERSION);
    expect(parsed.entries).toEqual([]);
  });

  it('output is pretty-printed (contains newlines and 2-space indent)', () => {
    const out = exportJson([makeEntry({ id: 'a' })]);
    expect(out).toContain('\n');
    // Look for 2-space indent on a nested field
    expect(out).toMatch(/^ {2}"version":/m);
  });

  it('preserves warnings and appliedAt in export', () => {
    const out = exportJson([
      makeEntry({ id: 'a', warnings: ['w1', 'w2'], appliedAt: 5555 }),
    ]);
    const parsed = JSON.parse(out);
    expect(parsed.entries[0].warnings).toEqual(['w1', 'w2']);
    expect(parsed.entries[0].appliedAt).toBe(5555);
  });
});

// ─── quota / storage failure ──────────────────────────────────────────────

describe('saveChatHistory — failure modes', () => {
  it('QuotaExceededError → ok:false with structured error', () => {
    const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    });
    try {
      const res = saveChatHistory([makeEntry()], KEY);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe('quota_exceeded');
        expect(res.message).toContain('quota');
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('arbitrary error → ok:false with error=unknown', () => {
    const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('disk full');
    });
    try {
      const res = saveChatHistory([makeEntry()], KEY);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe('unknown');
        expect(res.message).toContain('disk full');
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('legacy QuotaExceededError (code=22) recognized', () => {
    const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      const err = new Error('legacy quota') as Error & { code?: number };
      err.code = 22;
      throw err;
    });
    try {
      const res = saveChatHistory([makeEntry()], KEY);
      if (!res.ok) {
        expect(res.error).toBe('quota_exceeded');
      } else {
        throw new Error('expected save to fail');
      }
    } finally {
      spy.mockRestore();
    }
  });
});

// ─── default key constant ─────────────────────────────────────────────────

describe('default key constant', () => {
  it('DEFAULT_STORAGE_KEY is the expected namespace', () => {
    expect(DEFAULT_STORAGE_KEY).toBe('nexyfab:ai-chat-history');
  });

  it('DEFAULT_MAX_ENTRIES is 50', () => {
    expect(DEFAULT_MAX_ENTRIES).toBe(50);
  });
});
