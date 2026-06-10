import { describe, it, expect, beforeEach } from 'vitest';
import { commandHistory } from '../CommandHistory';
import type { HistoryCommand } from '../CommandHistory';

function makeCmd(label: string, ops: { onExec?: () => void; onUndo?: () => void } = {}): HistoryCommand {
  return {
    id: `${label}-${Math.random()}`,
    label,
    labelKo: label,
    execute: ops.onExec ?? (() => {}),
    undo: ops.onUndo ?? (() => {}),
  };
}

describe('CommandHistory', () => {
  beforeEach(() => {
    commandHistory.clear();
  });

  it('execute pushes to past, undo moves to future', () => {
    let val = 0;
    commandHistory.execute(makeCmd('inc', {
      onExec: () => { val += 1; },
      onUndo: () => { val -= 1; },
    }));
    expect(val).toBe(1);
    expect(commandHistory.past).toHaveLength(1);
    expect(commandHistory.undo()).toBe(true);
    expect(val).toBe(0);
    expect(commandHistory.past).toHaveLength(0);
    expect(commandHistory.future).toHaveLength(1);
  });

  it('redo replays the last undone command', () => {
    let val = 0;
    commandHistory.execute(makeCmd('inc', {
      onExec: () => { val += 1; },
      onUndo: () => { val -= 1; },
    }));
    commandHistory.undo();
    expect(commandHistory.redo()).toBe(true);
    expect(val).toBe(1);
  });

  it('execute clears the redo stack', () => {
    commandHistory.execute(makeCmd('a'));
    commandHistory.undo();
    expect(commandHistory.future).toHaveLength(1);
    commandHistory.execute(makeCmd('b'));
    expect(commandHistory.future).toHaveLength(0);  // redo wiped by new execute
  });

  it('undo on empty stack returns false (no-op)', () => {
    expect(commandHistory.undo()).toBe(false);
    expect(commandHistory.redo()).toBe(false);
  });

  it('caps past at MAX_HISTORY (100)', () => {
    for (let i = 0; i < 150; i++) commandHistory.execute(makeCmd(`cmd-${i}`));
    expect(commandHistory.past.length).toBeLessThanOrEqual(100);
  });

  it('multiple undos drain in LIFO order', () => {
    const log: string[] = [];
    commandHistory.execute(makeCmd('A', {
      onExec: () => { log.push('A:exec'); },
      onUndo: () => { log.push('A:undo'); },
    }));
    commandHistory.execute(makeCmd('B', {
      onExec: () => { log.push('B:exec'); },
      onUndo: () => { log.push('B:undo'); },
    }));
    commandHistory.undo();
    commandHistory.undo();
    expect(log).toEqual(['A:exec', 'B:exec', 'B:undo', 'A:undo']);
  });

  it('failed execute does not pollute past stack', () => {
    expect(() => commandHistory.execute(makeCmd('boom', {
      onExec: () => { throw new Error('intentional'); },
    }))).toThrow('intentional');
    expect(commandHistory.past).toHaveLength(0);
  });

  it('clear empties both stacks', () => {
    commandHistory.execute(makeCmd('a'));
    commandHistory.undo();
    commandHistory.clear();
    expect(commandHistory.past).toHaveLength(0);
    expect(commandHistory.future).toHaveLength(0);
  });
});

// ─── Undo unification Phase B ─────────────────────────────────────────────────
// The legacy useHistory snapshot stack is gone; these tests pin the behaviors
// it used to (partially) provide, now expressed purely as commands.

describe('CommandHistory — Phase B (single source of truth)', () => {
  beforeEach(() => {
    commandHistory.clear();
  });

  /** Mirrors handleSelectShape: a shape switch is one command that swaps
   *  selectedId + params and restores both on undo. */
  function makeShapeChangeCmd(
    state: { selectedId: string; params: Record<string, number> },
    nextId: string,
    nextParams: Record<string, number>,
  ): HistoryCommand {
    const prevSelectedId = state.selectedId;
    const prevParams = { ...state.params };
    return {
      id: `shape-change-${nextId}-${Math.random()}`,
      label: `Shape → ${nextId}`,
      labelKo: `형상 변경 → ${nextId}`,
      execute: () => { state.selectedId = nextId; state.params = { ...nextParams }; },
      undo: () => { state.selectedId = prevSelectedId; state.params = prevParams; },
    };
  }

  it('undo after a selectedId switch restores the prior shape selection + params', () => {
    const state = { selectedId: 'box', params: { w: 10, h: 20 } };
    commandHistory.execute(makeShapeChangeCmd(state, 'cylinder', { r: 5, h: 30 }));
    expect(state.selectedId).toBe('cylinder');
    commandHistory.undo();
    expect(state.selectedId).toBe('box');
    expect(state.params).toEqual({ w: 10, h: 20 });
    // and redo re-applies the switch
    commandHistory.redo();
    expect(state.selectedId).toBe('cylinder');
    expect(state.params).toEqual({ r: 5, h: 30 });
  });

  it('chained shape switches undo in LIFO order back to the original shape', () => {
    const state = { selectedId: 'box', params: { w: 1 } };
    commandHistory.execute(makeShapeChangeCmd(state, 'cylinder', { r: 2 }));
    commandHistory.execute(makeShapeChangeCmd(state, 'sphere', { r: 3 }));
    commandHistory.undo();
    expect(state.selectedId).toBe('cylinder');
    commandHistory.undo();
    expect(state.selectedId).toBe('box');
    expect(state.params).toEqual({ w: 1 });
  });

  it('a new mutation after undo clears the redo branch (canRedo drops)', () => {
    const state = { selectedId: 'box', params: {} };
    commandHistory.execute(makeShapeChangeCmd(state, 'cylinder', {}));
    commandHistory.undo();
    expect(commandHistory.canRedo).toBe(true);
    commandHistory.execute(makeShapeChangeCmd(state, 'torus', {}));
    expect(commandHistory.canRedo).toBe(false);
    expect(commandHistory.redo()).toBe(false); // no zombie redo
    expect(state.selectedId).toBe('torus');
  });

  it('canUndo/canRedo are reactive: every transition notifies subscribers with a fresh snapshot', () => {
    const seen: { canUndo: boolean; canRedo: boolean }[] = [];
    const unsub = commandHistory.subscribe(() => {
      const snap = commandHistory.getSnapshot();
      seen.push({ canUndo: snap.past.length > 0, canRedo: snap.future.length > 0 });
    });
    expect(commandHistory.canUndo).toBe(false);
    expect(commandHistory.canRedo).toBe(false);

    commandHistory.execute(makeCmd('a'));
    expect(commandHistory.canUndo).toBe(true);
    commandHistory.undo();
    expect(commandHistory.canUndo).toBe(false);
    expect(commandHistory.canRedo).toBe(true);
    commandHistory.redo();
    expect(commandHistory.canUndo).toBe(true);
    expect(commandHistory.canRedo).toBe(false);

    expect(seen).toEqual([
      { canUndo: true, canRedo: false },   // execute
      { canUndo: false, canRedo: true },   // undo
      { canUndo: true, canRedo: false },   // redo
    ]);

    // snapshot identity changes per notify (useSyncExternalStore contract)
    const s1 = commandHistory.getSnapshot();
    commandHistory.execute(makeCmd('b'));
    expect(commandHistory.getSnapshot()).not.toBe(s1);

    unsub();
    const before = seen.length;
    commandHistory.execute(makeCmd('c'));
    expect(seen.length).toBe(before); // unsubscribed → no further notifications
  });
});
