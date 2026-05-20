import { describe, it, expect } from 'vitest';
import {
  sequenceOperations,
  reportToolUsage,
  summarize,
  type Operation,
} from './toolChangeSequencer';

function op(id: string, tool: string, deps: string[] = [], duration: number = 60): Operation {
  return { id, toolId: tool, durationSec: duration, dependencies: deps };
}

describe('sequenceOperations', () => {
  it('empty input → empty result', () => {
    const r = sequenceOperations([]);
    expect(r.order).toEqual([]);
    expect(r.toolChangeCount).toBe(0);
  });

  it('single op → no tool change', () => {
    const r = sequenceOperations([op('a', 'T1')]);
    expect(r.order).toEqual(['a']);
    expect(r.toolChangeCount).toBe(0);
  });

  it('groups same-tool ops to minimize changes', () => {
    const ops = [
      op('a', 'T1'),
      op('b', 'T2'),
      op('c', 'T1'),
      op('d', 'T2'),
    ];
    const r = sequenceOperations(ops);
    expect(r.toolChangeCount).toBeLessThan(3);
  });

  it('respects dependencies', () => {
    const ops = [
      op('a', 'T1'),
      op('b', 'T2', ['a']), // b must come after a
    ];
    const r = sequenceOperations(ops);
    const idxA = r.order.indexOf('a');
    const idxB = r.order.indexOf('b');
    expect(idxA).toBeLessThan(idxB);
  });

  it('schedules all ops when no cycles', () => {
    const ops = [op('a', 'T1'), op('b', 'T2', ['a']), op('c', 'T1', ['b'])];
    const r = sequenceOperations(ops);
    expect(r.scheduledAll).toBe(true);
    expect(r.order).toHaveLength(3);
  });

  it('compares with input ordering', () => {
    const ops = [
      op('a', 'T1'),
      op('b', 'T2'),
      op('c', 'T1'),
      op('d', 'T2'),
    ];
    const r = sequenceOperations(ops);
    expect(r.comparisonInputChanges).toBe(3);
    expect(r.toolChangeCount).toBeLessThan(r.comparisonInputChanges);
  });

  it('totalToolChangeSec scales with toolChangeSec option', () => {
    const ops = [op('a', 'T1'), op('b', 'T2')];
    const fast = sequenceOperations(ops, { toolChangeSec: 5 });
    const slow = sequenceOperations(ops, { toolChangeSec: 60 });
    expect(slow.totalToolChangeSec).toBeGreaterThanOrEqual(fast.totalToolChangeSec);
  });

  it('cyclic deps result in fewer scheduled', () => {
    const ops = [
      op('a', 'T1', ['b']),
      op('b', 'T2', ['a']),
    ];
    const r = sequenceOperations(ops);
    expect(r.scheduledAll).toBe(false);
  });
});

describe('reportToolUsage', () => {
  it('counts ops per tool', () => {
    const usage = reportToolUsage([op('a', 'T1'), op('b', 'T1'), op('c', 'T2')]);
    const t1 = usage.find(u => u.toolId === 'T1');
    expect(t1!.opCount).toBe(2);
  });

  it('sums duration per tool', () => {
    const usage = reportToolUsage([
      op('a', 'T1', [], 30),
      op('b', 'T1', [], 60),
    ]);
    const t1 = usage.find(u => u.toolId === 'T1');
    expect(t1!.totalDurationSec).toBe(90);
  });

  it('sorts by duration descending', () => {
    const usage = reportToolUsage([
      op('a', 'T1', [], 10),
      op('b', 'T2', [], 100),
    ]);
    expect(usage[0]!.toolId).toBe('T2');
  });
});

describe('summarize', () => {
  it('counts unique tools', () => {
    const ops = [op('a', 'T1'), op('b', 'T2'), op('c', 'T1')];
    const r = sequenceOperations(ops);
    const s = summarize(ops, r);
    expect(s.uniqueToolCount).toBe(2);
  });

  it('reports tool changes saved', () => {
    const ops = [
      op('a', 'T1'),
      op('b', 'T2'),
      op('c', 'T1'),
      op('d', 'T2'),
    ];
    const r = sequenceOperations(ops);
    const s = summarize(ops, r);
    expect(s.toolChangesSaved).toBeGreaterThanOrEqual(0);
  });

  it('time saved positive when reordering helped', () => {
    const ops = [
      op('a', 'T1'),
      op('b', 'T2'),
      op('c', 'T1'),
    ];
    const r = sequenceOperations(ops);
    const s = summarize(ops, r, { toolChangeSec: 30 });
    expect(s.timeSavedSec).toBeGreaterThanOrEqual(0);
  });
});
