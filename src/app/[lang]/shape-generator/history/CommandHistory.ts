// ─── Command Pattern History — Core ───────────────────────────────────────────

export interface HistoryCommand {
  id: string;
  label: string;
  labelKo: string;
  execute(): void;
  undo(): void;
}

type Listener = () => void;

const MAX_HISTORY = 100;

class CommandHistory {
  past: HistoryCommand[] = [];
  future: HistoryCommand[] = [];

  private listeners: Set<Listener> = new Set();
  private cachedSnapshot: { past: HistoryCommand[]; future: HistoryCommand[] } = {
    past: [],
    future: [],
  };

  /* ── Subscription (React useSyncExternalStore) ── */

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.cachedSnapshot = { past: [...this.past], future: [...this.future] };
    this.listeners.forEach(fn => fn());
  }

  getSnapshot(): { past: HistoryCommand[]; future: HistoryCommand[] } {
    return this.cachedSnapshot;
  }

  /* ── Command operations ── */

  execute(cmd: HistoryCommand): void {
    try {
      cmd.execute();
      this.past.push(cmd);
      if (this.past.length > MAX_HISTORY) {
        this.past.shift();
      }
      // Executing a new command clears the redo stack
      this.future = [];
      this.notify();
    } catch (error) {
      console.error('[CommandHistory] Command execution failed:', error);
      throw error; // re-throw so caller knows
    }
  }

  undo(): boolean {
    if (this.past.length === 0) return false;
    const cmd = this.past.pop()!;
    cmd.undo();
    this.future.push(cmd);
    this.notify();
    return true;
  }

  redo(): boolean {
    if (this.future.length === 0) return false;
    const cmd = this.future.pop()!;
    cmd.execute();
    this.past.push(cmd);
    this.notify();
    return true;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.notify();
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  getHistory(): { past: HistoryCommand[]; future: HistoryCommand[] } {
    return { past: [...this.past], future: [...this.future] };
  }
}

// Singleton export
export const commandHistory = new CommandHistory();
