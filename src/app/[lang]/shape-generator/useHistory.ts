'use client';

import { useState, useCallback, useRef } from 'react';

export interface HistorySnapshot {
  selectedId: string;
  params: Record<string, number>;
  featureIds: string[];
}

/**
 * Undo / Redo stack for shape design.
 * Stores up to `maxSize` snapshots of { selectedId, params }.
 *
 * Uses refs to mirror stack state so that undo/redo reads are synchronous
 * and not subject to React's async state-batching race condition.
 */
export function useHistory(maxSize = 40) {
  const [undoStack, setUndoStack] = useState<HistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<HistorySnapshot[]>([]);
  const skipNext = useRef(false);

  // Refs mirror state so undo/redo reads are always current (no stale closure)
  const undoStackRef = useRef<HistorySnapshot[]>([]);
  const redoStackRef = useRef<HistorySnapshot[]>([]);

  const push = useCallback((snapshot: HistorySnapshot) => {
    if (skipNext.current) { skipNext.current = false; return; }
    setUndoStack(prev => {
      const next = [...prev, snapshot];
      if (next.length > maxSize) next.shift();
      undoStackRef.current = next; // keep ref in sync
      return next;
    });
    setRedoStack([]);
    redoStackRef.current = [];
  }, [maxSize]);

  const undo = useCallback((): HistorySnapshot | null => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return null;
    const next = [...stack];
    const popped = next.pop()!;
    undoStackRef.current = next;
    setUndoStack(next);
    const newRedo = [...redoStackRef.current, popped];
    redoStackRef.current = newRedo;
    setRedoStack(newRedo);
    skipNext.current = true;
    return popped;
  }, []);

  const redo = useCallback((): HistorySnapshot | null => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return null;
    const next = [...stack];
    const popped = next.pop()!;
    redoStackRef.current = next;
    setRedoStack(next);
    const newUndo = [...undoStackRef.current, popped];
    undoStackRef.current = newUndo;
    setUndoStack(newUndo);
    skipNext.current = true;
    return popped;
  }, []);

  const clear = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  return { push, undo, redo, clear, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 };
}
