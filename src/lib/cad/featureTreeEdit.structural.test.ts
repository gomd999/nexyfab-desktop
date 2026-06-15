/**
 * featureTreeEdit — structural ops (insert/remove/move) tests.
 *
 * Companion to featureTreeEdit.test.ts. Kept separate so the set_* ops
 * test file stays focused.
 */
import { describe, it, expect } from 'vitest';
import {
  applyEdit,
  inverseOp,
  FeatureTreeEditError,
  FeatureTreeUndoStack,
  type EditOp,
} from './featureTreeEdit';
import { validateTree, type FeatureTree, type FeatureNode } from './featureTree';
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

function node(id: string, deps: string[] = []): FeatureNode {
  return { id, name: id, dependencies: deps, payload: rectExtrude(3) };
}

function tree(...ns: FeatureNode[]): FeatureTree { return { nodes: ns }; }

// ─── insert_node ──────────────────────────────────────────────────────────

describe('applyEdit — insert_node', () => {
  it('appends to the end by default', () => {
    const t = tree(node('a'));
    const t2 = applyEdit(t, { type: 'insert_node', node: node('b', ['a']) });
    expect(t2.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(() => validateTree(t2)).not.toThrow();
  });

  it('inserts at specified index', () => {
    const t = tree(node('a'), node('c'));
    const t2 = applyEdit(t, { type: 'insert_node', node: node('b', ['a']), atIndex: 1 });
    expect(t2.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('rejects duplicate id', () => {
    const t = tree(node('a'));
    expect(() =>
      applyEdit(t, { type: 'insert_node', node: node('a') }),
    ).toThrow(FeatureTreeEditError);
  });

  it('rejects out-of-range index', () => {
    const t = tree(node('a'));
    expect(() =>
      applyEdit(t, { type: 'insert_node', node: node('b'), atIndex: 5 }),
    ).toThrow(/out of range/);
  });

  it('rejects insert where dependency would not be earlier', () => {
    const t = tree(node('a'), node('c'));
    // Inserting b at index 0 with dep on 'a' (at index 0 in current tree)
    // means after insert, b is at 0 and a is at 1 → topo violation.
    expect(() =>
      applyEdit(t, { type: 'insert_node', node: node('b', ['a']), atIndex: 0 }),
    ).toThrow(/dependency/);
  });

  it('rejects insert with dep that does not exist', () => {
    const t = tree(node('a'));
    expect(() =>
      applyEdit(t, { type: 'insert_node', node: node('b', ['ghost']) }),
    ).toThrow(/does not exist/);
  });
});

// ─── remove_node ──────────────────────────────────────────────────────────

describe('applyEdit — remove_node', () => {
  it('removes a leaf node', () => {
    const t = tree(node('a'), node('b', ['a']));
    const t2 = applyEdit(t, { type: 'remove_node', nodeId: 'b' });
    expect(t2.nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('rejects removing a node that has dependents', () => {
    const t = tree(node('a'), node('b', ['a']));
    expect(() =>
      applyEdit(t, { type: 'remove_node', nodeId: 'a' }),
    ).toThrow(/depended on by b/);
  });

  it('rejects removing a missing id', () => {
    const t = tree(node('a'));
    expect(() =>
      applyEdit(t, { type: 'remove_node', nodeId: 'ghost' }),
    ).toThrow(/not found/);
  });
});

// ─── move_node ────────────────────────────────────────────────────────────

describe('applyEdit — move_node', () => {
  it('moves a node forward (later) preserving topo invariants', () => {
    const t = tree(node('a'), node('b'), node('c'));
    const t2 = applyEdit(t, { type: 'move_node', nodeId: 'a', toIndex: 2 });
    expect(t2.nodes.map((n) => n.id)).toEqual(['b', 'c', 'a']);
    expect(() => validateTree(t2)).not.toThrow();
  });

  it('moves a node backward (earlier)', () => {
    const t = tree(node('a'), node('b'), node('c'));
    const t2 = applyEdit(t, { type: 'move_node', nodeId: 'c', toIndex: 0 });
    expect(t2.nodes.map((n) => n.id)).toEqual(['c', 'a', 'b']);
  });

  it('rejects a move that would put a dependent before its dependency', () => {
    const t = tree(node('a'), node('b', ['a']));
    // Move 'a' after 'b' would make b's dep ('a') appear later than b.
    expect(() =>
      applyEdit(t, { type: 'move_node', nodeId: 'a', toIndex: 1 }),
    ).toThrow(/topology/);
  });

  it('no-op when toIndex equals current index', () => {
    const t = tree(node('a'), node('b'));
    const t2 = applyEdit(t, { type: 'move_node', nodeId: 'a', toIndex: 0 });
    expect(t2).toBe(t);
  });

  it('rejects out-of-range index', () => {
    const t = tree(node('a'));
    expect(() =>
      applyEdit(t, { type: 'move_node', nodeId: 'a', toIndex: 5 }),
    ).toThrow(/out of range/);
  });
});

// ─── inverseOp coverage for structural ops ───────────────────────────────

describe('inverseOp — structural ops', () => {
  it('insert_node inverts to remove_node', () => {
    const t = tree(node('a'));
    const op: EditOp = { type: 'insert_node', node: node('b', ['a']) };
    const inv = inverseOp(t, op);
    expect(inv).toEqual({ type: 'remove_node', nodeId: 'b' });
  });

  it('remove_node inverts to insert_node with the original node + index', () => {
    const t = tree(node('a'), node('b', ['a']));
    const op: EditOp = { type: 'remove_node', nodeId: 'b' };
    const inv = inverseOp(t, op);
    expect(inv.type).toBe('insert_node');
    if (inv.type === 'insert_node') {
      expect(inv.atIndex).toBe(1);
      expect(inv.node.id).toBe('b');
    }
  });

  it('move_node inverts to move back to original index', () => {
    const t = tree(node('a'), node('b'), node('c'));
    const op: EditOp = { type: 'move_node', nodeId: 'a', toIndex: 2 };
    const inv = inverseOp(t, op);
    expect(inv).toEqual({ type: 'move_node', nodeId: 'a', toIndex: 0 });
  });

  it('apply + inverse round-trip restores tree (insert/remove)', () => {
    const t1 = tree(node('a'));
    const op: EditOp = { type: 'insert_node', node: node('b', ['a']) };
    const t2 = applyEdit(t1, op);
    const inv = inverseOp(t1, op);
    const t3 = applyEdit(t2, inv);
    expect(t3.nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('apply + inverse round-trip restores tree (move)', () => {
    const t1 = tree(node('a'), node('b'), node('c'));
    const op: EditOp = { type: 'move_node', nodeId: 'c', toIndex: 0 };
    const t2 = applyEdit(t1, op);
    const inv = inverseOp(t1, op);
    const t3 = applyEdit(t2, inv);
    expect(t3.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });
});

// ─── undo stack with structural ops ──────────────────────────────────────

describe('FeatureTreeUndoStack with structural ops', () => {
  it('undo/redo a node insertion', () => {
    const t1 = tree(node('a'));
    const op: EditOp = { type: 'insert_node', node: node('b', ['a']) };
    const t2 = applyEdit(t1, op);
    const stack = new FeatureTreeUndoStack();
    stack.push(t1, op);
    const t3 = stack.undo(t2)!;
    expect(t3.nodes.map((n) => n.id)).toEqual(['a']);
    const t4 = stack.redo(t3)!;
    expect(t4.nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('undo/redo a node removal', () => {
    const t1 = tree(node('a'), node('b', ['a']));
    const op: EditOp = { type: 'remove_node', nodeId: 'b' };
    const t2 = applyEdit(t1, op);
    const stack = new FeatureTreeUndoStack();
    stack.push(t1, op);
    const t3 = stack.undo(t2)!;
    expect(t3.nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });
});
