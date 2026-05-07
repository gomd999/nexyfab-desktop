'use client';

// ─── React hook for Command Pattern history ───────────────────────────────────

import { useCallback, useSyncExternalStore } from 'react';
import { commandHistory } from './CommandHistory';
import type { HistoryCommand } from './CommandHistory';

export function useCommandHistory() {
  // useSyncExternalStore with all 3 args (3rd = SSR snapshot) to avoid hydration errors
  const snapshot = useSyncExternalStore(
    (listener) => commandHistory.subscribe(listener),
    () => commandHistory.getSnapshot(),
    () => ({ past: [], future: [] }),
  );

  const canUndo = snapshot.past.length > 0;
  const canRedo = snapshot.future.length > 0;

  const undo = useCallback(() => {
    commandHistory.undo();
  }, []);

  const redo = useCallback(() => {
    commandHistory.redo();
  }, []);

  const execute = useCallback((cmd: HistoryCommand) => {
    commandHistory.execute(cmd);
  }, []);

  const clear = useCallback(() => {
    commandHistory.clear();
  }, []);

  // Note: Ctrl+Z / Ctrl+Y keyboard shortcuts are handled in page.tsx keydown handler

  return {
    canUndo,
    canRedo,
    undo,
    redo,
    execute,
    clear,
    history: snapshot,
  };
}
