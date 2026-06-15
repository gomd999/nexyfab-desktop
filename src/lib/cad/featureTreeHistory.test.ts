/**
 * featureTreeHistory — pure history stack coverage.
 *
 * Covers createHistory / applyEdit / undo / redo / canUndo / canRedo and
 * the maxHistory eviction policy. The React hook is covered separately in
 * src/test/cad/useFeatureTreeHistory.test.tsx.
 */
import { describe, it, expect } from 'vitest';
import {
  createHistory,
  applyEdit,
  undo,
  redo,
  canUndo,
  canRedo,
  DEFAULT_MAX_HISTORY,
  type HistoryState,
  type FeatureTreeEdit,
} from './featureTreeHistory';
import type { FeatureTree, FeatureNode } from './featureTree';
import type { ExtrudeFeature } from './extrudeProfile';
import { FeatureTreeEditError } from './featureTreeEdit';

// ─── factories ────────────────────────────────────────────────────────────

function rectExtrude(depth: number): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }],
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
}

function makeNode(id: string, deps: string[] = [], depth = 3): FeatureNode {
  return { id, name: id, dependencies: deps, payload: rectExtrude(depth) };
}

function makeTree(...nodes: FeatureNode[]): FeatureTree {
  return { nodes };
}

function setName(nodeId: string, name: string): FeatureTreeEdit {
  return { type: 'set_name', nodeId, name };
}

function setDepth(nodeId: string, depth: number): FeatureTreeEdit {
  return { type: 'set_payload', nodeId, payload: rectExtrude(depth) };
}

// ─── createHistory ────────────────────────────────────────────────────────

