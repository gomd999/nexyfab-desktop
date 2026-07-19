/**
 * W2-0 — downstream regeneration via upstream references.
 *
 * The gate scenario from REPLACEMENT_ROADMAP.md §1:
 *
 *     extrude(depth=10) -> fillet,  edit upstream depth 10->25
 *     downstreamOf(f1) = ['f2']     <- dependency graph correct
 *     f1 changed? true
 *     f2 (fillet) changed? false    <- downstream NOT regenerated  (the bug)
 *
 * Root cause was `FilletFeature.childExtrude` holding a COPY of the
 * upstream node. These tests pin the reference-based replacement, and pin
 * the legacy embedded path as still-working so conversion stays incremental.
 */
import { describe, it, expect } from 'vitest';
import {
  replayTree,
  validateTree,
  downstreamOf,
  upstreamRefsOf,
  syncEmbeddedSnapshots,
  FeatureTreeError,
  type FeatureTree,
  type FeatureNode,
} from '../featureTree';
import { incrementalReplay, applyEdit } from '../featureTreeEdit';
import type { ExtrudeFeature } from '../extrudeProfile';
import {
  buildFilletFeature,
  buildFilletFeatureRef,
  filletToScad,
  type FilletFeature,
} from '../filletProfile';

const box = (depth: number): ExtrudeFeature => ({
  kind: 'extrude',
  loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
  depth,
  direction: 'one_sided',
  mode: 'add',
});

/** [extrude f1, fillet f2 -> f1] in reference mode. */
function refTree(depth: number, radius = 2): FeatureTree {
  const e = box(depth);
  const f1: FeatureNode = { id: 'f1', name: 'base', dependencies: [], payload: e };
  const f2: FeatureNode = {
    id: 'f2',
    name: 'round',
    dependencies: ['f1'],
    payload: buildFilletFeatureRef('f1', e, radius, 'all'),
  };
  return { nodes: [f1, f2] };
}

/** The same shape, legacy embedded-payload mode. */
function legacyTree(depth: number, radius = 2): FeatureTree {
  const e = box(depth);
  const f1: FeatureNode = { id: 'f1', name: 'base', dependencies: [], payload: e };
  const f2: FeatureNode = {
    id: 'f2',
    name: 'round',
    dependencies: ['f1'],
    payload: buildFilletFeature(e, radius, 'all'),
  };
  return { nodes: [f1, f2] };
}

/** Extract the minkowski core cube's Z extent from an 'all' fillet body. */
function coreDepthOf(scad: string): number {
  const m = scad.match(/cube\(\[[\d.]+, [\d.]+, ([\d.]+)\]\)/);
  if (!m) throw new Error(`no core cube in:\n${scad}`);
  return Number(m[1]);
}

describe('W2-0 gate — upstream edit propagates to downstream fillet', () => {
  it('regenerates the fillet when the upstream extrude depth changes (10 -> 25)', () => {
    const tree1 = refTree(10);
    const r1 = replayTree(tree1);

    expect([...downstreamOf(tree1, 'f1')]).toEqual(['f2']);

    const tree2 = applyEdit(tree1, {
      type: 'set_payload',
      nodeId: 'f1',
      payload: box(25),
    });
    const r2 = incrementalReplay(r1, tree1, tree2);

    const f1Changed = r1.perNode.get('f1') !== r2.perNode.get('f1');
    const f2Changed = r1.perNode.get('f2') !== r2.perNode.get('f2');

    expect(f1Changed).toBe(true);
    expect(f2Changed).toBe(true); // <- was false before W2-0

    // Not merely "different text" — the geometry tracks depth - 2r exactly.
    expect(coreDepthOf(r1.perNode.get('f2')!)).toBe(10 - 4);
    expect(coreDepthOf(r2.perNode.get('f2')!)).toBe(25 - 4);
  });

  it('full replay agrees with incremental replay after the edit', () => {
    const tree1 = refTree(10);
    const tree2 = applyEdit(tree1, {
      type: 'set_payload', nodeId: 'f1', payload: box(25),
    });
    const inc = incrementalReplay(replayTree(tree1), tree1, tree2);
    expect(inc.scad).toBe(replayTree(tree2).scad);
  });

  it('the referenced body is consumed — no sharp box emitted beside the round one', () => {
    const tree = refTree(10);
    const r = replayTree(tree);
    expect(upstreamRefsOf(tree.nodes[1]!.payload)).toEqual(['f1']);
    expect(r.emittedOrder).toEqual(['f2']);
    // f1 is still rendered (editor previews need it), just not top-level.
    expect(r.perNode.has('f1')).toBe(true);
  });

  it('legacy embedded fillet still emits, and still does NOT track upstream', () => {
    // Pinned deliberately: conversion is per-kind, so the old path must keep
    // working unchanged until W2-A converts each remaining feature.
    const tree1 = legacyTree(10);
    const r1 = replayTree(tree1);
    const tree2 = applyEdit(tree1, {
      type: 'set_payload', nodeId: 'f1', payload: box(25),
    });
    const r2 = incrementalReplay(r1, tree1, tree2);
    expect(r1.perNode.get('f2')).toBe(r2.perNode.get('f2'));
    expect(r1.emittedOrder).toEqual(['f1', 'f2']); // legacy: both top-level
  });
});

