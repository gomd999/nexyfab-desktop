/**
 * FeatureTreeStore.test.ts — Wave 2 Phase 3 Track Z3 adapter cases.
 *
 *  - Local mode mirrors pure tree state
 *  - Yjs mode roundtrips through the Y.Doc
 *  - migrateToYjs preserves all nodes + meta
 *  - Switching modes mid-session doesn't lose data
 *  - Subscribe / unsubscribe lifecycle
 *  - Concurrent CRDT semantics (addNode merge, reorder collisions,
 *    per-key params LWW)
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  FeatureTreeStore,
  migrateToYjs,
  type FeatureTreeStore as TFeatureTreeStore,
} from '../FeatureTreeStore';
import type { HistoryNode, SketchNodeData } from '../../useFeatureStack';
import { yDocToFeatureTree } from '../../collab/featureTreeYjs';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeNode(id: string, overrides: Partial<HistoryNode> = {}): HistoryNode {
  return {
    id,
    type: 'feature',
    label: id,
    icon: '🔧',
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
    profile: { segments: [], closed: false },
    config: { mode: 'extrude', depth: 50, revolveAngle: 360, revolveAxis: 'y', segments: 32 },
    plane: 'xy',
    planeOffset: 0,
    operation: 'add',
    ...overrides,
  };
}

/** Helper — bootstrap a local store seeded with root + one feature for
 *  composition-test scenarios. */
