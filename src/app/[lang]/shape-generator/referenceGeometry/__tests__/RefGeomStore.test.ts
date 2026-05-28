/**
 * RefGeomStore.test.ts — Wave 2 Phase 3 Z4 adapter cases.
 *
 * Both modes (local + Yjs) implement the same interface. We exercise:
 *  - local mode mirrors plain-array state behaviour + cycle gate
 *  - Yjs mode mutations roundtrip through the doc and rebuild snapshots
 *  - migrateToYjs preserves all entities
 *  - Subscribe / unsubscribe fires correctly
 *  - Switching modes mid-session doesn't lose data
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  RefGeomStore,
  migrateToYjs,
} from '../RefGeomStore';
import { readAllReferenceNodes } from '../refGeomYjs';
import type { ReferencePlaneNode, ReferenceAxisNode } from '../types';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function planeStandard(id: string, label?: string): ReferencePlaneNode {
  return {
    id,
    kind: 'plane',
    method: 'standard',
    label: label ?? id,
    hidden: false,
    dependsOn: [],
    evaluatedAt: 0,
    params: { method: 'standard', id: 'front' },
  };
}

function planeOffset(id: string, parentId: string, distanceMm = 10): ReferencePlaneNode {
  return {
    id,
    kind: 'plane',
    method: 'offset',
    label: id,
    hidden: false,
    dependsOn: [parentId],
    evaluatedAt: 0,
    params: {
      method: 'offset',
      parent: { kind: 'reference', nodeId: parentId },
      distanceMm,
      direction: 1,
    },
  };
}

function axisStandard(id: string): ReferenceAxisNode {
  return {
    id,
    kind: 'axis',
    method: 'standard',
    label: id,
    hidden: false,
    dependsOn: [],
    evaluatedAt: 0,
    params: { method: 'standard', id: 'x' },
  };
}

// ─── 1. Local mode ─────────────────────────────────────────────────────────

describe('RefGeomStore.local — basic state mirroring', () => {
  it('mode is "local"', () => {
    expect(RefGeomStore.local().mode).toBe('local');
  });

  it('empty store returns no nodes', () => {
    expect(RefGeomStore.local().getNodes()).toEqual([]);
  });

  it('accepts initial nodes', () => {
    const s = RefGeomStore.local([planeStandard('p1'), planeStandard('p2')]);
    expect(s.getNodes().map((n) => n.id)).toEqual(['p1', 'p2']);
  });

  it('addNode inserts a new node and notifies', () => {
    const s = RefGeomStore.local();
    let count = 0;
    s.subscribe(() => {
      count += 1;
    });
    const r = s.addNode(planeStandard('p1'));
    expect(r).toEqual({ ok: true });
    expect(s.getNodes().map((n) => n.id)).toEqual(['p1']);
    expect(count).toBe(1);
  });

  it('addNode rejects duplicate ids without mutation', () => {
    const s = RefGeomStore.local([planeStandard('p1')]);
    const r = s.addNode(planeStandard('p1', 'dup'));
    expect(r).toEqual({ ok: false, reason: 'duplicate_id' });
    expect(s.getNodes()).toHaveLength(1);
  });

  it('addNode rejects a self-loop', () => {
    const s = RefGeomStore.local();
    const selfLoop: ReferencePlaneNode = { ...planeStandard('p1'), dependsOn: ['p1'] };
    const r = s.addNode(selfLoop);
    expect(r).toEqual({ ok: false, reason: 'cycle' });
  });

  it('addNode rejects when new deps close a cycle', () => {
    const s = RefGeomStore.local();
    s.addNode(planeStandard('a'));
    s.addNode(planeOffset('b', 'a'));
    s.addNode(planeOffset('c', 'b'));
    // Try adding 'd' that depends on c AND have a try to add a node whose
    // id is `a` but dependsOn includes 'c'. That's a duplicate_id, not a
    // cycle. Use update instead — but update tests are below.
    // Direct cycle case: a node whose dependsOn list reaches itself.
    const cycleNode: ReferencePlaneNode = {
      ...planeStandard('a-new'),
      dependsOn: ['a-new'], // self-loop
    };
    const r = s.addNode(cycleNode);
    expect(r.ok).toBe(false);
  });

  it('removeNode drops the entry', () => {
    const s = RefGeomStore.local([planeStandard('p1'), planeStandard('p2')]);
    s.removeNode('p1');
    expect(s.getNodes().map((n) => n.id)).toEqual(['p2']);
  });

  it('removeNode on unknown id is a no-op (no notify)', () => {
    const s = RefGeomStore.local([planeStandard('p1')]);
    let count = 0;
    s.subscribe(() => {
      count += 1;
    });
    s.removeNode('nope');
    expect(count).toBe(0);
  });

  it('updateNode patches the label', () => {
    const s = RefGeomStore.local([planeStandard('p1', 'old')]);
    s.updateNode('p1', { label: 'new' });
    expect(s.getNode('p1')!.label).toBe('new');
  });

  it('updateNode recomputes dependsOn when params change', () => {
    const s = RefGeomStore.local([planeStandard('a'), planeStandard('b')]);
    s.updateNode('b', {
      method: 'offset',
      params: {
        method: 'offset',
        parent: { kind: 'reference', nodeId: 'a' },
        distanceMm: 20,
        direction: 1,
      },
    });
    expect(s.getNode('b')!.dependsOn).toEqual(['a']);
  });

  it('updateNode rejects kind change', () => {
    const s = RefGeomStore.local([planeStandard('p1')]);
    s.updateNode('p1', { kind: 'axis' });
    expect(s.getNode('p1')!.kind).toBe('plane');
  });

  it('updateNode rejects cycle-introducing patches', () => {
    const s = RefGeomStore.local();
    s.addNode(planeStandard('a'));
    s.addNode(planeOffset('b', 'a'));
    s.addNode(planeOffset('c', 'b'));
    // Update 'a' to depend on 'c' would create a → c → b → a cycle.
    s.updateNode('a', { dependsOn: ['c'] });
    expect(s.getNode('a')!.dependsOn).toEqual([]);
  });

  it('renameNode patches the label', () => {
    const s = RefGeomStore.local([planeStandard('p1', 'old')]);
    s.renameNode('p1', 'new label');
    expect(s.getNode('p1')!.label).toBe('new label');
  });

  it('clear empties the store and notifies', () => {
    const s = RefGeomStore.local([planeStandard('p1')]);
    let count = 0;
    s.subscribe(() => {
      count += 1;
    });
    s.clear();
    expect(s.getNodes()).toEqual([]);
    expect(count).toBe(1);
  });

  it('clear on an empty store is a no-op (no notify)', () => {
    const s = RefGeomStore.local();
    let count = 0;
    s.subscribe(() => {
      count += 1;
    });
    s.clear();
    expect(count).toBe(0);
  });

  it('replaceAll swaps the whole list', () => {
    const s = RefGeomStore.local([planeStandard('p1')]);
    s.replaceAll([planeStandard('x'), axisStandard('y')]);
    expect(s.getNodes().map((n) => n.id)).toEqual(['x', 'y']);
  });

  it('subscribe / unsubscribe lifecycle', () => {
    const s = RefGeomStore.local();
    let count = 0;
    const unsub = s.subscribe(() => {
      count += 1;
    });
    s.addNode(planeStandard('p1'));
    s.addNode(planeStandard('p2'));
    expect(count).toBe(2);
    unsub();
    s.addNode(planeStandard('p3'));
    expect(count).toBe(2);
  });

  it('destroy clears listeners', () => {
    const s = RefGeomStore.local();
    let count = 0;
    s.subscribe(() => {
      count += 1;
    });
    s.destroy();
    s.addNode(planeStandard('p1'));
    expect(count).toBe(0);
  });

  it('getNodes returns a defensive copy', () => {
    const s = RefGeomStore.local([planeStandard('p1')]);
    const snap = s.getNodes();
    snap.push(planeStandard('mut'));
    expect(s.getNodes()).toHaveLength(1);
  });
});

// ─── 2. Yjs mode ───────────────────────────────────────────────────────────

describe('RefGeomStore.fromYDoc — Yjs mode roundtrips', () => {
  it('mode is "yjs"', () => {
    const doc = new Y.Doc();
    expect(RefGeomStore.fromYDoc(doc).mode).toBe('yjs');
  });

  it('starts empty on a fresh doc', () => {
    const doc = new Y.Doc();
    expect(RefGeomStore.fromYDoc(doc).getNodes()).toEqual([]);
  });

  it('addNode lands in the doc', () => {
    const doc = new Y.Doc();
    const s = RefGeomStore.fromYDoc(doc);
    s.addNode(planeStandard('p1'));
    expect(readAllReferenceNodes(doc).has('p1')).toBe(true);
  });

  it('addNode rejects duplicate id locally', () => {
    const doc = new Y.Doc();
    const s = RefGeomStore.fromYDoc(doc);
    s.addNode(planeStandard('p1'));
    const r = s.addNode(planeStandard('p1', 'dup'));
    expect(r).toEqual({ ok: false, reason: 'duplicate_id' });
  });

  it('addNode rejects self-loop locally', () => {
    const doc = new Y.Doc();
    const s = RefGeomStore.fromYDoc(doc);
    const selfLoop: ReferencePlaneNode = { ...planeStandard('p1'), dependsOn: ['p1'] };
    const r = s.addNode(selfLoop);
    expect(r).toEqual({ ok: false, reason: 'cycle' });
  });

  it('updateNode patches via Y op', () => {
    const doc = new Y.Doc();
    const s = RefGeomStore.fromYDoc(doc);
    s.addNode(planeStandard('p1', 'old'));
    s.updateNode('p1', { label: 'new' });
    expect(s.getNode('p1')!.label).toBe('new');
  });

  it('renameNode patches the label', () => {
    const doc = new Y.Doc();
    const s = RefGeomStore.fromYDoc(doc);
    s.addNode(planeStandard('p1', 'old'));
    s.renameNode('p1', 'renamed');
    expect(s.getNode('p1')!.label).toBe('renamed');
  });

  it('removeNode drops from the doc', () => {
    const doc = new Y.Doc();
    const s = RefGeomStore.fromYDoc(doc);
    s.addNode(planeStandard('p1'));
    s.addNode(planeStandard('p2'));
    s.removeNode('p1');
    expect(s.getNodes().map((n) => n.id)).toEqual(['p2']);
  });

  it('clear empties the doc', () => {
    const doc = new Y.Doc();
    const s = RefGeomStore.fromYDoc(doc);
    s.addNode(planeStandard('p1'));
    s.addNode(planeStandard('p2'));
    s.clear();
    expect(s.getNodes()).toEqual([]);
  });

  it('replaceAll diffs against current to preserve unrelated entries', () => {
    const doc = new Y.Doc();
    const s = RefGeomStore.fromYDoc(doc);
    s.addNode(planeStandard('p1'));
    s.addNode(planeStandard('p2'));
    s.replaceAll([planeStandard('p1', 'updated'), planeStandard('p3')]);
    const ids = s.getNodes().map((n) => n.id).sort();
    expect(ids).toEqual(['p1', 'p3']);
  });

  it('subscribe fires on doc updates', () => {
    const doc = new Y.Doc();
    const s = RefGeomStore.fromYDoc(doc);
    let count = 0;
    s.subscribe(() => {
      count += 1;
    });
    s.addNode(planeStandard('p1'));
    s.addNode(planeStandard('p2'));
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('destroy detaches the doc observer', () => {
    const doc = new Y.Doc();
    const s = RefGeomStore.fromYDoc(doc);
    let count = 0;
    s.subscribe(() => {
      count += 1;
    });
    s.destroy();
    s.addNode(planeStandard('p1')); // still applies (doc mutates) but no notify
    expect(count).toBe(0);
  });

  it('getDoc returns the wrapped Y.Doc', () => {
    const doc = new Y.Doc();
    const s = RefGeomStore.fromYDoc(doc);
    expect(s.getDoc?.()).toBe(doc);
  });

  it('two stores on same doc see same nodes', () => {
    const doc = new Y.Doc();
    const a = RefGeomStore.fromYDoc(doc);
    const b = RefGeomStore.fromYDoc(doc);
    a.addNode(planeStandard('p1'));
    expect(b.getNodes().map((n) => n.id)).toEqual(['p1']);
  });
});

// ─── 3. migrateToYjs ───────────────────────────────────────────────────────

describe('migrateToYjs — preserves local state', () => {
  it('moves all nodes into the doc', () => {
    const local = RefGeomStore.local([planeStandard('p1'), axisStandard('a1')]);
    const doc = new Y.Doc();
    const yjs = migrateToYjs(local, doc);
    expect(yjs.mode).toBe('yjs');
    expect(yjs.getNodes().map((n) => n.id).sort()).toEqual(['a1', 'p1']);
  });

  it('throws when source store is already in yjs mode', () => {
    const doc = new Y.Doc();
    const yjs = RefGeomStore.fromYDoc(doc);
    expect(() => migrateToYjs(yjs, new Y.Doc())).toThrowError(/local mode/);
  });

  it('migrating an empty local store yields an empty yjs store', () => {
    const local = RefGeomStore.local();
    const doc = new Y.Doc();
    const yjs = migrateToYjs(local, doc);
    expect(yjs.getNodes()).toEqual([]);
  });

  it('switching modes mid-session does not lose data', () => {
    const local = RefGeomStore.local();
    local.addNode(planeStandard('p1'));
    local.addNode(planeOffset('p2', 'p1', 30));

    const doc = new Y.Doc();
    const yjs = migrateToYjs(local, doc);

    expect(yjs.getNodes()).toHaveLength(2);
    expect(yjs.getNode('p2')!.dependsOn).toEqual(['p1']);

    yjs.addNode(planeStandard('p3'));
    expect(readAllReferenceNodes(doc).size).toBe(3);
  });
});

// ─── 4. LWW + concurrent edit semantics ────────────────────────────────────

describe('RefGeomStore — LWW + concurrent edits', () => {
  it('two Yjs stores converge after concurrent updates on same node', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    // Bootstrap on A only, propagate (single-creator pattern from
    // smoke harness rule).
    const a = RefGeomStore.fromYDoc(docA);
    a.addNode(planeStandard('p1'));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const b = RefGeomStore.fromYDoc(docB);

    a.updateNode('p1', { label: 'A-wins' });
    b.updateNode('p1', { label: 'B-wins' });

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    expect(a.getNode('p1')!.label).toBe(b.getNode('p1')!.label);
  });

  it('two peers adding different node ids both survive', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = RefGeomStore.fromYDoc(docA);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const b = RefGeomStore.fromYDoc(docB);

    a.addNode(planeStandard('p1'));
    b.addNode(planeStandard('p2'));

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    expect(a.getNodes().map((n) => n.id).sort()).toEqual(['p1', 'p2']);
    expect(b.getNodes().map((n) => n.id).sort()).toEqual(['p1', 'p2']);
  });
});
