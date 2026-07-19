/**
 * W2-0 debt payoff — snapshot-reading consumers now resolve references.
 *
 * W2-0 fixed the SCAD emitter but left four consumers reading the embedded
 * `childExtrude` snapshot, so on a ref-mode tree they could still report
 * PRE-EDIT geometry (design note §5.4). These tests do not assert "the code
 * changed" — each one edits an upstream extrude and pins the consumer's
 * output to the NEW value, with the stale value named explicitly so a
 * regression reads as "you are seeing 10 again".
 *
 * Covered here: the shared resolver + featureTreeStats. featurePlan,
 * stepWriteFilletChamfer and featureTreePlanner have sibling suites in
 * their own module trees.
 */
import { describe, it, expect } from 'vitest';
import { applyEdit } from '../featureTreeEdit';
import { computeStats } from '../featureTreeStats';
import { emitContextForTree, resolveChildExtrude } from '../upstreamResolve';
import { FeatureTreeError, type FeatureTree, type FeatureNode } from '../featureTree';
import type { ExtrudeFeature } from '../extrudeProfile';
import { buildFilletFeature, buildFilletFeatureRef } from '../filletProfile';

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

const editDepth = (t: FeatureTree, depth: number): FeatureTree =>
  applyEdit(t, { type: 'set_payload', nodeId: 'f1', payload: box(depth) });

describe('resolveChildExtrude — the shared resolution policy', () => {
  it('reads the LIVE upstream, not the snapshot, once the upstream is edited', () => {
    const before = refTree(10);
    const after = editDepth(before, 25);
    const node = after.nodes[1]!;

    // The snapshot inside the payload is deliberately still 10 — this is
    // exactly the stale value the old consumers were reading.
    expect((node.payload as { childExtrude: ExtrudeFeature }).childExtrude.depth).toBe(10);

    const resolved = resolveChildExtrude(node.payload, node.id, emitContextForTree(after));
    expect(resolved?.child.depth).toBe(25);
    expect(resolved?.source).toBe('ref');
    expect(resolved?.refId).toBe('f1');
  });

  it('reports a legacy embedded read as such rather than passing it off as live', () => {
    const t = legacyTree(10);
    const node = t.nodes[1]!;
    const resolved = resolveChildExtrude(node.payload, node.id, emitContextForTree(t));
    expect(resolved?.source).toBe('embedded');
    expect(resolved?.refId).toBeUndefined();
    expect(resolved?.child.depth).toBe(10);
  });

  it('refuses to fall back to the stale snapshot when no context is supplied', () => {
    const node = refTree(10).nodes[1]!;
    expect(() => resolveChildExtrude(node.payload, node.id)).toThrow(/without a tree context/);
  });

  it('rejects a ref whose upstream is the wrong kind instead of guessing', () => {
    const t = refTree(10);
    const broken: FeatureTree = {
      nodes: [
        { ...t.nodes[0]!, payload: { ...box(10), kind: 'revolve' } as never },
        t.nodes[1]!,
      ],
    };
    expect(() =>
      resolveChildExtrude(broken.nodes[1]!.payload, 'f2', emitContextForTree(broken)),
    ).toThrow(FeatureTreeError);
  });

  it('rejects a ref to a node that is not in the tree', () => {
    const t = refTree(10);
    const orphan: FeatureTree = { nodes: [t.nodes[1]!] };
    expect(() =>
      resolveChildExtrude(orphan.nodes[0]!.payload, 'f2', emitContextForTree(orphan)),
    ).toThrow(/not in the tree/);
  });

  it('refuses to serve rendered SCAD from a payload-only context', () => {
    expect(() => emitContextForTree(refTree(10)).requireScad('f1', 'f2')).toThrow(
      /static \(payload-only\) EmitContext/,
    );
  });
});

describe('featureTreeStats — fillet bbox follows the upstream edit', () => {
  it('reports the NEW depth in the fillet bbox after an upstream change (10 -> 25)', () => {
    const before = computeStats(refTree(10));
    expect(before.perFeature.get('f2')!.bbox!.max.z).toBe(10);

    const after = computeStats(editDepth(refTree(10), 25));
    // The stale snapshot still says 10; the whole point is that we no
    // longer read it.
    expect(after.perFeature.get('f2')!.bbox!.max.z).toBe(25);
  });

  it('aggregate bbox tracks the upstream edit too', () => {
    expect(computeStats(refTree(10)).bbox.max.z).toBe(10);
    expect(computeStats(editDepth(refTree(10), 25)).bbox.max.z).toBe(25);
  });

  it('does not list a ref-mode fillet as an embedded read', () => {
    expect(computeStats(refTree(10)).embeddedChildNodes).toEqual([]);
  });

  it('names the node when it DOES fall back to a legacy embedded snapshot', () => {
    const stats = computeStats(legacyTree(10));
    expect(stats.embeddedChildNodes).toEqual(['f2']);
    // Legacy behaviour preserved: bbox comes from the frozen snapshot and
    // does NOT follow the upstream edit. Pinned so the difference between
    // the two modes stays visible rather than silently converging.
    const stale = computeStats(editDepth(legacyTree(10), 25));
    expect(stale.perFeature.get('f2')!.bbox!.max.z).toBe(10);
    expect(stale.embeddedChildNodes).toEqual(['f2']);
  });
});
