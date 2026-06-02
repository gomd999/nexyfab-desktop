/**
 * assemblyHistory — Phase 4.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * Linear undo/redo history for AssemblyState. Mirrors the SSS FeatureTree
 * past/present/future history pattern but operates on full immutable
 * AssemblyState snapshots (not edit ops). Reason: assembly editing already
 * routes through pure helpers in `assemblyState.ts` (addPart, addMate,
 * setPartFixed, …) — callers already hold the post-edit state in hand,
 * so storing snapshots is cheaper than re-deriving deltas, and trivially
 * handles bulk edits (e.g., solver writeback, paste of multiple parts).
 *
 * Validation policy (intentional divergence from sketch history):
 *   - `recordChange` runs `validateAssembly` BEFORE accepting the new
 *     snapshot. Invalid state THROWS `AssemblyValidationError` instead of
 *     being silently rejected — UI must explicitly catch and surface the
 *     error, so the user never silently loses an edit.
 *   - `undo` / `redo` do NOT re-validate. The snapshot they restore was
 *     valid when it was originally recorded (or was the validated initial
 *     state), so re-running validation would be wasted work — and worse,
 *     a kernel rule change between sessions could lock the user out of
 *     restoring a previously-fine state.
 *
 * Storage policy:
 *   - In-memory only by default. The optional `storageKey` option
 *     persists the CURRENT present snapshot via `useAssemblyStorage`
 *     under the hood — past/future stacks are NOT persisted (a refresh
 *     starts a fresh history, but the working state is preserved).
 *
 * `maxHistory` default = 50: matches SSS FeatureTree, enough for a full
 * editing session of mate tweaks but small enough that a session of
 * dozens of part inserts (each carrying a snapshot of the whole IR)
 * stays well under any reasonable memory budget. Trim happens on the
 * `past` stack — oldest entries fall off first.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  validateAssembly,
  type AssemblyState,
} from './assemblyState';
import { useAssemblyStorage } from './assemblyPersist';

// ─── types ────────────────────────────────────────────────────────────────

export interface AssemblyHistoryEntry {
  state: AssemblyState;
  /** Human-readable change description ('Add part_a', 'Remove mate_3', …).
   *  Caller may pass either localised text or an i18n key — this module
   *  treats it as opaque display text. */
  description: string;
  /** `Date.now()` at the moment the entry was recorded. */
  timestamp: number;
}

export interface AssemblyHistoryState {
  past: AssemblyHistoryEntry[];
  present: AssemblyHistoryEntry;
  future: AssemblyHistoryEntry[];
}

const DEFAULT_MAX_HISTORY = 50;
const INITIAL_DESCRIPTION = 'Initial';

// ─── pure history ops ────────────────────────────────────────────────────

/**
 * Build a fresh history with `initial` as the present entry. Does NOT
 * validate — the caller is presumed to know that the initial state is
 * legal (and an empty assembly with no parts is legal by construction).
 */
export function createAssemblyHistory(initial: AssemblyState): AssemblyHistoryState {
  return {
    past: [],
    present: {
      state: initial,
      description: INITIAL_DESCRIPTION,
      timestamp: Date.now(),
    },
    future: [],
  };
}

/**
 * Record a new state on top of the current present. Throws
 * `AssemblyValidationError` if `newState` fails IR validation — the
 * intent is that UI catches this and shows the error to the user, rather
 * than the sketch-history convention of silently dropping bad edits.
 *
 * Side effects:
 *   - present → past
 *   - new entry becomes present
 *   - future is cleared (any redo branch is discarded)
 *   - if past length exceeds maxHistory, oldest entries fall off
 */
export function recordChange(
  history: AssemblyHistoryState,
  newState: AssemblyState,
  description: string,
  maxHistory: number = DEFAULT_MAX_HISTORY,
): AssemblyHistoryState {
  // Validate FIRST — never push an invalid snapshot onto the stack.
  validateAssembly(newState);

  const nextEntry: AssemblyHistoryEntry = {
    state: newState,
    description,
    timestamp: Date.now(),
  };

  const past = [...history.past, history.present];
  // Trim if we've exceeded the cap.
  while (past.length > maxHistory) {
    past.shift();
  }

  return {
    past,
    present: nextEntry,
    future: [],
  };
}

export function undo(history: AssemblyHistoryState): AssemblyHistoryState {
  if (history.past.length === 0) return history;
  const newPast = history.past.slice(0, -1);
  const newPresent = history.past[history.past.length - 1]!;
  return {
    past: newPast,
    present: newPresent,
    future: [history.present, ...history.future],
  };
}