function seededLocal(): { store: TFeatureTreeStore; rootId: string } {
  const store = FeatureTreeStore.local();
  const rootId = store.getRootId();
  store.addNode(
    makeNode('F1', { parentId: rootId, label: 'Fillet1', featureType: 'fillet', params: { radius: 5 } }),
  );
  return { store, rootId };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Local mode — basic state mirroring
// ═══════════════════════════════════════════════════════════════════════════

describe('FeatureTreeStore.local — basic state mirroring', () => {
  it('mode is "local"', () => {
    const s = FeatureTreeStore.local();
    expect(s.mode).toBe('local');
  });

  it('bootstraps with a single root baseShape node', () => {
    const s = FeatureTreeStore.local();
    const nodes = s.getNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.type).toBe('baseShape');
    expect(s.getActiveNodeId()).toBe(s.getRootId());
    expect(s.getEditingNodeId()).toBeNull();
  });

  it('addNode appends as child of parent and notifies', () => {
    const s = FeatureTreeStore.local();
    const rootId = s.getRootId();
    let count = 0;
    s.subscribe(() => { count += 1; });
    s.addNode(makeNode('F1', { parentId: rootId }));
    expect(s.getNodes().map(n => n.id)).toEqual([rootId, 'F1']);
    expect(count).toBe(1);
  });

  it('addNode with sketchData stores sketches keyed by node.id', () => {
    const s = FeatureTreeStore.local();
    const rootId = s.getRootId();
    s.addNode(
      makeNode('S1', { parentId: rootId, featureType: 'sketchExtrude' }),
      makeSketchData({ planeOffset: 10 }),
    );
    expect(s.getSketches()['S1']!.planeOffset).toBe(10);
  });

  it('addNode replaces on same id (LWW)', () => {
    const s = FeatureTreeStore.local();
    const rootId = s.getRootId();
    s.addNode(makeNode('F1', { parentId: rootId, label: 'first' }));
    s.addNode(makeNode('F1', { parentId: rootId, label: 'second' }));
    const f1 = s.getNodes().find(n => n.id === 'F1')!;
    expect(f1.label).toBe('second');
    // parent's children list should still have F1 exactly once
    const root = s.getNodes().find(n => n.id === rootId)!;
    expect(root.children.filter(c => c === 'F1')).toHaveLength(1);
  });

  it('addNode with afterId inserts at the right position in parent.children', () => {
    const s = FeatureTreeStore.local();
    const rootId = s.getRootId();
    s.addNode(makeNode('A', { parentId: rootId }));
    s.addNode(makeNode('B', { parentId: rootId }));
    s.addNode(makeNode('C', { parentId: rootId }), undefined, 'A');
    const root = s.getNodes().find(n => n.id === rootId)!;
    expect(root.children).toEqual(['A', 'C', 'B']);
  });

  it('removeNode drops the node and its descendants', () => {
    const s = FeatureTreeStore.local();
    const rootId = s.getRootId();
    s.addNode(makeNode('P', { parentId: rootId }));
    s.addNode(makeNode('C1', { parentId: 'P' }));
    s.addNode(makeNode('C2', { parentId: 'P' }));
    s.removeNode('P');
    expect(s.getNodes().map(n => n.id).sort()).toEqual([rootId].sort());
  });

  it('removeNode on root is a no-op', () => {
    const s = FeatureTreeStore.local();
    const rootId = s.getRootId();
    s.removeNode(rootId);
    expect(s.getRootId()).toBe(rootId);
    expect(s.getNodes()).toHaveLength(1);
  });

  it('removeNode rolls back activeNodeId to parent when active was inside subtree', () => {
    const s = FeatureTreeStore.local();
    const rootId = s.getRootId();
    s.addNode(makeNode('F1', { parentId: rootId }));
    s.setActive('F1');
    s.removeNode('F1');
    expect(s.getActiveNodeId()).toBe(rootId);
  });

  it('reorder swaps sibling positions', () => {
    const { store, rootId } = seededLocal();
    store.addNode(makeNode('F2', { parentId: rootId }));
    store.addNode(makeNode('F3', { parentId: rootId }));
    store.reorder('F3', 0);
    const root = store.getNodes().find(n => n.id === rootId)!;
    expect(root.children).toEqual(['F3', 'F1', 'F2']);
  });

  it('updateParams merges per-key', () => {
    const { store } = seededLocal();
    store.updateParams('F1', { thickness: 3 });
    const f1 = store.getNodes().find(n => n.id === 'F1')!;
    expect(f1.params).toEqual({ radius: 5, thickness: 3 });
  });

  it('updateLabel changes the label', () => {
    const { store } = seededLocal();
    store.updateLabel('F1', 'Fillet-renamed');
    expect(store.getNodes().find(n => n.id === 'F1')!.label).toBe('Fillet-renamed');
  });

  it('setEnabled toggles enabled', () => {
    const { store } = seededLocal();
    store.setEnabled('F1', false);
    expect(store.getNodes().find(n => n.id === 'F1')!.enabled).toBe(false);
  });

  it('setActive updates activeNodeId', () => {
    const { store } = seededLocal();
    store.setActive('F1');
    expect(store.getActiveNodeId()).toBe('F1');
  });

  it('updateSketch patches sketches map', () => {
    const s = FeatureTreeStore.local();
    const rootId = s.getRootId();
    s.addNode(
      makeNode('S1', { parentId: rootId, featureType: 'sketchExtrude' }),
      makeSketchData({ planeOffset: 0 }),
    );
    s.updateSketch('S1', { planeOffset: 99 });
    expect(s.getSketches()['S1']!.planeOffset).toBe(99);
  });

  it('setEditingNodeId stays local (no doc write)', () => {
    const { store } = seededLocal();
    store.setEditingNodeId('F1');
    expect(store.getEditingNodeId()).toBe('F1');
    store.setEditingNodeId(null);
    expect(store.getEditingNodeId()).toBeNull();
  });

  it('subscribe/unsubscribe lifecycle', () => {
    const s = FeatureTreeStore.local();
    const rootId = s.getRootId();
    let count = 0;
    const unsub = s.subscribe(() => { count += 1; });
    s.addNode(makeNode('F1', { parentId: rootId }));
    s.addNode(makeNode('F2', { parentId: rootId }));
    expect(count).toBe(2);
    unsub();
    s.addNode(makeNode('F3', { parentId: rootId }));
    expect(count).toBe(2);
  });

  it('destroy clears listeners', () => {
    const s = FeatureTreeStore.local();
    const rootId = s.getRootId();
    let count = 0;
    s.subscribe(() => { count += 1; });
    s.destroy();
    s.addNode(makeNode('F1', { parentId: rootId }));
    expect(count).toBe(0);
  });

  it('addNode without id throws', () => {
    const s = FeatureTreeStore.local();
    expect(() => s.addNode(makeNode(''))).toThrowError(/requires node.id/);
  });

  it('getSnapshot returns defensive copies (mutations don\'t leak)', () => {
    const { store } = seededLocal();
    const snap = store.getSnapshot();
    snap.tree.nodes[0]!.label = 'mutated';
    expect(store.getNodes()[0]!.label).not.toBe('mutated');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Yjs mode — roundtrips through the doc
// ═══════════════════════════════════════════════════════════════════════════

describe('FeatureTreeStore.fromYDoc — Yjs mode roundtrips', () => {
  it('mode is "yjs"', () => {
    const doc = new Y.Doc();
    const s = FeatureTreeStore.fromYDoc(doc);
    expect(s.mode).toBe('yjs');
  });

  it('bootstraps an empty doc with a root node', () => {
    const doc = new Y.Doc();
    const s = FeatureTreeStore.fromYDoc(doc);
    expect(s.getNodes()).toHaveLength(1);
    expect(s.getNodes()[0]!.type).toBe('baseShape');
  });

  it('addNode lands in the doc tree array', () => {
    const doc = new Y.Doc();
    const s = FeatureTreeStore.fromYDoc(doc);
    const rootId = s.getRootId();
    s.addNode(makeNode('F1', { parentId: rootId }));
    const snap = yDocToFeatureTree(doc);
    expect(snap.tree.nodes.map(n => n.id)).toContain('F1');
  });

  it('addNode with sketchData populates sketches map', () => {
    const doc = new Y.Doc();
    const s = FeatureTreeStore.fromYDoc(doc);
    const rootId = s.getRootId();
    s.addNode(
      makeNode('S1', { parentId: rootId, featureType: 'sketchExtrude' }),
      makeSketchData({ planeOffset: 42 }),
    );
    expect(yDocToFeatureTree(doc).sketches['S1']!.planeOffset).toBe(42);
  });

  it('removeNode + descendants cascade', () => {
    const doc = new Y.Doc();
    const s = FeatureTreeStore.fromYDoc(doc);
    const rootId = s.getRootId();
    s.addNode(makeNode('P', { parentId: rootId }));
    s.addNode(makeNode('C1', { parentId: 'P' }));
    s.removeNode('P');
    const ids = yDocToFeatureTree(doc).tree.nodes.map(n => n.id);
    expect(ids).not.toContain('P');
    expect(ids).not.toContain('C1');
  });

  it('updateParams patches per-key', () => {
    const doc = new Y.Doc();
    const s = FeatureTreeStore.fromYDoc(doc);
    const rootId = s.getRootId();
    s.addNode(makeNode('F1', { parentId: rootId, params: { radius: 5 } }));
    s.updateParams('F1', { thickness: 3 });
    const f1 = yDocToFeatureTree(doc).tree.nodes.find(n => n.id === 'F1')!;
    expect(f1.params.radius).toBe(5);
    expect(f1.params.thickness).toBe(3);
  });

  it('updateLabel propagates', () => {
    const doc = new Y.Doc();
    const s = FeatureTreeStore.fromYDoc(doc);
    const rootId = s.getRootId();
    s.addNode(makeNode('F1', { parentId: rootId, label: 'old' }));
    s.updateLabel('F1', 'new');
    expect(yDocToFeatureTree(doc).tree.nodes.find(n => n.id === 'F1')!.label).toBe('new');
  });

  it('setEnabled persists', () => {
    const doc = new Y.Doc();
    const s = FeatureTreeStore.fromYDoc(doc);
    const rootId = s.getRootId();
    s.addNode(makeNode('F1', { parentId: rootId }));
    s.setEnabled('F1', false);
    expect(yDocToFeatureTree(doc).tree.nodes.find(n => n.id === 'F1')!.enabled).toBe(false);
  });

  it('setActive writes treeMeta.activeNodeId', () => {
    const doc = new Y.Doc();
    const s = FeatureTreeStore.fromYDoc(doc);
    const rootId = s.getRootId();
    s.addNode(makeNode('F1', { parentId: rootId }));
    s.setActive('F1');
    expect(yDocToFeatureTree(doc).tree.activeNodeId).toBe('F1');
  });

  it('updateSketch patches the sketches map entry', () => {
    const doc = new Y.Doc();
    const s = FeatureTreeStore.fromYDoc(doc);
    const rootId = s.getRootId();
    s.addNode(
      makeNode('S1', { parentId: rootId, featureType: 'sketchExtrude' }),
      makeSketchData({ planeOffset: 0 }),
    );
    s.updateSketch('S1', { planeOffset: 77 });
    expect(yDocToFeatureTree(doc).sketches['S1']!.planeOffset).toBe(77);
  });

  it('editingNodeId is per-peer local — NOT written to the doc', () => {
    const doc = new Y.Doc();
    const s = FeatureTreeStore.fromYDoc(doc);
    const rootId = s.getRootId();
    s.addNode(makeNode('F1', { parentId: rootId }));
    s.setEditingNodeId('F1');
    expect(s.getEditingNodeId()).toBe('F1');
    // Doc-level meta should NOT be touched by the local editing pointer.
    expect(yDocToFeatureTree(doc).tree.editingNodeId).toBeNull();
  });

  it('subscribe fires on doc updates', () => {
    const doc = new Y.Doc();
    const s = FeatureTreeStore.fromYDoc(doc);
    const rootId = s.getRootId();
    let count = 0;
    s.subscribe(() => { count += 1; });
    s.addNode(makeNode('F1', { parentId: rootId }));
    expect(count).toBeGreaterThan(0);
  });

  it('destroy detaches the doc observer', () => {
    const doc = new Y.Doc();
    const s = FeatureTreeStore.fromYDoc(doc);
    const rootId = s.getRootId();
    let count = 0;
    s.subscribe(() => { count += 1; });
    s.destroy();
    s.addNode(makeNode('F1', { parentId: rootId })); // still applies on doc, but no notify
    expect(count).toBe(0);
  });

  it('getDoc returns the wrapped Y.Doc', () => {
    const doc = new Y.Doc();
    const s = FeatureTreeStore.fromYDoc(doc);
    expect(s.getDoc?.()).toBe(doc);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. migrateToYjs — local → yjs hot-swap
// ═══════════════════════════════════════════════════════════════════════════

describe('migrateToYjs — preserves local state', () => {
  it('moves nodes + sketches + meta into the doc', () => {
    const local = FeatureTreeStore.local();
    const rootId = local.getRootId();
    local.addNode(makeNode('F1', { parentId: rootId, params: { radius: 7 } }));
    local.addNode(
      makeNode('S1', { parentId: rootId, featureType: 'sketchExtrude' }),
      makeSketchData({ planeOffset: 11 }),
    );
    local.setActive('F1');

    const doc = new Y.Doc();
    const yjs = migrateToYjs(local, doc);
    expect(yjs.mode).toBe('yjs');

    const snap = yDocToFeatureTree(doc);
    expect(snap.tree.nodes.map(n => n.id)).toEqual(expect.arrayContaining([rootId, 'F1', 'S1']));
    expect(snap.tree.activeNodeId).toBe('F1');
    expect(snap.sketches['S1']!.planeOffset).toBe(11);
  });

  it('throws when source store is already in yjs mode', () => {
    const doc = new Y.Doc();
    const yjs = FeatureTreeStore.fromYDoc(doc);
    expect(() => migrateToYjs(yjs, new Y.Doc())).toThrowError(/local mode/);
  });

  it('migrating an empty local store yields an empty yjs store', () => {
    const local = FeatureTreeStore.local();
    const localRootId = local.getRootId();
    const doc = new Y.Doc();
    const yjs = migrateToYjs(local, doc);
    expect(yjs.getNodes()).toHaveLength(1);
    expect(yjs.getRootId()).toBe(localRootId);
  });

  it('switching modes mid-session does not lose data', () => {
    const local = FeatureTreeStore.local();
    const rootId = local.getRootId();
    local.addNode(makeNode('F1', { parentId: rootId, label: 'pre-migrate' }));

    const doc = new Y.Doc();
    const yjs = migrateToYjs(local, doc);

    expect(yjs.getNodes().find(n => n.id === 'F1')!.label).toBe('pre-migrate');

    // New writes through Yjs land in the doc.
    yjs.addNode(makeNode('F2', { parentId: rootId, label: 'post-migrate' }));
    expect(yDocToFeatureTree(doc).tree.nodes.map(n => n.id)).toContain('F2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Concurrent CRDT semantics
// ═══════════════════════════════════════════════════════════════════════════

describe('FeatureTreeStore — concurrent merge semantics', () => {
  /** Helper: bidirectional sync of two docs (mirrors the smoke harness). */
  function sync(a: Y.Doc, b: Y.Doc): void {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  }

  it('concurrent addNode by two peers — both nodes survive (per Z2 case #2)', () => {
    // One creator pattern: A bootstraps, B joins via initial sync.
    const docA = new Y.Doc();
    const a = FeatureTreeStore.fromYDoc(docA);
    const rootId = a.getRootId();
    Y.applyUpdate(new Y.Doc(), Y.encodeStateAsUpdate(docA)); // exercise encode
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const b = FeatureTreeStore.fromYDoc(docB);

    a.addNode(makeNode('Fa', { parentId: rootId, label: 'from-A' }));
    b.addNode(makeNode('Fb', { parentId: rootId, label: 'from-B' }));

    sync(docA, docB);

    const idsA = a.getNodes().map(n => n.id).sort();
    const idsB = b.getNodes().map(n => n.id).sort();
    expect(idsA).toEqual(idsB);
    expect(idsA).toContain('Fa');
    expect(idsA).toContain('Fb');
  });

  it('concurrent updateParams on disjoint keys merges per-key (flat key topology)', () => {
    const docA = new Y.Doc();
    const a = FeatureTreeStore.fromYDoc(docA);
    const rootId = a.getRootId();
    a.addNode(makeNode('F1', { parentId: rootId, params: { radius: 5 } }));

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const b = FeatureTreeStore.fromYDoc(docB);

    a.updateParams('F1', { thickness: 3 });
    b.updateParams('F1', { angle: 30 });

    sync(docA, docB);

    const fa = a.getNodes().find(n => n.id === 'F1')!;
    const fb = b.getNodes().find(n => n.id === 'F1')!;
    expect(fa.params).toEqual(fb.params);
    expect(fa.params.thickness).toBe(3);
    expect(fa.params.angle).toBe(30);
    expect(fa.params.radius).toBe(5); // unchanged base
  });

  it('concurrent updateParams on SAME key — LWW resolves (both converge to one value)', () => {
    const docA = new Y.Doc();
    const a = FeatureTreeStore.fromYDoc(docA);
    const rootId = a.getRootId();
    a.addNode(makeNode('F1', { parentId: rootId, params: { radius: 5 } }));

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const b = FeatureTreeStore.fromYDoc(docB);

    a.updateParams('F1', { radius: 99 });
    b.updateParams('F1', { radius: 11 });

    sync(docA, docB);
    const ra = a.getNodes().find(n => n.id === 'F1')!.params.radius;
    const rb = b.getNodes().find(n => n.id === 'F1')!.params.radius;
    expect(ra).toBe(rb); // LWW convergence (deterministic per Yjs clientID order)
  });

  it('concurrent reorder of the same node converges deterministically', () => {
    // Z3 reorder is delete + insert; concurrent reorders of same id may
    // produce two clones in the intermediate state. We assert convergence
    // (both docs end up with the same final layout), not which order wins.
    const docA = new Y.Doc();
    const a = FeatureTreeStore.fromYDoc(docA);
    const rootId = a.getRootId();
    a.addNode(makeNode('F1', { parentId: rootId }));
    a.addNode(makeNode('F2', { parentId: rootId }));
    a.addNode(makeNode('F3', { parentId: rootId }));

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const b = FeatureTreeStore.fromYDoc(docB);

    a.reorder('F1', 2);
    b.reorder('F1', 1);

    sync(docA, docB);

    const idsA = a.getNodes().map(n => n.id);
    const idsB = b.getNodes().map(n => n.id);
    expect(idsA).toEqual(idsB);
    // Whatever the final order is, F1/F2/F3 all still present (convergence
    // doesn't mean we kept the user's intent — that's the LWW collision
    // signal the toast surfaces in the host layer).
    expect(idsA).toEqual(expect.arrayContaining(['F1', 'F2', 'F3']));
  });

  it('concurrent setEnabled on same node — LWW resolves', () => {
    const docA = new Y.Doc();
    const a = FeatureTreeStore.fromYDoc(docA);
    const rootId = a.getRootId();
    a.addNode(makeNode('F1', { parentId: rootId, enabled: true }));

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const b = FeatureTreeStore.fromYDoc(docB);

    a.setEnabled('F1', false);
    b.setEnabled('F1', true);

    sync(docA, docB);
    const ea = a.getNodes().find(n => n.id === 'F1')!.enabled;
    const eb = b.getNodes().find(n => n.id === 'F1')!.enabled;
    expect(ea).toBe(eb);
  });

  it('concurrent operations preserve dependencies (sketch → extrude reference)', () => {
    // Sketch reference is by id on the node; even under concurrent reordering
    // / param edits, the sketches map entry under that id stays addressable.
    const docA = new Y.Doc();
    const a = FeatureTreeStore.fromYDoc(docA);
    const rootId = a.getRootId();
    a.addNode(
      makeNode('S1', { parentId: rootId, featureType: 'sketchExtrude' }),
      makeSketchData({ planeOffset: 0 }),
    );
    a.addNode(makeNode('F1', { parentId: rootId }));

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const b = FeatureTreeStore.fromYDoc(docB);

    // A edits sketch metadata; B reorders the extrude downstream.
    a.updateSketch('S1', { planeOffset: 50 });
    b.reorder('F1', 0);

    sync(docA, docB);

    const snapA = a.getSnapshot();
    const snapB = b.getSnapshot();
    expect(snapA.sketches['S1']!.planeOffset).toBe(50);
    expect(snapB.sketches['S1']!.planeOffset).toBe(50);
    // S1 still present in tree
    expect(snapA.tree.nodes.map(n => n.id)).toContain('S1');
    expect(snapB.tree.nodes.map(n => n.id)).toContain('S1');
  });
});
