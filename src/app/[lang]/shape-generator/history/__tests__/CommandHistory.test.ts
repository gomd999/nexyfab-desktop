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