export function redo(history: AssemblyHistoryState): AssemblyHistoryState {
  if (history.future.length === 0) return history;
  const [newPresent, ...rest] = history.future;
  return {
    past: [...history.past, history.present],
    present: newPresent!,
    future: rest,
  };
}

export function canUndo(history: AssemblyHistoryState): boolean {
  return history.past.length > 0;
}

export function canRedo(history: AssemblyHistoryState): boolean {
  return history.future.length > 0;
}

// ─── React hook ──────────────────────────────────────────────────────────

export interface UseAssemblyHistoryOptions {
  /** Max number of `past` entries to retain. Default 50. */
  maxHistory?: number;
  /** When set, the CURRENT present state is persisted to localStorage
   *  via `useAssemblyStorage`. The past/future stacks are NOT persisted —
   *  a page refresh starts a fresh history with the rehydrated state as
   *  the new initial entry. */
  storageKey?: string;
}

export interface UseAssemblyHistoryResult {
  state: AssemblyState;
  recordChange: (newState: AssemblyState, description: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reset: () => void;
  /** Description of the current entry — UI uses this for "last action:" toast / status bar. */
  description: string;
  /** Recent entries (past + present + future, present-first), capped to last 10.
   *  Intended for a small history panel; full past list is available via the
   *  pure functions if a caller really wants it. */
  history: AssemblyHistoryEntry[];
}

const EMPTY_STATE: AssemblyState = { parts: [], mates: [] };

/**
 * React hook wrapping the pure history primitives. The `state` returned
 * is always the present snapshot — so consumer components render it
 * directly with no extra indirection.
 *
 * When `storageKey` is provided, the present state survives reloads via
 * `useAssemblyStorage`; the past/future stacks are intentionally NOT
 * persisted (sketch history follows the same rule: undo across sessions
 * is more confusing than helpful).
 */
export function useAssemblyHistory(
  initial: AssemblyState = EMPTY_STATE,
  opts: UseAssemblyHistoryOptions = {},
): UseAssemblyHistoryResult {
  const maxHistory = opts.maxHistory ?? DEFAULT_MAX_HISTORY;
  const storageKey = opts.storageKey ?? '';

  // useAssemblyStorage owns the "present.state" mirror that survives
  // reloads. When storageKey is empty it degrades to plain useState.
  const [persistedState, setPersistedState] = useAssemblyStorage(storageKey, initial);

  // The persisted state seeds the initial history; subsequent changes
  // flow through recordChange / undo / redo and re-mirror to storage.
  const [history, setHistory] = useState<AssemblyHistoryState>(() =>
    createAssemblyHistory(persistedState),
  );

  // Keep the latest `initial` accessible to `reset()` without re-binding
  // the callback every render. Updated in an effect so we don't write to
  // a ref during render (react-hooks/refs lint rule).
  const initialRef = useRef<AssemblyState>(initial);
  useEffect(() => {
    initialRef.current = initial;
  }, [initial]);

  const doRecord = useCallback(
    (newState: AssemblyState, description: string) => {
      setHistory((prev) => {
        const next = recordChange(prev, newState, description, maxHistory);
        setPersistedState(next.present.state);
        return next;
      });
    },
    [maxHistory, setPersistedState],
  );

  const doUndo = useCallback(() => {
    setHistory((prev) => {
      const next = undo(prev);
      if (next !== prev) setPersistedState(next.present.state);
      return next;
    });
  }, [setPersistedState]);

  const doRedo = useCallback(() => {
    setHistory((prev) => {
      const next = redo(prev);
      if (next !== prev) setPersistedState(next.present.state);
      return next;
    });
  }, [setPersistedState]);

  const doReset = useCallback(() => {
    const fresh = createAssemblyHistory(initialRef.current);
    setHistory(fresh);
    setPersistedState(initialRef.current);
  }, [setPersistedState]);

  // UI history panel: most-recent first, capped at 10 entries.
  const recentHistory = useMemo<AssemblyHistoryEntry[]>(() => {
    const all = [
      ...history.future.slice().reverse(),
      history.present,
      ...history.past.slice().reverse(),
    ];
    return all.slice(0, 10);
  }, [history]);

  return {
    state: history.present.state,
    recordChange: doRecord,
    undo: doUndo,
    redo: doRedo,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    reset: doReset,
    description: history.present.description,
    history: recentHistory,
  };
}
