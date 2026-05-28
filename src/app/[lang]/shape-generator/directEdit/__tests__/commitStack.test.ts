/**
 * commitStack.test.ts — Wave 2 Phase 3 Track E5 (W7).
 *
 * Tests for the stack-level orchestrator.
 *
 * Coverage:
 *   - Empty stack returns ok with 0 ops cleared
 *   - All-pushPull success: appendedNodes in order, clearStack fired
 *   - First-failure: stops at the failing op, returns partialNodes
 *   - Rollback semantics: no callbacks fire when failure occurs
 *   - beginCommit / endCommit fire on success and on partial commit
 *   - commitPartialNodes appends only the prefix and shifts the stack
 *   - Order invariant: failed ops remain at front after partial
 */

import { describe, it, expect, vi } from 'vitest';
import {
  commitDirectEditStackToHistory,
  commitPartialNodes,
} from '../commitStack';
import type { CommitContext } from '../commitToHistory';
import type { DirectEditOp, DirectEditStack } from '../directEditTypes';
import type { HistoryNode } from '../../useFeatureStack';

function makeCtx(overrides: Partial<CommitContext> = {}): CommitContext {
  let counter = 0;
  return {
    nextNodeId: () => `node-${++counter}`,
    activeNodeId: 'root',
    getFaceFeatureId: () => 'owner-1',
    now: () => 1700000000000,
    ...overrides,
  };
}

function makeStack(ops: DirectEditOp[]): DirectEditStack {
  return { ops, historyVersion: 0 };
}

function pp(offset: number, faceId = 'face'): DirectEditOp {
  return { kind: 'pushPull', faceId, offsetMm: offset, createdAt: 0 };
}

describe('commitDirectEditStackToHistory — success paths', () => {
  it('empty stack returns ok with 0 cleared', () => {
    const appendNodes = vi.fn();
    const clearStack = vi.fn();
    const r = commitDirectEditStackToHistory(
      makeStack([]),
      makeCtx(),
      { appendNodes, clearStack },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.clearedOps).toBe(0);
    expect(appendNodes).not.toHaveBeenCalled();
    expect(clearStack).not.toHaveBeenCalled();
  });

  it('single pushPull op: appends one node, clears stack', () => {
    const appendNodes = vi.fn();
    const clearStack = vi.fn();
    const r = commitDirectEditStackToHistory(
      makeStack([pp(5)]),
      makeCtx(),
      { appendNodes, clearStack },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.clearedOps).toBe(1);
    expect(appendNodes).toHaveBeenCalledTimes(1);
    expect(clearStack).toHaveBeenCalledTimes(1);
    const nodes = appendNodes.mock.calls[0]![0] as HistoryNode[];
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.params.offsetMm).toBe(5);
  });

  it('three pushPulls map in stack order', () => {
    const appendNodes = vi.fn();
    const clearStack = vi.fn();
    const r = commitDirectEditStackToHistory(
      makeStack([pp(1), pp(2), pp(3)]),
      makeCtx(),
      { appendNodes, clearStack },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.clearedOps).toBe(3);
    const nodes = appendNodes.mock.calls[0]![0] as HistoryNode[];
    expect(nodes.map(n => n.params.offsetMm)).toEqual([1, 2, 3]);
  });

  it('calls beginCommit before appendNodes', () => {
    const order: string[] = [];
    const beginCommit = vi.fn(() => { order.push('begin'); });
    const appendNodes = vi.fn(() => { order.push('append'); });
    const clearStack = vi.fn(() => { order.push('clear'); });
    const endCommit = vi.fn(() => { order.push('end'); });
    commitDirectEditStackToHistory(
      makeStack([pp(5)]),
      makeCtx(),
      { appendNodes, clearStack, beginCommit, endCommit },
    );
    expect(order).toEqual(['begin', 'append', 'clear', 'end']);
  });

  it('calls endCommit even when appendNodes throws', () => {
    const endCommit = vi.fn();
    const appendNodes = vi.fn(() => { throw new Error('boom'); });
    expect(() =>
      commitDirectEditStackToHistory(
        makeStack([pp(5)]),
        makeCtx(),
        { appendNodes, clearStack: vi.fn(), endCommit },
      ),
    ).toThrow('boom');
    expect(endCommit).toHaveBeenCalledTimes(1);
  });
});

