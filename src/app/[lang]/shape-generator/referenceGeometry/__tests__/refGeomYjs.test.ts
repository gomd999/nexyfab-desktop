/**
 * refGeomYjs.test.ts — Wave 2 Phase 3 Z4 (D3b).
 *
 * Y.Doc-backed CRDT layer cases:
 *  - Y helpers (getRefGeomRoot, readReferenceNode, readAllReferenceNodes)
 *  - applyRefGeomOp branches (addNode, removeNode, updateNode, renameNode)
 *  - decoder re-derives dependsOn from params on read
 *  - LWW on concurrent updateNode for same node id
 *  - bulk populateRefGeomDoc / clearRefGeomDoc
 *  - referenceNodesEqual round-trip
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  applyRefGeomOp,
  getRefGeomRoot,
  getRefGeomNodeYMap,
  readReferenceNode,
  readAllReferenceNodes,
  readAllReferenceNodesArray,
  populateRefGeomDoc,
  clearRefGeomDoc,
  syncDocs,
  referenceNodesEqual,
} from '../refGeomYjs';
import type { ReferencePlaneNode, ReferenceAxisNode, ReferencePointNode } from '../types';

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

function pointByCoords(id: string, position: [number, number, number] = [0, 0, 0]): ReferencePointNode {
  return {
    id,
    kind: 'point',
    method: 'byCoordinates',
    label: id,
    hidden: false,
    dependsOn: [],
    evaluatedAt: 0,
    params: { method: 'byCoordinates', position },
  };
}

// ─── 1. Y helpers ──────────────────────────────────────────────────────────

describe('refGeomYjs — Y helpers', () => {
  it('getRefGeomRoot returns the same Y.Map across calls', () => {
    const doc = new Y.Doc();
    const a = getRefGeomRoot(doc);
    const b = getRefGeomRoot(doc);
    expect(a).toBe(b);
  });

  it('getRefGeomRoot on a fresh doc is empty', () => {
    const doc = new Y.Doc();
    expect(getRefGeomRoot(doc).size).toBe(0);
  });

  it('getRefGeomNodeYMap returns null for missing id', () => {
    const doc = new Y.Doc();
    expect(getRefGeomNodeYMap(doc, 'nope')).toBeNull();
  });

  it('readReferenceNode returns null for missing id', () => {
    const doc = new Y.Doc();
    expect(readReferenceNode(doc, 'nope')).toBeNull();
  });

  it('readAllReferenceNodes is an empty Map on a fresh doc', () => {
    const doc = new Y.Doc();
    expect(readAllReferenceNodes(doc).size).toBe(0);
  });

  it('readAllReferenceNodesArray is an empty array on a fresh doc', () => {
    const doc = new Y.Doc();
    expect(readAllReferenceNodesArray(doc)).toEqual([]);
  });
});

// ─── 2. addNode + read round-trip ─────────────────────────────────────────

describe('refGeomYjs — addNode + read round-trip', () => {
  it('addNode lands a plane that survives read', () => {
    const doc = new Y.Doc();
    const node = planeStandard('p1', 'Front Plane');
    const r = applyRefGeomOp(doc, { kind: 'addNode', node });
    expect(r.applied).toBe(true);
    const back = readReferenceNode(doc, 'p1');
    expect(back).not.toBeNull();
    expect(back!.id).toBe('p1');
    expect(back!.kind).toBe('plane');
    expect(back!.method).toBe('standard');
    expect(back!.label).toBe('Front Plane');
  });

  it('addNode lands an axis that survives read', () => {
    const doc = new Y.Doc();
    applyRefGeomOp(doc, { kind: 'addNode', node: axisStandard('a1') });
    const back = readReferenceNode(doc, 'a1');
    expect(back!.kind).toBe('axis');
    expect(back!.method).toBe('standard');
  });

  it('addNode lands a point that survives read', () => {
    const doc = new Y.Doc();
    applyRefGeomOp(doc, { kind: 'addNode', node: pointByCoords('pt1', [1, 2, 3]) });
    const back = readReferenceNode(doc, 'pt1');
    expect(back!.kind).toBe('point');
    expect((back!.params as unknown as { position: [number, number, number] }).position).toEqual([1, 2, 3]);
  });

  it('decoder re-derives dependsOn from params (offset node)', () => {
    const doc = new Y.Doc();
    applyRefGeomOp(doc, { kind: 'addNode', node: planeStandard('p1') });
    applyRefGeomOp(doc, { kind: 'addNode', node: planeOffset('p2', 'p1', 25) });
    const back = readReferenceNode(doc, 'p2');
    expect(back!.dependsOn).toEqual(['p1']);
  });

  it('addNode without id throws', () => {
    const doc = new Y.Doc();
    expect(() =>
      applyRefGeomOp(doc, {
        kind: 'addNode',
        node: { ...planeStandard('x'), id: '' },
      }),
    ).toThrowError(/requires node.id/);
  });

  it('addNode with same id overwrites (LWW)', () => {
    const doc = new Y.Doc();
    applyRefGeomOp(doc, { kind: 'addNode', node: planeStandard('p1', 'First') });
    applyRefGeomOp(doc, { kind: 'addNode', node: planeStandard('p1', 'Second') });
    expect(readReferenceNode(doc, 'p1')!.label).toBe('Second');
  });

  it('readAllReferenceNodes returns every node', () => {
    const doc = new Y.Doc();
    applyRefGeomOp(doc, { kind: 'addNode', node: planeStandard('p1') });
    applyRefGeomOp(doc, { kind: 'addNode', node: axisStandard('a1') });
    applyRefGeomOp(doc, { kind: 'addNode', node: pointByCoords('pt1') });
    const all = readAllReferenceNodes(doc);
    expect(all.size).toBe(3);
    expect(all.has('p1')).toBe(true);
    expect(all.has('a1')).toBe(true);
    expect(all.has('pt1')).toBe(true);
  });
});

// ─── 3. applyRefGeomOp branches ─────────────────────────────────────────────

describe('refGeomYjs — applyRefGeomOp branches', () => {
  it('removeNode drops the entry', () => {
    const doc = new Y.Doc();
    applyRefGeomOp(doc, { kind: 'addNode', node: planeStandard('p1') });
    const r = applyRefGeomOp(doc, { kind: 'removeNode', nodeId: 'p1' });
    expect(r.applied).toBe(true);
    expect(readReferenceNode(doc, 'p1')).toBeNull();
  });

  it('removeNode on missing id is a no-op', () => {
    const doc = new Y.Doc();
    const r = applyRefGeomOp(doc, { kind: 'removeNode', nodeId: 'nope' });
    expect(r.applied).toBe(false);
  });

  it('updateNode patches the label', () => {
    const doc = new Y.Doc();
    applyRefGeomOp(doc, { kind: 'addNode', node: planeStandard('p1', 'Old') });
    applyRefGeomOp(doc, { kind: 'updateNode', nodeId: 'p1', patch: { label: 'New' } });
    expect(readReferenceNode(doc, 'p1')!.label).toBe('New');
  });

  it('updateNode patches params (JSON-LWW)', () => {
    const doc = new Y.Doc();
    applyRefGeomOp(doc, { kind: 'addNode', node: planeStandard('p1') });
    applyRefGeomOp(doc, {
      kind: 'updateNode',
      nodeId: 'p1',
      patch: { params: { method: 'standard', id: 'top' } },
    });
    const back = readReferenceNode(doc, 'p1')!;
    expect((back.params as { id: string }).id).toBe('top');
  });

  it('updateNode rejects a kind change', () => {
    const doc = new Y.Doc();
    applyRefGeomOp(doc, { kind: 'addNode', node: planeStandard('p1') });
    const r = applyRefGeomOp(doc, {
      kind: 'updateNode',
      nodeId: 'p1',
      patch: { kind: 'axis' },
    });
    expect(r.applied).toBe(false);
    expect(r.notes).toMatch(/kind change/);
    expect(readReferenceNode(doc, 'p1')!.kind).toBe('plane');
  });

  it('updateNode rejects an id change', () => {
    const doc = new Y.Doc();
    applyRefGeomOp(doc, { kind: 'addNode', node: planeStandard('p1') });
    const r = applyRefGeomOp(doc, {
      kind: 'updateNode',
      nodeId: 'p1',
      patch: { id: 'p2' },
    });
    expect(r.applied).toBe(false);
    expect(r.notes).toMatch(/id change/);
  });

  it('updateNode on missing id is a no-op', () => {
    const doc = new Y.Doc();
    const r = applyRefGeomOp(doc, { kind: 'updateNode', nodeId: 'nope', patch: { label: 'x' } });
    expect(r.applied).toBe(false);
  });

  it('renameNode patches the label', () => {
    const doc = new Y.Doc();
    applyRefGeomOp(doc, { kind: 'addNode', node: planeStandard('p1', 'Old') });
    const r = applyRefGeomOp(doc, { kind: 'renameNode', nodeId: 'p1', name: 'Renamed' });
    expect(r.applied).toBe(true);
    expect(readReferenceNode(doc, 'p1')!.label).toBe('Renamed');
  });

  it('renameNode on missing id is a no-op', () => {
    const doc = new Y.Doc();
    const r = applyRefGeomOp(doc, { kind: 'renameNode', nodeId: 'nope', name: 'x' });
    expect(r.applied).toBe(false);
  });
});

// ─── 4. Cycle detection on add (single-peer baseline) ──────────────────────
//
// Single-peer cycle detection happens in RefGeomStore (matching Zustand
// semantics). refGeomYjs itself is permissive — peer-A and peer-B can each
// add a node whose params form a cycle when merged. This is the Z4 §6
// premise. The RefGeomStore.test covers the local cycle gate; here we
// just confirm refGeomYjs lets the bare-Yjs add through.

describe('refGeomYjs — accepts adds without cycle gate (Z4 §6)', () => {
  it('addNode for a self-loop is allowed at the Yjs layer (gate is at RefGeomStore)', () => {
    const doc = new Y.Doc();
    // A pathological node depending on itself — refGeomYjs.applyOp must
    // let it through; the integration layer surfaces the cycle.
    const selfLoop: ReferencePlaneNode = {
      ...planeStandard('p1'),
      dependsOn: ['p1'],
    };
    const r = applyRefGeomOp(doc, { kind: 'addNode', node: selfLoop });
    expect(r.applied).toBe(true);
  });
});

// ─── 5. LWW on concurrent updateNode ───────────────────────────────────────

describe('refGeomYjs — LWW on concurrent updateNode (same node id)', () => {
  it('two peers updating same label converge', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    // Bootstrap on A only, propagate to B.
    applyRefGeomOp(docA, { kind: 'addNode', node: planeStandard('p1', 'init') });
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Concurrent label updates on same node.
    applyRefGeomOp(docA, { kind: 'updateNode', nodeId: 'p1', patch: { label: 'A-wins' } });
    applyRefGeomOp(docB, { kind: 'updateNode', nodeId: 'p1', patch: { label: 'B-wins' } });

    // Bidirectional sync.
    syncDocs(docA, docB);

    const final = readReferenceNode(docA, 'p1')!.label;
    expect(readReferenceNode(docB, 'p1')!.label).toBe(final);
    // The winner is one of the two (Yjs LWW by clock, not predictable in
    // the test, but the convergence is the assertion).
    expect(['A-wins', 'B-wins']).toContain(final);
  });

  it('two peers updating same params converge (JSON-LWW)', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    applyRefGeomOp(docA, { kind: 'addNode', node: planeStandard('p1') });
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    applyRefGeomOp(docA, {
      kind: 'updateNode',
      nodeId: 'p1',
      patch: { params: { method: 'standard', id: 'top' } },
    });
    applyRefGeomOp(docB, {
      kind: 'updateNode',
      nodeId: 'p1',
      patch: { params: { method: 'standard', id: 'right' } },
    });

    syncDocs(docA, docB);

    const finalA = (readReferenceNode(docA, 'p1')!.params as { id: string }).id;
    const finalB = (readReferenceNode(docB, 'p1')!.params as { id: string }).id;
    expect(finalA).toBe(finalB);
    expect(['top', 'right']).toContain(finalA);
  });

  it('two peers adding different node ids both survive', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    // Empty bootstrap on both; concurrent adds on different ids.
    applyRefGeomOp(docA, { kind: 'addNode', node: planeStandard('p1') });
    applyRefGeomOp(docB, { kind: 'addNode', node: planeStandard('p2') });

    syncDocs(docA, docB);

    const idsA = [...readAllReferenceNodes(docA).keys()].sort();
    const idsB = [...readAllReferenceNodes(docB).keys()].sort();
    expect(idsA).toEqual(['p1', 'p2']);
    expect(idsB).toEqual(['p1', 'p2']);
  });
});

// ─── 6. Bulk population ────────────────────────────────────────────────────

describe('refGeomYjs — bulk population', () => {
  it('populateRefGeomDoc writes all nodes in one transact', () => {
    const doc = new Y.Doc();
    let transactCount = 0;
    doc.on('afterTransaction', () => {
      transactCount += 1;
    });
    populateRefGeomDoc(doc, [planeStandard('p1'), planeStandard('p2'), axisStandard('a1')]);
    expect(transactCount).toBe(1);
    expect(readAllReferenceNodes(doc).size).toBe(3);
  });

  it('clearRefGeomDoc empties the doc', () => {
    const doc = new Y.Doc();
    populateRefGeomDoc(doc, [planeStandard('p1'), planeStandard('p2')]);
    clearRefGeomDoc(doc);
    expect(readAllReferenceNodes(doc).size).toBe(0);
  });
});

// ─── 7. Equality helper ────────────────────────────────────────────────────

describe('refGeomYjs — referenceNodesEqual', () => {
  it('two empty arrays are equal', () => {
    expect(referenceNodesEqual([], [])).toBe(true);
  });

  it('arrays with the same nodes (same order) are equal', () => {
    const a = [planeStandard('p1'), planeStandard('p2')];
    const b = [planeStandard('p1'), planeStandard('p2')];
    expect(referenceNodesEqual(a, b)).toBe(true);
  });

  it('arrays with the same nodes in different order are equal', () => {
    const a = [planeStandard('p1'), planeStandard('p2')];
    const b = [planeStandard('p2'), planeStandard('p1')];
    expect(referenceNodesEqual(a, b)).toBe(true);
  });

  it('arrays of different length are not equal', () => {
    const a = [planeStandard('p1')];
    const b = [planeStandard('p1'), planeStandard('p2')];
    expect(referenceNodesEqual(a, b)).toBe(false);
  });

  it('arrays with same ids but different labels are not equal', () => {
    const a = [planeStandard('p1', 'A')];
    const b = [planeStandard('p1', 'B')];
    expect(referenceNodesEqual(a, b)).toBe(false);
  });
});

// ─── 8. Round-trip via syncDocs ────────────────────────────────────────────

describe('refGeomYjs — syncDocs', () => {
  it('one peer populates, sync to the other converges', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    populateRefGeomDoc(docA, [planeStandard('p1'), axisStandard('a1')]);
    syncDocs(docA, docB);
    expect(readAllReferenceNodes(docB).size).toBe(2);
  });

  it('returns byte counts in both directions', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    populateRefGeomDoc(docA, [planeStandard('p1')]);
    const r = syncDocs(docA, docB);
    expect(r.aToB).toBeGreaterThan(0);
    expect(r.bToA).toBeGreaterThanOrEqual(0); // empty B to A is small
  });
});
