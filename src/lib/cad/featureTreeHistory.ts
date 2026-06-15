/**
 * featureTreeHistory — Phase 2.7.1 of NexyFab Pro own-CAD (ADR-013).
 *
 * Wraps featureTreeEdit's pure applyEdit with a linear past/present/future
 * stack. Where featureTreeEdit.FeatureTreeUndoStack stores op pairs (forward
 * + inverse) and re-applies them, this module snapshots the *tree itself*
 * at each step. Trade-off:
 *
 *   - Snapshot stack (this module):
 *       + undo/redo is a pointer move — no need to recompute via applyEdit;
 *         survives schema upgrades to applyEdit (a behavior change to the
 *         pure op wouldn't retroactively break old history entries);
 *       + integrates cleanly with React state (each step IS the new state).
 *       - O(N) bytes per node × history depth. Tolerable for trees up to
 *         ~1000 nodes × maxHistory=50 — see note below.
 *   - Op-pair stack (featureTreeEdit.FeatureTreeUndoStack):
 *       + cheaper per entry (one op record, not the whole tree);
 *       - undo re-runs applyEdit; behavior must remain idempotent forever.
 *
 * We pick snapshots here for the React hook because the editor needs each
 * past frame as a literal FeatureTree (selection, derived caches, replay
 * memoization all key off tree identity). With FeatureTree.nodes being a
 * ReadonlyArray of plain JSON, a snapshot reuses payload object identity
 * across most edits (only the touched node + the nodes array are fresh),
 * so the memory overhead is closer to "two pointer slots per node per
 * entry" than "deep-clone every byte every edit".
 *
 * maxHistory = 50 default rationale:
 *   - SOLIDWORKS / Fusion 360 default ~50 undo steps. Beyond that, users
 *     reach for the rewind-to-named-state UI, not raw undo.
 *   - 50 × 1000-node × ~80 bytes/node-pointer ≈ 4 MB worst-case retention,
 *     well under the V8 heap budget for a tab.
 *   - When a 51st edit lands, we drop the oldest past entry (FIFO eviction),
 *     not the present — present is what the user sees right now.
 *
 * Edit merge policy (Phase 1):
 *   - Every applyEdit produces a distinct HistoryEntry. No coalescing.
 *   - Slider-drag spam is the obvious offender (60 setPayloads/sec); we'll
 *     add a same-target / same-op-type merge window in Phase 2 once the
 *     editor wires onChangeCommitted vs onChange events. Until then, the
 *     caller is responsible for debouncing (the persistence layer already
 *     debounces 500 ms, which provides a natural batch boundary).
 *
 * Persistence integration:
 *   - useFeatureTreeStorage (Agent-ZZ's hook) persists ONLY the current
 *     tree, not the history stack. That matches SOLIDWORKS / Fusion: undo
 *     history is session-scoped, not file-scoped — opening a saved file
 *     starts with an empty history. We keep that invariant here.
 *   - When `storageKey` is passed to useFeatureTreeHistory, the *present*
 *     tree is mirrored to localStorage via useFeatureTreeStorage. past /
 *     future stay in memory only and are discarded on remount.
 */

import {
  type FeatureTree,
} from './featureTree';
import { applyEdit as applyEditPure, type EditOp } from './featureTreeEdit';
import { useFeatureTreeStorage } from './featureTreePersist';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ─── public types ─────────────────────────────────────────────────────────

/**
 * Re-export EditOp as FeatureTreeEdit for the history layer's public API.
 * Same underlying type; this name advertises the higher-level concern
 * (history-tracked edit) without forcing callers to import two names.
 */
export type FeatureTreeEdit = EditOp;

export interface HistoryEntry {
  /** Tree state AFTER `edit` is applied (or the initial state when edit is absent). */
  tree: FeatureTree;
  /** Edit that produced this entry. Absent for the initial entry created by `createHistory`. */
  edit?: FeatureTreeEdit;
  /** Wall-clock timestamp (Date.now()) at the time this entry was created. */
  timestamp: number;
}