describe('commitDirectEditStackToHistory — failure paths', () => {
  it('first-op failure: no side effects, returns empty partial', () => {
    const appendNodes = vi.fn();
    const clearStack = vi.fn();
    const r = commitDirectEditStackToHistory(
      makeStack([{ kind: 'unknownTestKind' } as unknown as DirectEditOp]),
      makeCtx(),
      { appendNodes, clearStack },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.partialNodes).toEqual([]);
    expect(r.failedAt).toBe(0);
    expect(r.reason).toBe('unknown_op_kind');
    expect(appendNodes).not.toHaveBeenCalled();
    expect(clearStack).not.toHaveBeenCalled();
  });

  it('mid-stack failure: partialNodes contains prefix, failedAt = index', () => {
    const appendNodes = vi.fn();
    const clearStack = vi.fn();
    const stack = makeStack([
      pp(1),
      pp(2),
      { kind: 'unknownTestKind' } as unknown as DirectEditOp,
      pp(4),
    ]);
    const r = commitDirectEditStackToHistory(
      stack,
      makeCtx(),
      { appendNodes, clearStack },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.partialNodes).toHaveLength(2);
    expect(r.partialNodes.map(n => n.params.offsetMm)).toEqual([1, 2]);
    expect(r.failedAt).toBe(2);
    expect(appendNodes).not.toHaveBeenCalled();
    expect(clearStack).not.toHaveBeenCalled();
  });

  it('mid-stack failure with invalid_offset: surface the right reason', () => {
    const stack = makeStack([pp(1), pp(0), pp(3)]);
    const r = commitDirectEditStackToHistory(
      stack,
      makeCtx(),
      { appendNodes: vi.fn(), clearStack: vi.fn() },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_offset');
    expect(r.failedAt).toBe(1);
    expect(r.partialNodes).toHaveLength(1);
  });

  it('does NOT fire beginCommit / endCommit on a failure', () => {
    const beginCommit = vi.fn();
    const endCommit = vi.fn();
    const r = commitDirectEditStackToHistory(
      makeStack([{ kind: 'unknownTestKind' } as unknown as DirectEditOp]),
      makeCtx(),
      {
        appendNodes: vi.fn(),
        clearStack: vi.fn(),
        beginCommit,
        endCommit,
      },
    );
    expect(r.ok).toBe(false);
    expect(beginCommit).not.toHaveBeenCalled();
    expect(endCommit).not.toHaveBeenCalled();
  });
});

describe('commitPartialNodes — partial commit follow-up', () => {
  it('appends the prefix and shifts the stack by N', () => {
    const appendNodes = vi.fn();
    const clearStack = vi.fn();
    const shiftOps = vi.fn();
    const partial: HistoryNode[] = [
      {
        id: 'a', type: 'feature', label: 'A', icon: '↕️',
        params: { offsetMm: 1 }, enabled: true, expanded: true,
        parentId: 'root', children: [], editingActive: false, timestamp: 0,
      },
      {
        id: 'b', type: 'feature', label: 'B', icon: '↕️',
        params: { offsetMm: 2 }, enabled: true, expanded: true,
        parentId: 'root', children: [], editingActive: false, timestamp: 0,
      },
    ];
    const out = commitPartialNodes(partial, 2, {
      appendNodes,
      clearStack,
      shiftOps,
    });
    expect(out.appendedCount).toBe(2);
    expect(out.remainingFailedAt).toBe(0);
    expect(appendNodes).toHaveBeenCalledWith(partial);
    expect(shiftOps).toHaveBeenCalledWith(2);
    expect(clearStack).not.toHaveBeenCalled();
  });

  it('no-op when partial is empty', () => {
    const appendNodes = vi.fn();
    const shiftOps = vi.fn();
    const out = commitPartialNodes([], 0, {
      appendNodes,
      clearStack: vi.fn(),
      shiftOps,
    });
    expect(out.appendedCount).toBe(0);
    expect(appendNodes).not.toHaveBeenCalled();
    expect(shiftOps).not.toHaveBeenCalled();
  });

  it('fires beginCommit/endCommit around the append', () => {
    const order: string[] = [];
    const beginCommit = vi.fn(() => { order.push('begin'); });
    const appendNodes = vi.fn(() => { order.push('append'); });
    const shiftOps = vi.fn(() => { order.push('shift'); });
    const endCommit = vi.fn(() => { order.push('end'); });
    const partial: HistoryNode[] = [{
      id: 'a', type: 'feature', label: 'A', icon: '↕️',
      params: { offsetMm: 1 }, enabled: true, expanded: true,
      parentId: 'root', children: [], editingActive: false, timestamp: 0,
    }];
    commitPartialNodes(partial, 1, {
      appendNodes,
      clearStack: vi.fn(),
      shiftOps,
      beginCommit,
      endCommit,
    });
    expect(order).toEqual(['begin', 'append', 'shift', 'end']);
  });
});
