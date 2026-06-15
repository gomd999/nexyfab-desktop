/**
 * aiChatHistory — Phase 3.AI.UI persistent chat-history layer for the
 * FeatureTreePlannerPanel (and any other AI-assistant surface that needs
 * a rolling, browser-local prompt log).
 *
 * The panel today (Agent-VVV) keeps the most recent 5 prompts in React
 * state and drops them on remount. This module replaces that in-memory
 * cap with a localStorage-backed log of up to 50 entries, surviving
 * reload, tab close, and key swaps. Integration is deferred to the next
 * batch so the panel keeps shipping while this module bakes in tests.
 *
 * Sister to `featureTreePersist` (Agent-ZZ) — same versioned envelope
 * pattern, same 500 ms debounce, same onError surface for quota errors,
 * same "fall back to empty on any read error" mount semantics.
 *
 * Why 50, not 5 or 500?
 *   - 5 was a transient in-memory cap; with persistence we can afford a
 *     real history. 50 entries * ~400 chars/entry ≈ 20 KB worst-case,
 *     well under the 5-10 MB per-origin localStorage quota.
 *   - 50 ≈ a normal week of CAD-NL prompts for a heavy user (10-15/day).
 *     Older than that is rarely useful — the UX is "what did I try
 *     yesterday" not "what did I try last month".
 *   - Bound the array length so JSON.stringify stays O(small) on every
 *     debounced write (no quadratic ballooning of the auto-save cost).
 *   - Caller can override `maxEntries` if a different surface wants 100
 *     (e.g., a power-user export workflow). Default stays at 50.
 *
 * Why pure JSON envelope (not IndexedDB)?
 *   - Same arguments as featureTreePersist: single-file diffable, easy to
 *     dump/restore, no async ceremony, fits well within quota.
 *   - `exportJson` returns the *full* envelope (version + entries) so the
 *     user can save it to disk and reimport later (Phase 3.AI.UI.export
 *     wires a "Download history" button — out of scope here).
 *
 * exportJson policy:
 *   - Envelope: { version: 1, exportedAt: <ms>, entries: [...] }.
 *   - Pretty-printed with 2-space indent for human review.
 *   - Includes ALL entries (not just the in-state slice) so the user
 *     gets a faithful backup. The hook reads from current state, so a
 *     freshly-added entry that hasn't yet been written to localStorage
 *     is still included.
 *   - Never strips warnings / appliedAt — those are the highest-value
 *     fields when revisiting "did I actually run this?"
 *
 * Quota handling:
 *   - On QuotaExceededError, surface `quota_exceeded` via `onError` so a
 *     toast can prompt "history full, please export and clear".
 *   - We do NOT auto-evict on quota — that would silently lose user
 *     data. The cap (`maxEntries`) is the only eviction policy.
 *
 * Out of scope (intentionally):
 *   - Cross-tab sync via `storage` events. Last-writer-wins is the
 *     contract; the panel mounts in a single tab in practice.
 *   - Schema migration. Only version 1 exists. New optional fields stay
 *     on v1 because `loadChatHistory` tolerates unknown fields.
 *   - Search / filter. The hook returns the raw array; callers can
 *     filter / paginate as needed.
 *   - Server-side persistence. This is browser-local only.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IntentKind } from './featureTreeIntentDetector';

// ─── Public types ─────────────────────────────────────────────────────────

/**
 * A single chat-history entry. Stored verbatim in localStorage and
 * surfaced by `useChatHistory` to the consumer.
 */
export interface ChatHistoryEntry {
  /** Unique id (crypto.randomUUID where available; fallback otherwise). */
  id: string;
  /** Date.now() at the moment the entry was created. */
  timestamp: number;
  /** The user's NL prompt. */
  prompt: string;
  /**
   * Where the resulting intent came from:
   *   - 'regex' — featureTreeIntentDetector matched without LLM
   *   - 'llm'   — LLM fallback was invoked
   *   - 'fallback' — neither matched (recorded as "not_understood")
   */
  source: 'regex' | 'llm' | 'fallback';
  /** Detected intent kind (omitted when source === 'fallback'). */
  intentKind?: IntentKind;
  /** Number of PlanSteps produced. Omitted when no plan was generated. */
  stepCount?: number;
  /** Warnings surfaced by the planner. Empty array elided to omit. */
  warnings?: string[];
  /** Set to Date.now() if the user clicked Apply on the resulting plan. */
  appliedAt?: number;
}

