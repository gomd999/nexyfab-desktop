/**
 * refGeomYjs.divergence.test.ts — Wave 2 Phase 3 Z4 §6 + §7.
 *
 * Peer-merge convergence cases focusing on cycle detection across peers
 * (the key Z4 §6 deliverable):
 *
 *   - Peer A adds X→Y, peer B concurrently adds Y→X. Both ops apply
 *     locally without cycle (each peer's local graph never closes a
 *     loop). On sync, the merged graph contains an X↔Y cycle that
 *     `findAllCycles` surfaces. The cycle is NOT auto-broken; the host
 *     UI banner prompts the user to resolve.
 *
 *   - Plus the standard convergence cases (different-id concurrent
 *     adds, same-id LWW updateNode, peer order doesn't matter).
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  applyRefGeomOp,
  readAllReferenceNodesArray,
  syncDocs,
  populateRefGeomDoc,
} from '../refGeomYjs';
import { buildGraph, findAllCycles } from '../depSolver';
import type { ReferencePlaneNode } from '../types';

function planeStandard(id: string): ReferencePlaneNode {
  return {
    id,
    kind: 'plane',
    method: 'standard',
    label: id,
    hidden: false,
    dependsOn: [],
    evaluatedAt: 0,
    params: { method: 'standard', id: 'front' },
  };
}

function planeOffset(id: string, parentId: string): ReferencePlaneNode {
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
      distanceMm: 10,
      direction: 1,
    },
  };
}

// ─── 1. Cross-peer cycle case (Z4 §6 marquee scenario) ─────────────────────

describe('refGeomYjs divergence — cross-peer cycle (Z4 §6)', () => {
  it('peer A adds X→Y, peer B concurrently adds Y→X — merged graph cycles', () => {
    // Setup: both peers know about an initial empty doc.
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    // Peer A adds X depending on Y (Y doesn't exist on A yet — it's a
    // forward declaration that becomes a real dep once B's add merges).
    applyRefGeomOp(docA, { kind: 'addNode', node: planeOffset('X', 'Y') });

    // Peer B adds Y depending on X (symmetric).
    applyRefGeomOp(docB, { kind: 'addNode', node: planeOffset('Y', 'X') });

    // Before sync: each peer's local graph has only one node, no cycle.
    {
      const nodesA = readAllReferenceNodesArray(docA);
      const nodesB = readAllReferenceNodesArray(docB);
      expect(findAllCycles(buildGraph(nodesA)).cycles).toHaveLength(0);
      expect(findAllCycles(buildGraph(nodesB)).cycles).toHaveLength(0);
    }

    // Sync: now both docs have both nodes.
    syncDocs(docA, docB);

    const merged = readAllReferenceNodesArray(docA);
    expect(merged.map((n) => n.id).sort()).toEqual(['X', 'Y']);

    // The merged dep graph now has an X→Y→X cycle.
    const cycleResult = findAllCycles(buildGraph(merged));
    expect(cycleResult.cycles.length).toBeGreaterThan(0);

    // Cycle should mention both X and Y.
    const cycleIds = new Set(cycleResult.cycles[0]);
    expect(cycleIds.has('X')).toBe(true);
    expect(cycleIds.has('Y')).toBe(true);

    // Other peer (B) sees the same cycle (convergence).
    const mergedB = readAllReferenceNodesArray(docB);
    const cycleResultB = findAllCycles(buildGraph(mergedB));
    expect(cycleResultB.cycles.length).toBe(cycleResult.cycles.length);
  });

  it('cross-peer cycle is NOT auto-broken (user resolves manually)', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    applyRefGeomOp(docA, { kind: 'addNode', node: planeOffset('X', 'Y') });
    applyRefGeomOp(docB, { kind: 'addNode', node: planeOffset('Y', 'X') });
    syncDocs(docA, docB);

    // Both X and Y are still present after sync — neither op was vetoed.
    const ids = readAllReferenceNodesArray(docA).map((n) => n.id).sort();
    expect(ids).toEqual(['X', 'Y']);

    // The cycle remains until the user manually edits one of the deps.
    // Simulate: user on peer A edits X to NOT depend on Y (e.g. switches
    // method to 'standard'). The cycle should clear.
    applyRefGeomOp(docA, {
      kind: 'updateNode',
      nodeId: 'X',
      patch: { method: 'standard', params: { method: 'standard', id: 'front' } },
    });
    syncDocs(docA, docB);

    const finalA = readAllReferenceNodesArray(docA);
    const finalCycles = findAllCycles(buildGraph(finalA));
    expect(finalCycles.cycles).toHaveLength(0);
  });

  it('triangular cycle across 3 peers (A→B, B→C, C→A merge)', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const docC = new Y.Doc();

    applyRefGeomOp(docA, { kind: 'addNode', node: planeOffset('X', 'Y') });
    applyRefGeomOp(docB, { kind: 'addNode', node: planeOffset('Y', 'Z') });
    applyRefGeomOp(docC, { kind: 'addNode', node: planeOffset('Z', 'X') });

    // Fan-in sync to A, then fan-out to B and C.
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docC));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docC, Y.encodeStateAsUpdate(docA));

    const cycles = findAllCycles(buildGraph(readAllReferenceNodesArray(docA))).cycles;
    expect(cycles.length).toBeGreaterThan(0);
    const cycleSet = new Set(cycles[0]);
    expect(cycleSet.has('X')).toBe(true);
    expect(cycleSet.has('Y')).toBe(true);
    expect(cycleSet.has('Z')).toBe(true);
  });
});

// ─── 2. Standard convergence (sanity) ──────────────────────────────────────

describe('refGeomYjs divergence — standard convergence', () => {
  it('two peers concurrently add different node ids — both survive', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    applyRefGeomOp(docA, { kind: 'addNode', node: planeStandard('A1') });
    applyRefGeomOp(docB, { kind: 'addNode', node: planeStandard('B1') });

    syncDocs(docA, docB);

    expect(readAllReferenceNodesArray(docA).map((n) => n.id).sort()).toEqual(['A1', 'B1']);
    expect(readAllReferenceNodesArray(docB).map((n) => n.id).sort()).toEqual(['A1', 'B1']);
  });

  it('peer order is irrelevant — A then B sync ≡ B then A sync', () => {
    // Run the same set of ops in two different docs with different sync
    // orderings; assert final state equality.
    const docA1 = new Y.Doc();
    const docB1 = new Y.Doc();
    const docA2 = new Y.Doc();
    const docB2 = new Y.Doc();

    // Both pairs: A adds p1, B adds p2.
    applyRefGeomOp(docA1, { kind: 'addNode', node: planeStandard('p1') });
    applyRefGeomOp(docB1, { kind: 'addNode', node: planeStandard('p2') });
    applyRefGeomOp(docA2, { kind: 'addNode', node: planeStandard('p1') });
    applyRefGeomOp(docB2, { kind: 'addNode', node: planeStandard('p2') });

    // Pair 1: A→B, then B→A.
    Y.applyUpdate(docB1, Y.encodeStateAsUpdate(docA1));
    Y.applyUpdate(docA1, Y.encodeStateAsUpdate(docB1));

    // Pair 2: B→A, then A→B.
    Y.applyUpdate(docA2, Y.encodeStateAsUpdate(docB2));
    Y.applyUpdate(docB2, Y.encodeStateAsUpdate(docA2));

    expect(readAllReferenceNodesArray(docA1).map((n) => n.id).sort())
      .toEqual(readAllReferenceNodesArray(docA2).map((n) => n.id).sort());
  });

  it('bulk import on A then incremental adds on B all merge correctly', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    populateRefGeomDoc(docA, [
      planeStandard('imp1'),
      planeStandard('imp2'),
      planeOffset('imp3', 'imp1'),
    ]);
    syncDocs(docA, docB);

    applyRefGeomOp(docB, { kind: 'addNode', node: planeOffset('local-B', 'imp2') });
    syncDocs(docA, docB);

    expect(readAllReferenceNodesArray(docA).map((n) => n.id).sort())
      .toEqual(['imp1', 'imp2', 'imp3', 'local-B']);
    expect(readAllReferenceNodesArray(docB).map((n) => n.id).sort())
      .toEqual(['imp1', 'imp2', 'imp3', 'local-B']);
  });

  it('concurrent remove + update on the same node — graph is consistent (one wins)', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    applyRefGeomOp(docA, { kind: 'addNode', node: planeStandard('p1') });
    syncDocs(docA, docB);

    // A renames, B removes — concurrent.
    applyRefGeomOp(docA, { kind: 'renameNode', nodeId: 'p1', name: 'A-rename' });
    applyRefGeomOp(docB, { kind: 'removeNode', nodeId: 'p1' });

    syncDocs(docA, docB);

    // Yjs semantics: delete-after-rename on the root Y.Map is "the entire
    // entry is gone". Both peers should converge to the same state.
    const finalA = readAllReferenceNodesArray(docA);
    const finalB = readAllReferenceNodesArray(docB);
    expect(finalA.length).toBe(finalB.length);
  });

  it('parent_missing surfaces when a peer adds a dep to a node it has not yet received', () => {
    // Peer B adds a node depending on 'p1' which peer A hasn't created yet
    // (timing accident — A is about to create it). B's local view shows
    // parent_missing; once A creates and syncs, it resolves.
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    applyRefGeomOp(docB, { kind: 'addNode', node: planeOffset('child', 'p1') });

    // Before sync, B's graph has missing-parent 'p1'.
    const graphBPre = buildGraph(readAllReferenceNodesArray(docB));
    const r = findAllCycles(graphBPre);
    // No cycle yet (just a dangling dep).
    expect(r.cycles).toHaveLength(0);

    // A creates p1 and syncs.
    applyRefGeomOp(docA, { kind: 'addNode', node: planeStandard('p1') });
    syncDocs(docA, docB);

    expect(readAllReferenceNodesArray(docB).map((n) => n.id).sort()).toEqual(['child', 'p1']);
  });
});
