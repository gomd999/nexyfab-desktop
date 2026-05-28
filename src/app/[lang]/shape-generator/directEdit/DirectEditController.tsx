'use client';

/**
 * DirectEditController.tsx — Wave 2 Phase 3 Track E1.
 *
 * Owns the session-only direct-edit stack (ADR-012 §6).
 *
 * Responsibilities:
 *   - Maintain in-memory `DirectEditStack` (NOT a Y.Doc subtree —
 *     CRDT collab direct edit is Wave 3, tracker §12).
 *   - Expose push/pop/clear via React Context + hooks.
 *   - Bind to the parametric history version. When the host bumps
 *     the version (re-run history from earlier), the controller
 *     clears the stack and emits a non-blocking toast.
 *   - Flag-gate on `?direct-edit=v1`. When OFF, the controller is a
 *     no-op (provides an empty stack, warns on push).
 *
 * Why a controller (Context) instead of a custom hook returning state:
 *   - The overlay (inside <Canvas>) and the toolbar (outside <Canvas>)
 *     both need read+write access to the same stack. Context is the
 *     idiomatic React fan-out.
 *   - The host's history-rerun signal lives in the feature stack at
 *     the top of <ShapeGeneratorInner>; the controller subscribes via
 *     prop, not by reaching into useFeatureStack directly. Keeps the
 *     coupling explicit and testable.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  emptyDirectEditStack,
  type DirectEditOp,
  type DirectEditStack,
} from './directEditTypes';

// ─── Context shape ──────────────────────────────────────────────────────────

export interface DirectEditControllerApi {
  /** Current stack snapshot. Re-renders subscribers on change. */
  stack: DirectEditStack;
  /** Append an op. No-op (with warn) when the flag is OFF. */
  pushOp: (op: DirectEditOp) => void;
  /** Remove the last op (undo). No-op on empty. */
  popOp: () => void;
  /** Clear all ops (e.g. on history-rerun invalidation). */
  clearStack: (reason?: 'manual' | 'historyRerun') => void;
  /** Remove the first `count` ops from the front of the stack — used
   *  by the partial-commit path (E5). Order of the remaining ops is
   *  preserved. */
  shiftOps: (count: number) => void;
  /** E5 (W7) — mark a region of code as "this is a commit-to-history
   *  flow", which causes the next history-version bump to NOT fire the
   *  invalidation toast. Returns a `release` callback the caller must
   *  call once the bump has settled. Implemented as a counter so
   *  nested commits don't accidentally re-enable the toast early. */
  beginCommitFlow: () => () => void;
  /** Whether the controller is active (flag ON). When false, push
   *  emits a warning and is otherwise no-op. */
  enabled: boolean;
}

const DirectEditContext = createContext<DirectEditControllerApi | null>(null);

// ─── Toast event (host listens, controller emits) ───────────────────────────

/** CustomEvent name used to bubble a "your direct edits were
 *  invalidated by a history change" toast up to the host. The host
 *  binds a window listener and shows whatever toast UI it prefers
 *  (controller stays UI-framework agnostic, so it doesn't depend on
 *  the host's specific toast component). */
export const DIRECT_EDIT_INVALIDATED_EVENT = 'nfab:direct-edit-invalidated';

export interface DirectEditInvalidatedDetail {
  /** Number of ops that were cleared. */
  clearedCount: number;
  /** History version that triggered the clear. */
  newHistoryVersion: number;
}

function emitInvalidatedToast(detail: DirectEditInvalidatedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<DirectEditInvalidatedDetail>(
      DIRECT_EDIT_INVALIDATED_EVENT,
      { detail },
    ),
  );
}

// ─── Provider ───────────────────────────────────────────────────────────────

export interface DirectEditProviderProps {
  /** Whether `?direct-edit=v1` is active. The provider becomes a
   *  no-op (empty stack, push warns) when false. */
  enabled: boolean;
  /** Current parametric history version. The provider compares this
   *  to the stack's recorded version on each render and clears + emits
   *  the toast on mismatch (with a non-zero ops count). */
  historyVersion: number;
  children: React.ReactNode;
}