export interface ChatHistoryConfig {
  /** Max entries to keep. Default 50. Negative / zero / non-integer → coerced to default. */
  maxEntries?: number;
  /** localStorage key. Default 'nexyfab:ai-chat-history'. */
  storageKey?: string;
  /** Invoked when a write fails (currently only 'quota_exceeded' is surfaced). */
  onError?: (error: ChatHistorySaveError, message: string) => void;
}

export type ChatHistorySaveError = 'no_storage' | 'quota_exceeded' | 'unknown';

// ─── Constants ────────────────────────────────────────────────────────────

export const DEFAULT_MAX_ENTRIES = 50;
export const DEFAULT_STORAGE_KEY = 'nexyfab:ai-chat-history';
export const CHAT_HISTORY_SCHEMA_VERSION = 1;
export const CHAT_HISTORY_AUTOSAVE_DEBOUNCE_MS = 500;

interface ChatHistoryEnvelope {
  version: number;
  entries: ChatHistoryEntry[];
}

// ─── id generation ────────────────────────────────────────────────────────

/**
 * Cheap unique id. Uses crypto.randomUUID when available; otherwise
 * falls back to a timestamp + Math.random concatenation. The fallback is
 * not collision-proof under load but is fine for a per-user UI log that
 * adds at most one id every few seconds.
 */
