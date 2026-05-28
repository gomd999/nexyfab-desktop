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

  // History-rerun invalidation. Compare the provider's current
  // `historyVersion` to whatever the stack recorded on first push.
  // We use a ref to track the "last seen" version so we only fire
  // the toast on the bump-to-bump transition, not on the initial
  // render (the stack is empty then anyway).
  const lastVersionRef = useRef<number>(historyVersion);
  useEffect(() => {
    const prev = lastVersionRef.current;
    if (prev !== historyVersion && stack.ops.length > 0) {
      const clearedCount = stack.ops.length;
      setStack(emptyDirectEditStack());
      emitInvalidatedToast({
        clearedCount,
        newHistoryVersion: historyVersion,
      });
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

  const api = useMemo<DirectEditControllerApi>(() => ({
    stack,
    pushOp,
    popOp,
    clearStack,
    enabled,
  }), [stack, pushOp, popOp, clearStack, enabled]);

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