export interface HistoryState {
  /** Older entries, oldest first. `past[past.length - 1]` is the last undo target. */
  past: ReadonlyArray<HistoryEntry>;
  /** The current state — what the editor renders. */
  present: HistoryEntry;
  /** Redo stack, next-to-redo first. `future[0]` is the next redo target. */
  future: ReadonlyArray<HistoryEntry>;
}

export const DEFAULT_MAX_HISTORY = 50;

// ─── pure history operations ──────────────────────────────────────────────

/**
 * Create a fresh HistoryState seeded with `initialTree` as the present.
 * past + future start empty (canUndo/canRedo both false).
 */
export function createHistory(initialTree: FeatureTree): HistoryState {
  return {
    past: [],
    present: { tree: initialTree, timestamp: Date.now() },
    future: [],
  };
}

/**
 * Apply an edit to the present tree, push the previous present onto past,
 * clear future (new edit branches off current history).
 *
 * - Delegates the actual tree mutation to featureTreeEdit.applyEdit (pure).
 * - Enforces maxHistory by dropping oldest past entries when exceeded.
 * - On applyEdit failure (e.g. unknown nodeId), re-throws the underlying
 *   FeatureTreeEditError so the caller can surface it. History is NOT
 *   advanced on failure — the present stays put.
 */
export function applyEdit(
  state: HistoryState,
  edit: FeatureTreeEdit,
  maxHistory: number = DEFAULT_MAX_HISTORY,
): HistoryState {
  const nextTree = applyEditPure(state.present.tree, edit);
  const newPresent: HistoryEntry = {
    tree: nextTree,
    edit,
    timestamp: Date.now(),
  };
  // Push the previous present onto past, evict oldest if over cap.
  let nextPast: ReadonlyArray<HistoryEntry> = [...state.past, state.present];
  if (maxHistory >= 0 && nextPast.length > maxHistory) {
    nextPast = nextPast.slice(nextPast.length - maxHistory);
  }
  return {
    past: nextPast,
    present: newPresent,
    future: [], // any pending redo is invalidated by a fresh edit
  };
}

/**
 * Move one step back: pop the most-recent past entry, make it the present,
 * push the previous present onto the front of future.
 *
 * If past is empty this is a no-op (returns the same state reference).
 */
export function undo(state: HistoryState): HistoryState {
  if (state.past.length === 0) return state;
  const newPresent = state.past[state.past.length - 1]!;
  const nextPast = state.past.slice(0, state.past.length - 1);
  const nextFuture: ReadonlyArray<HistoryEntry> = [state.present, ...state.future];
  return { past: nextPast, present: newPresent, future: nextFuture };
}

/**
 * Move one step forward: pop the next future entry, make it the present,
 * push the previous present onto past.
 *
 * If future is empty this is a no-op (returns the same state reference).
 */
export function redo(state: HistoryState): HistoryState {
  if (state.future.length === 0) return state;
  const newPresent = state.future[0]!;
  const nextFuture = state.future.slice(1);
  const nextPast: ReadonlyArray<HistoryEntry> = [...state.past, state.present];
  return { past: nextPast, present: newPresent, future: nextFuture };
}

export function canUndo(state: HistoryState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: HistoryState): boolean {
  return state.future.length > 0;
}

// ─── React hook ───────────────────────────────────────────────────────────

const EMPTY_TREE: FeatureTree = Object.freeze({ nodes: [] as FeatureTree['nodes'] });

export interface UseFeatureTreeHistoryOptions {
  /** Cap on past length. Default DEFAULT_MAX_HISTORY (50). */
  maxHistory?: number;
  /** When provided, mirror the *present* tree to localStorage via useFeatureTreeStorage.
   *  History itself is session-only and never persisted. */
  storageKey?: string;
}