function generateId(): string {
  if (
    typeof globalThis !== 'undefined' &&
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }
  // Fallback — fine for low-rate UI events. NOT cryptographically random.
  return `cid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ─── coerce / sanitize ───────────────────────────────────────────────────

function sanitizeMaxEntries(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_ENTRIES;
  if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 1) {
    return DEFAULT_MAX_ENTRIES;
  }
  return raw;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Defensive shape check for a single entry. Returns true if the entry
 * has the required fields (id, timestamp, prompt, source). Unknown
 * optional fields are tolerated. We do NOT enforce IntentKind
 * membership here — the detector vocabulary may grow between
 * write and read, and we'd rather surface a stale kind string than
 * drop the entry.
 */
function isValidEntry(v: unknown): v is ChatHistoryEntry {
  if (!isPlainObject(v)) return false;
  if (typeof v.id !== 'string') return false;
  if (typeof v.timestamp !== 'number' || !Number.isFinite(v.timestamp)) return false;
  if (typeof v.prompt !== 'string') return false;
  if (v.source !== 'regex' && v.source !== 'llm' && v.source !== 'fallback') return false;
  if (v.intentKind !== undefined && typeof v.intentKind !== 'string') return false;
  if (v.stepCount !== undefined && typeof v.stepCount !== 'number') return false;
  if (v.warnings !== undefined) {
    if (!Array.isArray(v.warnings)) return false;
    for (const w of v.warnings) {
      if (typeof w !== 'string') return false;
    }
  }
  if (v.appliedAt !== undefined && typeof v.appliedAt !== 'number') return false;
  return true;
}

// ─── localStorage adapters ───────────────────────────────────────────────

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

/**
 * Load + parse the entries array for `key`. Returns [] on:
 *   - localStorage unavailable
 *   - key absent
 *   - invalid JSON
 *   - missing envelope shape
 *   - version mismatch
 *   - any individual entry fails shape validation → entire load aborts
 *     (we prefer "blank slate" over "half-corrupted log" for UX).
 *
 * `key` defaults to DEFAULT_STORAGE_KEY when omitted.
 */
export function loadChatHistory(key: string = DEFAULT_STORAGE_KEY): ChatHistoryEntry[] {
  if (!hasStorage()) return [];
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isPlainObject(parsed)) return [];
  if (typeof parsed.version !== 'number' || parsed.version !== CHAT_HISTORY_SCHEMA_VERSION) {
    return [];
  }
  if (!Array.isArray(parsed.entries)) return [];
  const entries: ChatHistoryEntry[] = [];
  for (const e of parsed.entries) {
    if (!isValidEntry(e)) return [];
    entries.push(e);
  }
  return entries;
}

/**
 * Synchronously write the envelope under `key`. Throws nothing — returns
 * a structured result so callers can surface quota / no-storage failures
 * without try/catch noise at every call site.
 */
export function saveChatHistory(
  entries: ChatHistoryEntry[],
  key: string = DEFAULT_STORAGE_KEY,
): { ok: true } | { ok: false; error: ChatHistorySaveError; message: string } {
  if (!hasStorage()) {
    return { ok: false, error: 'no_storage', message: 'localStorage not available' };
  }
  const envelope: ChatHistoryEnvelope = {
    version: CHAT_HISTORY_SCHEMA_VERSION,
    entries,
  };
  let json: string;
  try {
    json = JSON.stringify(envelope);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: 'unknown', message: `JSON.stringify failed: ${msg}` };
  }
  try {
    window.localStorage.setItem(key, json);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      (err instanceof Error && err.name === 'QuotaExceededError') ||
      (err && typeof err === 'object' && (err as { code?: number }).code === 22)
    ) {
      return {
        ok: false,
        error: 'quota_exceeded',
        message: `localStorage quota exceeded for key=${key} (~${json.length} chars): ${msg}`,
      };
    }
    return { ok: false, error: 'unknown', message: msg };
  }
}

/**
 * Wipe the on-disk history for `key`. Best-effort: silently no-ops if
 * localStorage is unavailable or the remove throws (matches the
 * "missing key == empty history" contract on load).
 */
export function clearHistory(key: string = DEFAULT_STORAGE_KEY): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ─── pure history operations ─────────────────────────────────────────────

/**
 * Append `entry` to the front of `history`, capped at `maxEntries`.
 * Returns a NEW array (does not mutate input). The newest entry is
 * always at index 0; the oldest is evicted when the cap is exceeded.
 *
 * Why prepend (not append)?
 *   - The UI shows newest-first; we want index 0 to be the most recent
 *     so consumers can `.slice(0, N)` for a "recent N" view without
 *     reversing.
 */
export function addEntry(
  history: ChatHistoryEntry[],
  entry: ChatHistoryEntry,
  maxEntries: number = DEFAULT_MAX_ENTRIES,
): ChatHistoryEntry[] {
  const cap = sanitizeMaxEntries(maxEntries);
  const next = [entry, ...history];
  if (next.length > cap) {
    next.length = cap;
  }
  return next;
}

/**
 * Stamp the entry identified by `id` with `appliedAt = Date.now()`.
 * Returns a new array; entries other than the target are referentially
 * preserved so React reconciliation can short-circuit. If no entry
 * matches `id`, returns the input array unchanged (referentially).
 */
export function markApplied(
  history: ChatHistoryEntry[],
  id: string,
): ChatHistoryEntry[] {
  let found = false;
  const next = history.map((e) => {
    if (e.id === id) {
      found = true;
      return { ...e, appliedAt: Date.now() };
    }
    return e;
  });
  return found ? next : history;
}

/**
 * Serialize the full envelope to a pretty-printed JSON string suitable
 * for download / clipboard / textarea-display. The output is identical
 * in shape to what `saveChatHistory` writes, but with 2-space indent for
 * human review.
 */
export function exportJson(history: ChatHistoryEntry[]): string {
  const envelope = {
    version: CHAT_HISTORY_SCHEMA_VERSION,
    exportedAt: Date.now(),
    entries: history,
  };
  return JSON.stringify(envelope, null, 2);
}

// ─── React hook ───────────────────────────────────────────────────────────

export interface UseChatHistoryReturn {
  history: ChatHistoryEntry[];
  /**
   * Append a new entry. Returns the generated id so the caller can pass
   * it to `markApplied` later (e.g., when the user clicks Apply).
   */
  add: (entry: Omit<ChatHistoryEntry, 'id' | 'timestamp'>) => string;
  /** Stamp the entry with `appliedAt = Date.now()`. No-op if id missing. */
  markApplied: (id: string) => void;
  /** Wipe history (memory + localStorage). */
  clear: () => void;
  /** Serialize current history to pretty JSON (for user backup). */
  exportJson: () => string;
}

/**
 * React hook: localStorage-backed chat history with debounced auto-save.
 *
 * Mount:
 *   - Synchronously read localStorage. Empty / invalid → start at [].
 *   - Subsequent setState calls trigger a debounced (500 ms) save.
 *
 * Why debounce?
 *   - Bursty add() patterns (e.g., user mashing Enter twice quickly,
 *     auto-test framework adding 20 entries in a row) collapse to one
 *     write instead of 20. Same justification as featureTreePersist.
 *
 * Unmount:
 *   - Pending timer is cleared. We do NOT flush on unmount — the panel
 *     is typically only unmounted by closing the page, at which point
 *     `pagehide` would be the right hook (deferred; not the hook's
 *     responsibility here).
 *
 * `storageKey` / `maxEntries` changes:
 *   - Treated as "different surface" — the hook re-mounts state from
 *     the new key. Pending writes targeted at the previous key are
 *     flushed synchronously to avoid orphan data. This mirrors
 *     useFeatureTreeStorage's key-swap semantics.
 *
 * `onError`:
 *   - Latest reference is captured via ref so a render-time replacement
 *     takes effect on the next save without re-subscribing.
 */
export function useChatHistory(opts: ChatHistoryConfig = {}): UseChatHistoryReturn {
  const storageKey = opts.storageKey ?? DEFAULT_STORAGE_KEY;
  const maxEntries = sanitizeMaxEntries(opts.maxEntries);

  const onErrorRef = useRef(opts.onError);
  useEffect(() => {
    onErrorRef.current = opts.onError;
  });

  // We pack the current key into state so a prop swap is detectable
  // during render (same pattern as useFeatureTreeStorage).
  const [state, setState] = useState<{ key: string; entries: ChatHistoryEntry[] }>(() => ({
    key: storageKey,
    entries: loadChatHistory(storageKey),
  }));

  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEntriesRef = useRef<ChatHistoryEntry[] | null>(null);
  const pendingWriteKeyRef = useRef<string | null>(null);

  const flushPending = useCallback((forKey: string): void => {
    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    const toWrite = pendingEntriesRef.current;
    pendingEntriesRef.current = null;
    pendingWriteKeyRef.current = null;
    if (toWrite === null) return;
    const res = saveChatHistory(toWrite, forKey);
    if (!res.ok && onErrorRef.current) {
      onErrorRef.current(res.error, res.message);
    }
  }, []);

  const schedulePending = useCallback(
    (entries: ChatHistoryEntry[], writeKey: string): void => {
      pendingEntriesRef.current = entries;
      pendingWriteKeyRef.current = writeKey;
      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
      }
      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
        const toWrite = pendingEntriesRef.current;
        pendingEntriesRef.current = null;
        pendingWriteKeyRef.current = null;
        if (toWrite === null) return;
        const res = saveChatHistory(toWrite, writeKey);
        if (!res.ok && onErrorRef.current) {
          onErrorRef.current(res.error, res.message);
        }
      }, CHAT_HISTORY_AUTOSAVE_DEBOUNCE_MS);
    },
    [],
  );

  // Render-time key swap. React deduplicates setState in the same tick,
  // so this is safe to call unconditionally on the "key changed" path.
  if (state.key !== storageKey) {
    setState({ key: storageKey, entries: loadChatHistory(storageKey) });
  }

  // Effect runs post-commit; flushes pending writes that targeted the
  // OLD key before the swap is observed by future schedulePending calls.
  const lastSeenKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const prevKey = lastSeenKeyRef.current;
    lastSeenKeyRef.current = state.key;
    if (prevKey !== null && prevKey !== state.key) {
      if (pendingWriteKeyRef.current === prevKey) {
        flushPending(prevKey);
      }
    }
  }, [state.key, flushPending]);

  // Unmount cleanup: discard pending timer + buffered entries (no late
  // write, no leaked timer). Discards rather than flushes — matches the
  // useFeatureTreeStorage contract.
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      pendingEntriesRef.current = null;
      pendingWriteKeyRef.current = null;
    };
  }, []);

  const add = useCallback(
    (entry: Omit<ChatHistoryEntry, 'id' | 'timestamp'>): string => {
      const id = generateId();
      const full: ChatHistoryEntry = {
        ...entry,
        id,
        timestamp: Date.now(),
      };
      setState((prev) => {
        const nextEntries = addEntry(prev.entries, full, maxEntries);
        schedulePending(nextEntries, prev.key);
        return { key: prev.key, entries: nextEntries };
      });
      return id;
    },
    [maxEntries, schedulePending],
  );

  const markAppliedCb = useCallback(
    (id: string): void => {
      setState((prev) => {
        const nextEntries = markApplied(prev.entries, id);
        if (nextEntries === prev.entries) return prev;
        schedulePending(nextEntries, prev.key);
        return { key: prev.key, entries: nextEntries };
      });
    },
    [schedulePending],
  );

  const clearCb = useCallback((): void => {
    setState((prev) => {
      // Discard any pending write — it would re-create the cleared
      // entries on disk after the clear lands.
      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      pendingEntriesRef.current = null;
      pendingWriteKeyRef.current = null;
      clearHistory(prev.key);
      return { key: prev.key, entries: [] };
    });
  }, []);

  const exportJsonCb = useCallback((): string => {
    return exportJson(state.entries);
  }, [state.entries]);

  return {
    history: state.entries,
    add,
    markApplied: markAppliedCb,
    clear: clearCb,
    exportJson: exportJsonCb,
  };
}
