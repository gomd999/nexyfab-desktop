/**
 * featureTreeEdit — applyEdit / diff / incremental replay / undo stack tests.
 */
import { describe, it, expect } from 'vitest';
import {
  applyEdit,
  inverseOp,
  diffTrees,
  incrementalReplay,
  FeatureTreeUndoStack,
  FeatureTreeEditError,
  type EditOp,
} from './featureTreeEdit';
import { replayTree, type FeatureTree, type FeatureNode } from './featureTree';
import type { ExtrudeFeature } from './extrudeProfile';

function rectExtrude(depth: number): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }],
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
}

function node(id: string, name: string, deps: string[] = [], depth = 3): FeatureNode {
  return { id, name, dependencies: deps, payload: rectExtrude(depth) };
}

function tree(...nodes: FeatureNode[]): FeatureTree { return { nodes }; }

// ─── applyEdit ────────────────────────────────────────────────────────────

describe('applyEdit', () => {
  it('set_payload swaps the payload, leaves other fields untouched', () => {
    const t = tree(node('a', 'Base'));
    const op: EditOp = { type: 'set_payload', nodeId: 'a', payload: rectExtrude(7) };
    const t2 = applyEdit(t, op);
    expect(t.nodes[0]!.payload).not.toBe(t2.nodes[0]!.payload);
    expect((t2.nodes[0]!.payload as ExtrudeFeature).depth).toBe(7);
    expect(t2.nodes[0]!.name).toBe('Base');
  });

  it('set_name mutates name only', () => {
    const t = tree(node('a', 'Original'));
    const t2 = applyEdit(t, { type: 'set_name', nodeId: 'a', name: 'Renamed' });
    expect(t2.nodes[0]!.name).toBe('Renamed');
  });

  it('set_suppressed mutates suppressed flag', () => {
    const t = tree(node('a', 'A'));
    const t2 = applyEdit(t, { type: 'set_suppressed', nodeId: 'a', suppressed: true });
    expect(t2.nodes[0]!.suppressed).toBe(true);
  });

  it('set_dependencies swaps deps array', () => {
    const t = tree(node('a', 'A'), node('b', 'B', ['a']));
    const t2 = applyEdit(t, { type: 'set_dependencies', nodeId: 'b', dependencies: [] });
    expect(t2.nodes[1]!.dependencies).toEqual([]);
  });

  it('throws on missing node id', () => {
    const t = tree(node('a', 'A'));
    expect(() =>
      applyEdit(t, { type: 'set_name', nodeId: 'missing', name: 'X' }),
    ).toThrow(FeatureTreeEditError);
  });
});

// ─── inverseOp ────────────────────────────────────────────────────────────

describe('inverseOp', () => {
  it('inverse of set_name captures previous name', () => {
    const t = tree(node('a', 'Before'));
    const inv = inverseOp(t, { type: 'set_name', nodeId: 'a', name: 'After' });
    expect(inv).toEqual({ type: 'set_name', nodeId: 'a', name: 'Before' });
  });

  it('inverse of set_suppressed captures previous flag (default false)', () => {
    const t = tree(node('a', 'A'));
    const inv = inverseOp(t, { type: 'set_suppressed', nodeId: 'a', suppressed: true });
    expect(inv).toEqual({ type: 'set_suppressed', nodeId: 'a', suppressed: false });
  });

  it('apply + inverse restores the original tree (round-trip)', () => {
    const t = tree(node('a', 'Base', [], 3));
    const op: EditOp = { type: 'set_payload', nodeId: 'a', payload: rectExtrude(99) };
    const t2 = applyEdit(t, op);
    const inv = inverseOp(t, op);
    const t3 = applyEdit(t2, inv);
    expect((t3.nodes[0]!.payload as ExtrudeFeature).depth).toBe(3);
  });
});

// ─── diffTrees ────────────────────────────────────────────────────────────

describe('diffTrees', () => {
  it('detects payload changes via reference inequality', () => {
    const a = node('x', 'X');
    const t1 = tree(a);
    const t2 = applyEdit(t1, { type: 'set_payload', nodeId: 'x', payload: rectExtrude(11) });
    const d = diffTrees(t1, t2);
    expect(d.changedIds).toEqual(new Set(['x']));
    expect(d.addedIds.size).toBe(0);
    expect(d.removedIds.size).toBe(0);
  });

  it('detects added nodes (and reuses existing node references when unchanged)', () => {
    const a = node('a', 'A');
    const t1 = tree(a);
    const t2 = tree(a, node('b', 'B', ['a']));
    const d = diffTrees(t1, t2);
    expect(d.addedIds).toEqual(new Set(['b']));
    // 'a' reference reused → not in changedIds.
    expect(d.changedIds).toEqual(new Set(['b']));
  });

  it('detects removed nodes', () => {
    const t1 = tree(node('a', 'A'), node('b', 'B', ['a']));
    const t2 = tree(node('a', 'A'));
    const d = diffTrees(t1, t2);
    expect(d.removedIds).toEqual(new Set(['b']));
  });

  it('no diff when nothing changed', () => {
    const t = tree(node('a', 'A'));
    const d = diffTrees(t, t);
    expect(d.changedIds.size).toBe(0);
    expect(d.addedIds.size).toBe(0);
    expect(d.removedIds.size).toBe(0);
  });
});