describe('W2-0 — resolution failure is explicit, never a silent guess', () => {
  it('refuses to emit a ref-mode fillet without a tree context', () => {
    const f = buildFilletFeatureRef('f1', box(10), 2, 'all');
    expect(() => filletToScad(f)).toThrow(/without a tree context/);
    expect(() => filletToScad(f)).toThrow(/Refusing to fall back/);
  });

  it('rejects a payload ref that is not a declared dependency', () => {
    const e = box(10);
    const tree: FeatureTree = {
      nodes: [
        { id: 'f1', name: 'base', dependencies: [], payload: e },
        {
          id: 'f2', name: 'round',
          dependencies: [], // <- ref present in payload but undeclared
          payload: buildFilletFeatureRef('f1', e, 2, 'all'),
        },
      ],
    };
    expect(() => validateTree(tree)).toThrow(FeatureTreeError);
    expect(() => validateTree(tree)).toThrow(/does not declare it in dependencies/);
  });

  it('rejects a ref to a node that does not exist (via the dependency check)', () => {
    const tree: FeatureTree = {
      nodes: [{
        id: 'f2', name: 'round', dependencies: ['ghost'],
        payload: buildFilletFeatureRef('ghost', box(10), 2, 'all'),
      }],
    };
    expect(() => replayTree(tree)).toThrow(/depends on ghost/);
  });

  it('rejects a ref to a non-extrude upstream instead of guessing', () => {
    const tree: FeatureTree = {
      nodes: [
        {
          id: 'f1', name: 'rev', dependencies: [],
          payload: {
            kind: 'revolve',
            loop: [{ x: 1, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }],
            angleDegrees: 360,
            mode: 'add',
          },
        },
        {
          id: 'f2', name: 'round', dependencies: ['f1'],
          payload: buildFilletFeatureRef('f1', box(10), 2, 'all'),
        },
      ],
    };
    expect(() => replayTree(tree)).toThrow(/requires upstream f1 to be a 'extrude'/);
  });

  it('cannot form a cycle — refs point strictly backwards by construction', () => {
    const e = box(10);
    const tree: FeatureTree = {
      nodes: [
        { id: 'f2', name: 'round', dependencies: ['f1'], payload: buildFilletFeatureRef('f1', e, 2, 'all') },
        { id: 'f1', name: 'base', dependencies: [], payload: e },
      ],
    };
    expect(() => validateTree(tree)).toThrow(/appears later or not at all/);
  });
});

describe('W2-0 — suppression cascades along references', () => {
  it('auto-suppresses a fillet whose referenced body is suppressed', () => {
    const tree = refTree(10);
    const suppressed = applyEdit(tree, {
      type: 'set_suppressed', nodeId: 'f1', suppressed: true,
    });
    const r = replayTree(suppressed);
    expect(r.autoSuppressed).toEqual(['f2']);
    expect(r.emittedOrder).toEqual([]);
    expect(r.scad).toBe('');
  });

  it('un-suppressing the upstream restores the downstream', () => {
    const tree = refTree(10);
    const off = applyEdit(tree, { type: 'set_suppressed', nodeId: 'f1', suppressed: true });
    const on = applyEdit(off, { type: 'set_suppressed', nodeId: 'f1', suppressed: false });
    const r = replayTree(on);
    expect(r.autoSuppressed).toEqual([]);
    expect(r.emittedOrder).toEqual(['f2']);
  });

  it('boolean bodies keep their existing consumption behaviour', () => {
    const tree: FeatureTree = {
      nodes: [
        { id: 'a', name: 'a', dependencies: [], payload: box(10) },
        { id: 'b', name: 'b', dependencies: [], payload: box(4) },
        {
          id: 'u', name: 'u', dependencies: ['a', 'b'],
          payload: { kind: 'boolean', op: 'union', bodies: ['a', 'b'] },
        },
      ],
    };
    const r = replayTree(tree);
    expect(r.emittedOrder).toEqual(['u']);
    expect(upstreamRefsOf(tree.nodes[2]!.payload)).toEqual(['a', 'b']);
  });
});

describe('W2-0 — embedded snapshot sync bridge', () => {
  it('refreshes a stale childExtrude snapshot from the live upstream', () => {
    const tree1 = refTree(10);
    const tree2 = applyEdit(tree1, {
      type: 'set_payload', nodeId: 'f1', payload: box(25),
    });
    // Snapshot is stale straight after the edit...
    expect((tree2.nodes[1]!.payload as FilletFeature).childExtrude.depth).toBe(10);
    const synced = syncEmbeddedSnapshots(tree2);
    // ...and matches the live upstream after syncing.
    expect((synced.nodes[1]!.payload as FilletFeature).childExtrude.depth).toBe(25);
    expect((synced.nodes[1]!.payload as FilletFeature).childExtrude).toBe(
      synced.nodes[0]!.payload,
    );
  });

  it('leaves legacy (non-ref) nodes untouched by reference', () => {
    const tree = legacyTree(10);
    const synced = syncEmbeddedSnapshots(tree);
    expect(synced.nodes[1]).toBe(tree.nodes[1]);
  });

  it('is idempotent', () => {
    const once = syncEmbeddedSnapshots(refTree(10));
    const twice = syncEmbeddedSnapshots(once);
    expect(twice.nodes[1]).toBe(once.nodes[1]);
  });
});