describe('createHistory', () => {
  it('initial state: empty past + future, present is initialTree', () => {
    const tree = makeTree(makeNode('a'));
    const h = createHistory(tree);
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
    expect(h.present.tree).toBe(tree);
    expect(h.present.edit).toBeUndefined();
  });

  it('initial present.timestamp is set', () => {
    const before = Date.now();
    const h = createHistory(makeTree());
    const after = Date.now();
    expect(h.present.timestamp).toBeGreaterThanOrEqual(before);
    expect(h.present.timestamp).toBeLessThanOrEqual(after);
  });

  it('canUndo and canRedo are both false on fresh history', () => {
    const h = createHistory(makeTree());
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it('empty tree initial state is valid', () => {
    const h = createHistory(makeTree());
    expect(h.present.tree.nodes).toEqual([]);
  });
});

// ─── applyEdit ────────────────────────────────────────────────────────────

describe('applyEdit', () => {
  it('past grows by 1, future is cleared', () => {
    const h0 = createHistory(makeTree(makeNode('a')));
    const h1 = applyEdit(h0, setName('a', 'Renamed'));
    expect(h1.past).toHaveLength(1);
    expect(h1.future).toEqual([]);
    expect(h1.present.tree.nodes[0]!.name).toBe('Renamed');
  });

  it('previous present becomes the top of past', () => {
    const h0 = createHistory(makeTree(makeNode('a')));
    const h1 = applyEdit(h0, setName('a', 'Renamed'));
    expect(h1.past[0]).toBe(h0.present);
  });

  it('present carries the edit that produced it', () => {
    const h0 = createHistory(makeTree(makeNode('a')));
    const edit = setName('a', 'Renamed');
    const h1 = applyEdit(h0, edit);
    expect(h1.present.edit).toBe(edit);
  });

  it('does NOT mutate the input state', () => {
    const h0 = createHistory(makeTree(makeNode('a')));
    const beforePast = h0.past;
    const beforeFuture = h0.future;
    applyEdit(h0, setName('a', 'X'));
    expect(h0.past).toBe(beforePast);
    expect(h0.future).toBe(beforeFuture);
  });

  it('throws on edit targeting unknown node — state unchanged on error', () => {
    const h0 = createHistory(makeTree(makeNode('a')));
    expect(() => applyEdit(h0, setName('missing', 'X'))).toThrow(FeatureTreeEditError);
    expect(h0.past).toEqual([]);
  });

  it('new edit after undo clears future', () => {
    const h0 = createHistory(makeTree(makeNode('a')));
    const h1 = applyEdit(h0, setName('a', 'B'));
    const h2 = applyEdit(h1, setName('a', 'C'));
    const h3 = undo(h2);
    expect(h3.future).toHaveLength(1);
    const h4 = applyEdit(h3, setName('a', 'D'));
    expect(h4.future).toEqual([]);
    expect(h4.present.tree.nodes[0]!.name).toBe('D');
  });
});

// ─── undo ─────────────────────────────────────────────────────────────────

describe('undo', () => {
  it('pops the most-recent past entry into present', () => {
    const h0 = createHistory(makeTree(makeNode('a')));
    const h1 = applyEdit(h0, setName('a', 'B'));
    const h2 = undo(h1);
    expect(h2.present).toBe(h0.present);
  });

  it('pushes the prior present onto the front of future', () => {
    const h0 = createHistory(makeTree(makeNode('a')));
    const h1 = applyEdit(h0, setName('a', 'B'));
    const h2 = undo(h1);
    expect(h2.future).toHaveLength(1);
    expect(h2.future[0]).toBe(h1.present);
  });

  it('on empty past, returns the same state reference (no-op)', () => {
    const h0 = createHistory(makeTree(makeNode('a')));
    const h1 = undo(h0);
    expect(h1).toBe(h0);
  });

  it('past shrinks by 1 each undo', () => {
    const h0 = createHistory(makeTree(makeNode('a')));
    const h1 = applyEdit(h0, setName('a', 'B'));
    const h2 = applyEdit(h1, setName('a', 'C'));
    const h3 = applyEdit(h2, setName('a', 'D'));
    expect(h3.past).toHaveLength(3);
    expect(undo(h3).past).toHaveLength(2);
    expect(undo(undo(h3)).past).toHaveLength(1);
  });

  it('canUndo returns false when past is empty', () => {
    const h0 = createHistory(makeTree(makeNode('a')));
    expect(canUndo(h0)).toBe(false);
    const h1 = applyEdit(h0, setName('a', 'B'));
    expect(canUndo(h1)).toBe(true);
    expect(canUndo(undo(h1))).toBe(false);
  });
});

// ─── redo ─────────────────────────────────────────────────────────────────

describe('redo', () => {
  it('pops the first future entry into present', () => {
    const h0 = createHistory(makeTree(makeNode('a')));
    const h1 = applyEdit(h0, setName('a', 'B'));
    const h2 = undo(h1);
    const h3 = redo(h2);
    expect(h3.present).toBe(h1.present);
  });

  it('pushes the prior present onto the end of past', () => {
    const h0 = createHistory(makeTree(makeNode('a')));
    const h1 = applyEdit(h0, setName('a', 'B'));
    const h2 = undo(h1);
    const h3 = redo(h2);
    expect(h3.past[h3.past.length - 1]).toBe(h0.present);
  });

  it('on empty future, returns the same state reference (no-op)', () => {
    const h0 = createHistory(makeTree(makeNode('a')));
    const r = redo(h0);
    expect(r).toBe(h0);
  });

  it('undo → redo → present is identical to before undo', () => {
    const h0 = createHistory(makeTree(makeNode('a')));
    const h1 = applyEdit(h0, setName('a', 'B'));
    const h2 = applyEdit(h1, setName('a', 'C'));
    const round = redo(undo(h2));
    expect(round.present).toBe(h2.present);
    expect(round.past.length).toBe(h2.past.length);
  });

  it('canRedo returns false when future is empty', () => {
    const h0 = createHistory(makeTree(makeNode('a')));
    expect(canRedo(h0)).toBe(false);
    const h1 = applyEdit(h0, setName('a', 'B'));
    expect(canRedo(h1)).toBe(false);
    expect(canRedo(undo(h1))).toBe(true);
    expect(canRedo(redo(undo(h1)))).toBe(false);
  });
});

// ─── maxHistory ───────────────────────────────────────────────────────────

describe('maxHistory eviction', () => {
  it('past length never exceeds maxHistory (oldest evicted)', () => {
    let h: HistoryState = createHistory(makeTree(makeNode('a')));
    for (let i = 0; i < 7; i++) {
      h = applyEdit(h, setName('a', `n${i}`), 3);
    }
    expect(h.past.length).toBe(3);
    // present is the 7th edit ("n6"); past should contain edits n3..n5
    expect(h.present.tree.nodes[0]!.name).toBe('n6');
    expect(h.past[0]!.tree.nodes[0]!.name).toBe('n3');
    expect(h.past[2]!.tree.nodes[0]!.name).toBe('n5');
  });

  it('default maxHistory is DEFAULT_MAX_HISTORY (50)', () => {
    expect(DEFAULT_MAX_HISTORY).toBe(50);
    let h: HistoryState = createHistory(makeTree(makeNode('a')));
    for (let i = 0; i < 60; i++) {
      h = applyEdit(h, setName('a', `n${i}`));
    }
    expect(h.past.length).toBe(50);
  });

  it('maxHistory=0 means past is always empty (each edit IS the present)', () => {
    let h: HistoryState = createHistory(makeTree(makeNode('a')));
    h = applyEdit(h, setName('a', 'B'), 0);
    h = applyEdit(h, setName('a', 'C'), 0);
    expect(h.past).toEqual([]);
    expect(canUndo(h)).toBe(false);
    expect(h.present.tree.nodes[0]!.name).toBe('C');
  });
});

// ─── stress: long sequences stay stable ───────────────────────────────────

describe('stress', () => {
  it('50+ sequential edits remain stable; undo walks all the way back', () => {
    let h: HistoryState = createHistory(makeTree(makeNode('a')));
    for (let i = 1; i <= 50; i++) {
      h = applyEdit(h, setDepth('a', i));
    }
    expect((h.present.tree.nodes[0]!.payload as ExtrudeFeature).depth).toBe(50);
    // undo all the way back
    let walked = h;
    for (let i = 49; i >= 1; i--) {
      walked = undo(walked);
      expect((walked.present.tree.nodes[0]!.payload as ExtrudeFeature).depth).toBe(i);
    }
    walked = undo(walked); // back to initial (depth=3)
    expect((walked.present.tree.nodes[0]!.payload as ExtrudeFeature).depth).toBe(3);
    expect(canUndo(walked)).toBe(false);
    expect(canRedo(walked)).toBe(true);
  });

  it('alternating undo/redo settles back to start state', () => {
    let h: HistoryState = createHistory(makeTree(makeNode('a')));
    h = applyEdit(h, setName('a', 'B'));
    h = applyEdit(h, setName('a', 'C'));
    h = applyEdit(h, setName('a', 'D'));
    // undo 2, redo 2 — present should equal post-3rd-edit state
    const before = h.present;
    h = redo(redo(undo(undo(h))));
    expect(h.present).toBe(before);
  });

  it('100 edits with maxHistory=10 keeps past bounded', () => {
    let h: HistoryState = createHistory(makeTree(makeNode('a')));
    for (let i = 0; i < 100; i++) {
      h = applyEdit(h, setName('a', `step${i}`), 10);
    }
    expect(h.past.length).toBe(10);
    expect(h.present.tree.nodes[0]!.name).toBe('step99');
  });

  it('undo then new edit invalidates redo chain — future is empty', () => {
    let h: HistoryState = createHistory(makeTree(makeNode('a')));
    h = applyEdit(h, setName('a', 'B'));
    h = applyEdit(h, setName('a', 'C'));
    h = applyEdit(h, setName('a', 'D'));
    h = undo(h); // present = "C", future = ["D"]
    h = undo(h); // present = "B", future = ["C", "D"]
    expect(h.future.length).toBe(2);
    h = applyEdit(h, setName('a', 'Z'));
    expect(h.future).toEqual([]);
    expect(canRedo(h)).toBe(false);
  });
});

// ─── structural edits go through history too ─────────────────────────────

describe('structural edits via history', () => {
  it('insert_node + remove_node flows through applyEdit', () => {
    const h0 = createHistory(makeTree(makeNode('a')));
    const h1 = applyEdit(h0, {
      type: 'insert_node',
      node: makeNode('b', ['a']),
    });
    expect(h1.present.tree.nodes).toHaveLength(2);
    const h2 = applyEdit(h1, { type: 'remove_node', nodeId: 'b' });
    expect(h2.present.tree.nodes).toHaveLength(1);
    // undo twice → back to original single-node tree
    const back = undo(undo(h2));
    expect(back.present.tree.nodes).toHaveLength(1);
    expect(back.present.tree.nodes[0]!.id).toBe('a');
  });

  it('move_node flows through history and is reversible', () => {
    const h0 = createHistory(makeTree(makeNode('a'), makeNode('b'), makeNode('c')));
    const h1 = applyEdit(h0, { type: 'move_node', nodeId: 'c', toIndex: 0 });
    expect(h1.present.tree.nodes[0]!.id).toBe('c');
    const back = undo(h1);
    expect(back.present.tree.nodes[0]!.id).toBe('a');
  });
});