// ─── incrementalReplay ───────────────────────────────────────────────────

describe('incrementalReplay', () => {
  it('first render falls back to full replay', () => {
    const t = tree(node('a', 'A'));
    const r = incrementalReplay(null, null, t);
    const full = replayTree(t);
    expect(r.scad).toBe(full.scad);
  });

  it('edit to one node only re-emits that node + downstream', () => {
    const t1 = tree(node('base', 'Base'), node('hole', 'Hole', ['base'], 5));
    const r1 = replayTree(t1);
    const t2 = applyEdit(t1, { type: 'set_payload', nodeId: 'base', payload: rectExtrude(99) });
    const r2 = incrementalReplay(r1, t1, t2);
    // The base SCAD body should reflect depth=99.
    expect(r2.perNode.get('base')!).toContain('linear_extrude(height=99');
    // Unchanged downstream (hole) body should still come from cache —
    // but since 'hole' depends on 'base', it's in mustEmit, so it's
    // re-rendered too. The content is the same here (hole is pure pattern),
    // so we verify the body matches the fresh replay.
    expect(r2.perNode.get('hole')).toBe(replayTree(t2).perNode.get('hole'));
  });

  it('unrelated edits do not re-emit independent nodes (cache hit)', () => {
    const t1 = tree(node('a', 'A'), node('b', 'B'));
    const r1 = replayTree(t1);
    const t2 = applyEdit(t1, { type: 'set_payload', nodeId: 'a', payload: rectExtrude(50) });
    const r2 = incrementalReplay(r1, t1, t2);
    // 'b' has no deps on 'a', so its body must be the EXACT same string
    // reference from the cache.
    expect(r2.perNode.get('b')).toBe(r1.perNode.get('b'));
  });

  it('suppressed change is reflected without invalidating downstream cache', () => {
    const t1 = tree(node('a', 'A'), node('b', 'B'));
    const r1 = replayTree(t1);
    const t2 = applyEdit(t1, { type: 'set_suppressed', nodeId: 'b', suppressed: true });
    const r2 = incrementalReplay(r1, t1, t2);
    expect(r2.emittedOrder).toEqual(['a']);
    // 'a' body unchanged → cache hit.
    expect(r2.perNode.get('a')).toBe(r1.perNode.get('a'));
  });
});

// ─── undo stack ───────────────────────────────────────────────────────────

describe('FeatureTreeUndoStack', () => {
  it('canUndo/canRedo flip correctly', () => {
    const stack = new FeatureTreeUndoStack();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    const t = tree(node('a', 'A'));
    stack.push(t, { type: 'set_name', nodeId: 'a', name: 'B' });
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });

  it('undo applies the inverse', () => {
    const t1 = tree(node('a', 'Before'));
    const op: EditOp = { type: 'set_name', nodeId: 'a', name: 'After' };
    const t2 = applyEdit(t1, op);
    const stack = new FeatureTreeUndoStack();
    stack.push(t1, op);
    const t3 = stack.undo(t2);
    expect(t3).not.toBeNull();
    expect(t3!.nodes[0]!.name).toBe('Before');
    expect(stack.canRedo()).toBe(true);
  });

  it('redo re-applies the forward op', () => {
    const t1 = tree(node('a', 'Before'));
    const op: EditOp = { type: 'set_name', nodeId: 'a', name: 'After' };
    const t2 = applyEdit(t1, op);
    const stack = new FeatureTreeUndoStack();
    stack.push(t1, op);
    const t3 = stack.undo(t2);
    const t4 = stack.redo(t3!);
    expect(t4).not.toBeNull();
    expect(t4!.nodes[0]!.name).toBe('After');
  });

  it('new push clears the redo stack', () => {
    const t1 = tree(node('a', 'A'));
    const stack = new FeatureTreeUndoStack();
    stack.push(t1, { type: 'set_name', nodeId: 'a', name: 'B' });
    const t2 = applyEdit(t1, { type: 'set_name', nodeId: 'a', name: 'B' });
    stack.undo(t2);
    expect(stack.canRedo()).toBe(true);
    stack.push(t1, { type: 'set_name', nodeId: 'a', name: 'C' });
    expect(stack.canRedo()).toBe(false);
  });

  it('clear empties both stacks', () => {
    const stack = new FeatureTreeUndoStack();
    const t = tree(node('a', 'A'));
    stack.push(t, { type: 'set_name', nodeId: 'a', name: 'X' });
    stack.clear();
    expect(stack.canUndo()).toBe(false);
    expect(stack.size()).toEqual({ undo: 0, redo: 0 });
  });

  it('undo/redo round-trip preserves tree', () => {
    const t1 = tree(node('a', 'Base', [], 3));
    const op: EditOp = { type: 'set_payload', nodeId: 'a', payload: rectExtrude(50) };
    const t2 = applyEdit(t1, op);
    const stack = new FeatureTreeUndoStack();
    stack.push(t1, op);
    const t3 = stack.undo(t2)!;
    expect((t3.nodes[0]!.payload as ExtrudeFeature).depth).toBe(3);
    const t4 = stack.redo(t3)!;
    expect((t4.nodes[0]!.payload as ExtrudeFeature).depth).toBe(50);
  });
});
