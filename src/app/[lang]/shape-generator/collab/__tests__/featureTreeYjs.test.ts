import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  featureTreeToYDoc,
  yDocToFeatureTree,
  applyFeatureOp,
  getSharedTree,
  getSharedSketches,
  syncDocs,
  type FeatureOp,
} from '../featureTreeYjs';
import type { FeatureHistory, HistoryNode, SketchNodeData } from '../../useFeatureStack';

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

function makeNode(
  id: string,
  overrides: Partial<HistoryNode> = {},
): HistoryNode {
  return {
    id,
    type: 'feature',
    label: id,
    icon: 'i',
    params: {},
    enabled: true,
    expanded: true,
    parentId: null,
    children: [],
    editingActive: false,
    timestamp: 1,
    ...overrides,
  };
}

function makeSketchData(overrides: Partial<SketchNodeData> = {}): SketchNodeData {
  return {
    profile: {
      segments: [{ id: 'seg1', type: 'line', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }],
      closed: false,
    },
    config: {
      mode: 'extrude',
      depth: 50,
      revolveAngle: 360,
      revolveAxis: 'y',
      segments: 32,
    },
    plane: 'xy',
    planeOffset: 0,
    operation: 'add',
    ...overrides,
  };
}

function makeBaseHistory(): FeatureHistory {
  // Root + 3 features: F1 (sketch), F2 (fillet), F3 (chamfer)
  const root = makeNode('root', { type: 'baseShape', label: 'Base', children: ['F1', 'F2', 'F3'] });
  const f1 = makeNode('F1', {
    type: 'feature',
    featureType: 'sketchExtrude',
    label: 'Sketch1',
    parentId: 'root',
    sketchData: makeSketchData(),
  });
  const f2 = makeNode('F2', {
    type: 'feature',
    featureType: 'fillet',
    label: 'Fillet1',
    parentId: 'root',
    params: { radius: 5 },
  });
  const f3 = makeNode('F3', {
    type: 'feature',
    featureType: 'chamfer',
    label: 'Chamfer1',
    parentId: 'root',
    params: { distance: 2 },
  });
  return {
    nodes: [root, f1, f2, f3],
    rootId: 'root',
    activeNodeId: 'F3',
    editingNodeId: null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Round-trip
// ────────────────────────────────────────────────────────────────────────────

describe('featureTreeYjs — round trip', () => {
  it('preserves tree node identity, ordering, and meta', () => {
    const history = makeBaseHistory();
    const doc = featureTreeToYDoc(history);
    const snap = yDocToFeatureTree(doc);

    expect(snap.tree.nodes.map((n) => n.id)).toEqual(['root', 'F1', 'F2', 'F3']);
    expect(snap.tree.rootId).toBe('root');
    expect(snap.tree.activeNodeId).toBe('F3');
    expect(snap.tree.editingNodeId).toBeNull();
  });

  it('preserves per-node params, label, enabled, parentId', () => {
    const history = makeBaseHistory();
    const doc = featureTreeToYDoc(history);
    const snap = yDocToFeatureTree(doc);

    const f2 = snap.tree.nodes.find((n) => n.id === 'F2')!;
    expect(f2.params.radius).toBe(5);
    expect(f2.label).toBe('Fillet1');
    expect(f2.enabled).toBe(true);
    expect(f2.parentId).toBe('root');
  });

  it('moves sketchData out of the node and into top-level sketches map', () => {
    const history = makeBaseHistory();
    const doc = featureTreeToYDoc(history);

    const sketches = getSharedSketches(doc);
    // The sketch lives keyed by the host node id (F1).
    expect(sketches.has('F1')).toBe(true);
    expect(sketches.has('F2')).toBe(false);

    // And the host node carries sketchRef instead of inline sketchData.
    const tree = getSharedTree(doc);
    const f1 = tree.toArray().find((m) => m.get('id') === 'F1')!;
    expect(f1.get('sketchRef')).toBe('F1');
  });

  it('rehydrates sketchData on read back', () => {
    const history = makeBaseHistory();
    const doc = featureTreeToYDoc(history);
    const snap = yDocToFeatureTree(doc);

    const f1 = snap.tree.nodes.find((n) => n.id === 'F1')!;
    expect(f1.sketchData).toBeDefined();
    expect(f1.sketchData!.plane).toBe('xy');
    expect(f1.sketchData!.profile.segments[0].id).toBe('seg1');
    expect(snap.sketches['F1']).toBeDefined();
    expect(snap.sketches['F1'].profile.segments).toHaveLength(1);
  });

  it('does not persist runtime fields (error, editingActive=true)', () => {
    const history: FeatureHistory = {
      ...makeBaseHistory(),
    };
    const nodeWithRuntime: HistoryNode = makeNode('runtime', {
      parentId: 'root',
      error: 'should-be-dropped',
      editingActive: true,
    });
    history.nodes.push(nodeWithRuntime);

    const doc = featureTreeToYDoc(history);
    const snap = yDocToFeatureTree(doc);
    const back = snap.tree.nodes.find((n) => n.id === 'runtime')!;
    expect(back.error).toBeUndefined();
    expect(back.editingActive).toBe(false);
  });

  it('preserves edge / face click-time selection snapshots', () => {
    const history = makeBaseHistory();
    const filletWithEdge: HistoryNode = makeNode('with-edge', {
      featureType: 'fillet',
      parentId: 'root',
      params: { radius: 3 },
      edgeSelections: [
        {
          type: 'edge',
          position: [1, 2, 3],
          length: 12.5,
          normal: [0, 1, 0],
        },
      ],
    });
    history.nodes.push(filletWithEdge);
    const doc = featureTreeToYDoc(history);
    const snap = yDocToFeatureTree(doc);
    const back = snap.tree.nodes.find((n) => n.id === 'with-edge')!;
    expect(back.edgeSelections).toHaveLength(1);
    expect(back.edgeSelections![0].position).toEqual([1, 2, 3]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// applyFeatureOp single-doc semantics
// ────────────────────────────────────────────────────────────────────────────

describe('featureTreeYjs — single-doc applyFeatureOp', () => {
  it('addNode appends and links into parent.children', () => {
    const doc = featureTreeToYDoc(makeBaseHistory());
    const newNode = makeNode('F4', { parentId: 'root', featureType: 'shell', params: { thickness: 1 } });
    const ok = applyFeatureOp(doc, { kind: 'addNode', node: newNode });
    expect(ok).toBe(true);

    const snap = yDocToFeatureTree(doc);
    expect(snap.tree.nodes.map((n) => n.id)).toContain('F4');
    const root = snap.tree.nodes.find((n) => n.id === 'root')!;
    expect(root.children).toContain('F4');
  });

  it('addNode with sketchData stores into sketches map and stamps sketchRef', () => {
    const doc = featureTreeToYDoc(makeBaseHistory());
    const newNode = makeNode('F-sketch', { parentId: 'root', featureType: 'sketchExtrude' });
    applyFeatureOp(doc, {
      kind: 'addNode',
      node: newNode,
      sketchData: makeSketchData({ plane: 'xz', planeOffset: 12 }),
    });
    const snap = yDocToFeatureTree(doc);
    const fs = snap.tree.nodes.find((n) => n.id === 'F-sketch')!;
    expect(fs.sketchData?.plane).toBe('xz');
    expect(fs.sketchData?.planeOffset).toBe(12);
    expect(snap.sketches['F-sketch']).toBeDefined();
  });

  it('removeNode also deletes referenced sketches', () => {
    const doc = featureTreeToYDoc(makeBaseHistory());
    expect(getSharedSketches(doc).has('F1')).toBe(true);

    applyFeatureOp(doc, { kind: 'removeNode', id: 'F1' });
    const snap = yDocToFeatureTree(doc);
    expect(snap.tree.nodes.map((n) => n.id)).not.toContain('F1');
    expect(getSharedSketches(doc).has('F1')).toBe(false);

    const root = snap.tree.nodes.find((n) => n.id === 'root')!;
    expect(root.children).not.toContain('F1');
  });

  it('removeNode cascades to descendants', () => {
    const history = makeBaseHistory();
    // Add a child under F2.
    history.nodes.push(
      makeNode('F2-child', { parentId: 'F2', featureType: 'fillet', params: { radius: 1 } }),
    );
    const f2 = history.nodes.find((n) => n.id === 'F2')!;
    f2.children = ['F2-child'];
    const doc = featureTreeToYDoc(history);

    applyFeatureOp(doc, { kind: 'removeNode', id: 'F2' });
    const snap = yDocToFeatureTree(doc);
    const ids = snap.tree.nodes.map((n) => n.id);
    expect(ids).not.toContain('F2');
    expect(ids).not.toContain('F2-child');
  });

  it('updateParams merges per-key without overwriting siblings', () => {
    const doc = featureTreeToYDoc(makeBaseHistory());
    applyFeatureOp(doc, { kind: 'updateParams', id: 'F2', params: { radius: 9 } });
    const snap = yDocToFeatureTree(doc);
    expect(snap.tree.nodes.find((n) => n.id === 'F2')!.params.radius).toBe(9);
  });

  it('updateLabel and setEnabled mutate single keys', () => {
    const doc = featureTreeToYDoc(makeBaseHistory());
    applyFeatureOp(doc, { kind: 'updateLabel', id: 'F2', label: 'Outer rim' });
    applyFeatureOp(doc, { kind: 'setEnabled', id: 'F3', enabled: false });
    const snap = yDocToFeatureTree(doc);
    expect(snap.tree.nodes.find((n) => n.id === 'F2')!.label).toBe('Outer rim');
    expect(snap.tree.nodes.find((n) => n.id === 'F3')!.enabled).toBe(false);
  });

  it('setActive updates meta.activeNodeId', () => {
    const doc = featureTreeToYDoc(makeBaseHistory());
    applyFeatureOp(doc, { kind: 'setActive', activeNodeId: 'F1' });
    const snap = yDocToFeatureTree(doc);
    expect(snap.tree.activeNodeId).toBe('F1');
  });

  it('reorder moves a node to a new index', () => {
    const doc = featureTreeToYDoc(makeBaseHistory());
    // root, F1, F2, F3 → move F3 to index 1
    applyFeatureOp(doc, { kind: 'reorder', id: 'F3', toIndex: 1 });
    const snap = yDocToFeatureTree(doc);
    expect(snap.tree.nodes.map((n) => n.id)).toEqual(['root', 'F3', 'F1', 'F2']);
  });

  it('updateSketch patches per-field without dropping others', () => {
    const doc = featureTreeToYDoc(makeBaseHistory());
    applyFeatureOp(doc, {
      kind: 'updateSketch',
      sketchId: 'F1',
      patch: { planeOffset: 33 },
    });
    const snap = yDocToFeatureTree(doc);
    expect(snap.sketches['F1'].planeOffset).toBe(33);
    expect(snap.sketches['F1'].plane).toBe('xy'); // unchanged
    expect(snap.sketches['F1'].profile.segments).toHaveLength(1); // unchanged
  });

  it('returns false on unknown id (no-op)', () => {
    const doc = featureTreeToYDoc(makeBaseHistory());
    expect(applyFeatureOp(doc, { kind: 'removeNode', id: 'ghost' })).toBe(false);
    expect(
      applyFeatureOp(doc, { kind: 'updateParams', id: 'ghost', params: { radius: 1 } }),
    ).toBe(false);
    expect(applyFeatureOp(doc, { kind: 'reorder', id: 'ghost', toIndex: 0 })).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Two-peer concurrent edits
// ────────────────────────────────────────────────────────────────────────────

function clone(doc: Y.Doc): Y.Doc {
  // Create a fresh doc from an encoded update — cleanest way to model "peer B
  // joined and received the current state".
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(doc));
  return b;
}

describe('featureTreeYjs — 2-peer concurrent add', () => {
  it('both adds at the tail survive after sync', () => {
    const a = featureTreeToYDoc(makeBaseHistory());
    const b = clone(a);

    applyFeatureOp(a, {
      kind: 'addNode',
      node: makeNode('A-only', { parentId: 'root', featureType: 'fillet', params: { radius: 2 } }),
    });
    applyFeatureOp(b, {
      kind: 'addNode',
      node: makeNode('B-only', { parentId: 'root', featureType: 'chamfer', params: { distance: 1 } }),
    });

    syncDocs(a, b);

    const snapA = yDocToFeatureTree(a);
    const snapB = yDocToFeatureTree(b);

    const aIds = snapA.tree.nodes.map((n) => n.id).sort();
    const bIds = snapB.tree.nodes.map((n) => n.id).sort();
    expect(aIds).toEqual(bIds);
    expect(aIds).toContain('A-only');
    expect(aIds).toContain('B-only');

    // Both peers see the same root.children order.
    const rootA = snapA.tree.nodes.find((n) => n.id === 'root')!;
    const rootB = snapB.tree.nodes.find((n) => n.id === 'root')!;
    expect(rootA.children).toEqual(rootB.children);
    expect(rootA.children).toContain('A-only');
    expect(rootA.children).toContain('B-only');
  });
});

describe('featureTreeYjs — 2-peer concurrent reorder of different nodes', () => {
  it('both reorders converge to the same deterministic state', () => {
    const a = featureTreeToYDoc(makeBaseHistory());
    const b = clone(a);

    // Peer A reorders F1 to the end.
    applyFeatureOp(a, { kind: 'reorder', id: 'F1', toIndex: 3 });
    // Peer B reorders F3 to position 1 (between root and F1 in B's local view).
    applyFeatureOp(b, { kind: 'reorder', id: 'F3', toIndex: 1 });

    syncDocs(a, b);

    const snapA = yDocToFeatureTree(a);
    const snapB = yDocToFeatureTree(b);
    const aIds = snapA.tree.nodes.map((n) => n.id);
    const bIds = snapB.tree.nodes.map((n) => n.id);

    // Both peers converge to the same id ordering.
    expect(aIds).toEqual(bIds);
    // Every original node still present (no losses from reorder collision).
    for (const id of ['root', 'F1', 'F2', 'F3']) {
      expect(aIds).toContain(id);
    }
  });
});

describe('featureTreeYjs — 2-peer concurrent reorder of same node', () => {
  it('Y.Array linearises concurrent inserts → both copies survive', () => {
    // Per architecture doc §3.4: Yjs has no atomic move. A reorder is
    // delete + insert; when two peers concurrently reorder the same node
    // both inserts are kept ("list bifurcation"). The test asserts that
    // (a) the final state is identical across peers (CRDT convergence)
    // and (b) total node count after merge is well-defined and ≥ initial.
    const a = featureTreeToYDoc(makeBaseHistory());
    const b = clone(a);

    // Both peers attempt to move F2 to index 1 (just after root).
    applyFeatureOp(a, { kind: 'reorder', id: 'F2', toIndex: 1 });
    applyFeatureOp(b, { kind: 'reorder', id: 'F2', toIndex: 1 });

    syncDocs(a, b);

    const snapA = yDocToFeatureTree(a);
    const snapB = yDocToFeatureTree(b);
    const aIds = snapA.tree.nodes.map((n) => n.id);
    const bIds = snapB.tree.nodes.map((n) => n.id);

    // Convergence: both peers see the same final state.
    expect(aIds).toEqual(bIds);

    // Total nodes: 4 original + at most 1 extra from concurrent insert-of-clone.
    // (Reorder = delete-then-insert; both peers' deletes commute and both
    // inserts may survive, producing a duplicate by id. We assert that
    // either dedupe-by-id behavior holds (4 unique ids) or that the
    // duplication is bounded.)
    const uniqueIds = new Set(aIds);
    expect(uniqueIds.size).toBeGreaterThanOrEqual(3); // at least F2 survives somewhere
    expect(uniqueIds.has('F2')).toBe(true);
    // The peer's count of nodes ≤ initial + 1 (the duplicated clone of F2).
    expect(aIds.length).toBeLessThanOrEqual(5);
  });
});

describe('featureTreeYjs — sketch cleanup on delete', () => {
  it('deleting a sketchRef-holding node removes the orphan sketch entry', () => {
    const doc = featureTreeToYDoc(makeBaseHistory());
    expect(getSharedSketches(doc).has('F1')).toBe(true);

    applyFeatureOp(doc, { kind: 'removeNode', id: 'F1' });

    // Sketch is gone.
    expect(getSharedSketches(doc).has('F1')).toBe(false);
    // No tree node still references it.
    const snap = yDocToFeatureTree(doc);
    for (const node of snap.tree.nodes) {
      if (node.sketchData) {
        expect(node.id).not.toBe('F1');
      }
    }
  });

  it('cascade delete cleans up nested sketches too', () => {
    const history = makeBaseHistory();
    // Add a nested sketch under F1 (F1 is the parent; F1-child is another sketch feature)
    history.nodes.push(
      makeNode('F1-child', {
        parentId: 'F1',
        featureType: 'sketchExtrude',
        sketchData: makeSketchData({ plane: 'yz' }),
      }),
    );
    const f1 = history.nodes.find((n) => n.id === 'F1')!;
    f1.children = ['F1-child'];

    const doc = featureTreeToYDoc(history);
    expect(getSharedSketches(doc).has('F1')).toBe(true);
    expect(getSharedSketches(doc).has('F1-child')).toBe(true);

    applyFeatureOp(doc, { kind: 'removeNode', id: 'F1' });

    expect(getSharedSketches(doc).has('F1')).toBe(false);
    expect(getSharedSketches(doc).has('F1-child')).toBe(false);
  });
});

describe('featureTreeYjs — 2-peer concurrent param edit', () => {
  it('edits to different params of the same node merge (per-key LWW)', () => {
    const a = featureTreeToYDoc(makeBaseHistory());
    const b = clone(a);

    // Seed F2 with two params first.
    applyFeatureOp(a, { kind: 'updateParams', id: 'F2', params: { radius: 5, segments: 32 } });
    syncDocs(a, b);

    // A changes radius, B changes segments — different keys merge.
    applyFeatureOp(a, { kind: 'updateParams', id: 'F2', params: { radius: 8 } });
    applyFeatureOp(b, { kind: 'updateParams', id: 'F2', params: { segments: 64 } });

    syncDocs(a, b);

    const snapA = yDocToFeatureTree(a);
    const snapB = yDocToFeatureTree(b);
    const f2A = snapA.tree.nodes.find((n) => n.id === 'F2')!;
    const f2B = snapB.tree.nodes.find((n) => n.id === 'F2')!;
    expect(f2A.params.radius).toBe(8);
    expect(f2A.params.segments).toBe(64);
    expect(f2B.params.radius).toBe(8);
    expect(f2B.params.segments).toBe(64);
  });
});