export function DirectEditProvider({
  enabled,
  historyVersion,
  children,
}: DirectEditProviderProps): React.ReactElement {
  const [stack, setStack] = useState<DirectEditStack>(() => emptyDirectEditStack());

  // E5 (W7) — counter that suppresses the invalidation toast while a
  // commit-to-history flow is in progress. The flow is "user clicks
  // commit → controller appends N history nodes → host bumps
  // historyVersion → the useEffect below sees the mismatch and would
  // normally fire the toast". The commit caller raises the counter
  // BEFORE the bump and releases it AFTER, so the useEffect skips the
  // toast for exactly that one transition. Implementation note: we
  // also need to clear the stack on commit (which we do directly via
  // `clearStack('manual')`) so the historyVersion-bump branch is
  // already a no-op (stack.ops.length === 0) under normal flow. The
  // counter is a belt-and-braces guard for race conditions where the
  // host bumps the version BEFORE the stack-clear React state settles.
  const commitFlowCountRef = useRef<number>(0);

  // History-rerun invalidation. Compare the provider's current
  // `historyVersion` to whatever the stack recorded on first push.
  // We use a ref to track the "last seen" version so we only fire
  // the toast on the bump-to-bump transition, not on the initial
  // render (the stack is empty then anyway).
  const lastVersionRef = useRef<number>(historyVersion);
  useEffect(() => {
    const prev = lastVersionRef.current;
    if (prev !== historyVersion && stack.ops.length > 0) {
      // Suppress the toast when the bump is caused by THIS controller
      // committing direct edits (E5). The stack will be cleared by the
      // commit flow itself; we just swallow the would-be toast here.
      if (commitFlowCountRef.current > 0) {
        setStack(emptyDirectEditStack());
      } else {
        const clearedCount = stack.ops.length;
        setStack(emptyDirectEditStack());
        emitInvalidatedToast({
          clearedCount,
          newHistoryVersion: historyVersion,
        });
      }
    }
    lastVersionRef.current = historyVersion;
  }, [historyVersion, stack.ops.length]);

  const pushOp = useCallback((op: DirectEditOp) => {
    if (!enabled) {
      console.warn(
        '[directEdit] pushOp called while ?direct-edit=v1 is OFF — ignoring',
      );
      return;
    }
    setStack(prev => ({
      ops: [...prev.ops, op],
      // Adopt the host's current history version on first push so
      // subsequent re-runs can detect the mismatch.
      historyVersion: prev.ops.length === 0
        ? lastVersionRef.current
        : prev.historyVersion,
    }));
  }, [enabled]);

  const popOp = useCallback(() => {
    setStack(prev => {
      if (prev.ops.length === 0) return prev;
      return { ...prev, ops: prev.ops.slice(0, -1) };
    });
  }, []);

  const clearStack = useCallback((reason?: 'manual' | 'historyRerun') => {
    setStack(prev => {
      if (prev.ops.length === 0) return prev;
      if (reason === 'historyRerun') {
        emitInvalidatedToast({
          clearedCount: prev.ops.length,
          newHistoryVersion: lastVersionRef.current,
        });
      }
      return emptyDirectEditStack();
    });
  }, []);

  const shiftOps = useCallback((count: number) => {
    if (count <= 0) return;
    setStack(prev => {
      if (prev.ops.length === 0) return prev;
      const n = Math.min(count, prev.ops.length);
      return { ...prev, ops: prev.ops.slice(n) };
    });
  }, []);

  const beginCommitFlow = useCallback(() => {
    commitFlowCountRef.current += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      commitFlowCountRef.current = Math.max(0, commitFlowCountRef.current - 1);
    };
  }, []);

  const api = useMemo<DirectEditControllerApi>(() => ({
    stack,
    pushOp,
    popOp,
    clearStack,
    shiftOps,
    beginCommitFlow,
    enabled,
  }), [stack, pushOp, popOp, clearStack, shiftOps, beginCommitFlow, enabled]);

  return (
    <DirectEditContext.Provider value={api}>
      {children}
    </DirectEditContext.Provider>
  );
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

/** Fallback API for callers outside a provider. Always disabled. */
const NULL_API: DirectEditControllerApi = {
  stack: emptyDirectEditStack(),
  pushOp: () => {
    console.warn('[directEdit] pushOp called outside DirectEditProvider — ignoring');
  },
  popOp: () => {},
  clearStack: () => {},
  shiftOps: () => {},
  beginCommitFlow: () => () => {},
  enabled: false,
};

/** Returns the current stack + ops. Safe to call outside a provider —
 *  returns an empty stack instead of throwing. */
export function useDirectEditStack(): DirectEditStack {
  const ctx = useContext(DirectEditContext);
  return ctx?.stack ?? NULL_API.stack;
}

/** Returns push/pop/clear + the enabled flag. Safe outside a provider —
 *  returns the NULL_API which warns + no-ops. */
export function useDirectEditController(): DirectEditControllerApi {
  const ctx = useContext(DirectEditContext);
  return ctx ?? NULL_API;
}

/** True when `?direct-edit=v1` is set and the provider is mounted. */
export function useDirectEditEnabled(): boolean {
  const ctx = useContext(DirectEditContext);
  return ctx?.enabled ?? false;
}