export interface UseFeatureTreeHistoryReturn {
  tree: FeatureTree;
  apply: (edit: FeatureTreeEdit) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Reset to a fresh history seeded with `initialTree` (or the empty tree). */
  reset: () => void;
}

/**
 * Combine the history stack with optional localStorage persistence.
 *
 * - When `storageKey` is provided, the hook composes useFeatureTreeStorage:
 *   initial tree is read from localStorage (overriding `initialTree`), and
 *   every applied edit / undo / redo writes the new present back through
 *   the storage hook's debounced setter.
 * - When `storageKey` is absent, the hook is purely in-memory.
 *
 * `initialTree` is captured by ref so a parent re-render passing a fresh
 * literal doesn't reset the history every commit. Use `reset()` for an
 * explicit re-seed.
 */
export function useFeatureTreeHistory(
  initialTree?: FeatureTree,
  opts?: UseFeatureTreeHistoryOptions,
): UseFeatureTreeHistoryReturn {
  const maxHistory = opts?.maxHistory ?? DEFAULT_MAX_HISTORY;
  const storageKey = opts?.storageKey;

  // Resolve the seed tree once. `initialTree` is read directly on first render
  // (captured by the lazy useState initializer below). Subsequent renders
  // intentionally ignore changes to `initialTree` — otherwise an unrelated
  // parent re-render passing a fresh literal would blow away the user's
  // undo stack. The seedRef is used only by `reset()`, not by initial state.
  const initialSeed = initialTree ?? EMPTY_TREE;
  const seedRef = useRef<FeatureTree>(initialSeed);

  // When a storageKey is supplied we delegate the present-tree state to
  // useFeatureTreeStorage; otherwise we hold the present in our own state
  // (via the HistoryState below). The hook is always called (Rules of Hooks)
  // but its output is only authoritative when storageKey is truthy.
  const [storageTree, setStorageTree] = useFeatureTreeStorage(
    // Use a dummy key when persistence is disabled. The hook tolerates it
    // (localStorage round-trip is harmless under jsdom / browser); the
    // empty-string would also work but reading "" from getItem is undefined
    // behavior across older browsers, so we use a clearly-namespaced sentinel.
    storageKey ?? '__nexyfab:featureTreeHistory:no-persist__',
  );

  const [history, setHistory] = useState<HistoryState>(() => {
    // Persistence on + storage already had a non-empty tree → use it.
    // Otherwise seed from initialTree. We read `initialSeed` (a plain prop
    // value) rather than `seedRef.current` to comply with react-hooks/refs:
    // refs may not be read during render.
    if (storageKey && storageTree.nodes.length > 0) {
      return createHistory(storageTree);
    }
    return createHistory(initialSeed);
  });

  // Mirror the present tree to storage whenever it changes (and persistence
  // is enabled). The storage hook debounces its own writes (500 ms) so this
  // is safe to fire on every state transition.
  const lastMirroredTreeRef = useRef<FeatureTree>(history.present.tree);
  useEffect(() => {
    if (!storageKey) return;
    if (history.present.tree === lastMirroredTreeRef.current) return;
    lastMirroredTreeRef.current = history.present.tree;
    setStorageTree(history.present.tree);
  }, [history.present.tree, storageKey, setStorageTree]);

  const apply = useCallback(
    (edit: FeatureTreeEdit) => {
      setHistory((prev) => applyEdit(prev, edit, maxHistory));
    },
    [maxHistory],
  );

  const undoCb = useCallback(() => {
    setHistory((prev) => undo(prev));
  }, []);

  const redoCb = useCallback(() => {
    setHistory((prev) => redo(prev));
  }, []);

  const reset = useCallback(() => {
    setHistory(createHistory(seedRef.current));
  }, []);

  return useMemo(
    () => ({
      tree: history.present.tree,
      apply,
      undo: undoCb,
      redo: redoCb,
      canUndo: canUndo(history),
      canRedo: canRedo(history),
      reset,
    }),
    [history, apply, undoCb, redoCb, reset],
  );
}
