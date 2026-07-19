/**
 * W2-A — downstream regeneration for the remaining ref-carrying kinds.
 *
 * W2-0 proved the pattern on extrude -> fillet. This file extends it to the
 * kinds W2-0 handed over, and pins the two DELIBERATE non-conversions:
 *
 *   chamfer          -> `childId` + requirePayload   (isomorphic to fillet)
 *   linear_pattern   -> `childId` + requireScad      (design note §2.2)
 *   circular_pattern -> `childId` + requireScad
 *   hole / rib       -> NOT converted; they stay leaves (see §"hole / rib")
 *
 * Every conversion is proved the same way W2-0 proved fillet: not "the field
 * is now a reference" but "editing the upstream MOVES the downstream
 * geometry", pinned to a literal derived from the new upstream value.
 */
import { describe, it, expect } from 'vitest';
import {
  replayTree,
  downstreamOf,
  upstreamRefsOf,
  syncEmbeddedSnapshots,
  FeatureTreeError,
  type FeatureTree,
  type FeatureNode,
  type FeaturePayload,
} from '../featureTree';
import { incrementalReplay, applyEdit } from '../featureTreeEdit';
import type { ExtrudeFeature } from '../extrudeProfile';
import {
  buildChamferFeature,
  buildChamferFeatureRef,
  chamferToScad,
} from '../chamferProfile';
import {
  buildLinearPattern,
  buildLinearPatternRef,
  buildCircularPatternRef,
  linearPatternToScad,
  circularPatternToScad,
} from '../pattern';
import { buildFilletFeatureRef } from '../filletProfile';
import { buildHoleFeature } from '../holeProfile';
import { buildRib } from '../ribFeature';
import type { RevolveFeature } from '../revolveProfile';

const box = (depth: number): ExtrudeFeature => ({
  kind: 'extrude',
  loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
  depth,
  direction: 'one_sided',
  mode: 'add',
});

const node = (
  id: string,
  dependencies: string[],
  payload: FeatureNode['payload'],
  name = id,
): FeatureNode => ({ id, name, dependencies, payload });

/** Z extent of the minkowski core cube in an 'all' chamfer/fillet body. */
function coreDepthOf(scad: string): number {
  const m = scad.match(/cube\(\[[\d.]+, [\d.]+, ([\d.]+)\]\)/);
  if (!m) throw new Error(`no core cube in:\n${scad}`);
  return Number(m[1]);
}

// ══════════════════════════════════════════════════════════════════════════
// chamfer — isomorphic to fillet (requirePayload)
// ══════════════════════════════════════════════════════════════════════════

/** [extrude f1, chamfer f2 -> f1] in reference mode. */
function chamferRefTree(depth: number, distance = 2): FeatureTree {
  const e = box(depth);
  return {
    nodes: [
      node('f1', [], e, 'base'),
      node('f2', ['f1'], buildChamferFeatureRef('f1', e, distance, 'all'), 'bevel'),
    ],
  };
}

describe('W2-A chamfer — upstream edit propagates downstream', () => {
  it('regenerates the chamfer when the upstream extrude depth changes (10 -> 25)', () => {
    const tree1 = chamferRefTree(10);
    const r1 = replayTree(tree1);

    expect([...downstreamOf(tree1, 'f1')]).toEqual(['f2']);

    const tree2 = applyEdit(tree1, {
      type: 'set_payload',
      nodeId: 'f1',
      payload: box(25),
    });
    const r2 = incrementalReplay(r1, tree1, tree2);

    expect(r1.perNode.get('f1') !== r2.perNode.get('f1')).toBe(true);
    expect(r1.perNode.get('f2') !== r2.perNode.get('f2')).toBe(true);

    // Not merely "different text" — the core cube tracks depth - 2d exactly.
    expect(coreDepthOf(r1.perNode.get('f2')!)).toBe(10 - 4);
    expect(coreDepthOf(r2.perNode.get('f2')!)).toBe(25 - 4);
  });

  it('propagates through the variable-distance (Phase 3) path too', () => {
    const e = box(10);
    const payload = buildChamferFeatureRef('f1', e, {
      distance: 2,
      edgeSelection: 'top',
      vertexDistances: [1, 2, 1, 2],
    });
    const tree1: FeatureTree = {
      nodes: [node('f1', [], e), node('f2', ['f1'], payload)],
    };
    const tree2 = applyEdit(tree1, { type: 'set_payload', nodeId: 'f1', payload: box(25) });

    // The variable path places the crown at depth - d_i; the slab at depth - maxD.
    expect(replayTree(tree1).perNode.get('f2')).toContain(', 8]);'); // 10 - maxD(2)
    expect(replayTree(tree2).perNode.get('f2')).toContain(', 23]);'); // 25 - maxD(2)
  });

  it('full replay agrees with incremental replay after the edit', () => {
    const tree1 = chamferRefTree(10);
    const tree2 = applyEdit(tree1, { type: 'set_payload', nodeId: 'f1', payload: box(25) });
    const inc = incrementalReplay(replayTree(tree1), tree1, tree2);
    expect(inc.scad).toBe(replayTree(tree2).scad);
  });

  it('consumes the referenced body — no sharp box emitted beside the bevelled one', () => {
    const r = replayTree(chamferRefTree(10));
    expect(r.emittedOrder).toEqual(['f2']);
    expect(upstreamRefsOf(chamferRefTree(10).nodes[1]!.payload)).toEqual(['f1']);
  });

  it('legacy embedded chamfer still emits, and still does NOT follow upstream', () => {
    const e = box(10);
    const tree1: FeatureTree = {
      nodes: [node('f1', [], e), node('f2', ['f1'], buildChamferFeature(e, 2, 'all'))],
    };
    const tree2 = applyEdit(tree1, { type: 'set_payload', nodeId: 'f1', payload: box(25) });
    // Intentional pin: conversion is per-node and opt-in, so an unconverted
    // node must behave exactly as before (both bodies top-level, no tracking).
    expect(coreDepthOf(replayTree(tree2).perNode.get('f2')!)).toBe(10 - 4);
    expect(replayTree(tree1).emittedOrder).toEqual(['f1', 'f2']);
  });

  it('refuses to emit a ref-mode chamfer without a tree context', () => {
    const payload = buildChamferFeatureRef('f1', box(10), 2, 'all');
    expect(() => chamferToScad(payload)).toThrow(/without a tree context/);
    expect(() => chamferToScad(payload)).toThrow(/Refusing to fall back/);
  });

  it('refuses an undeclared ref, a missing node, and a wrong-kind upstream', () => {
    const e = box(10);
    const ref = buildChamferFeatureRef('f1', e, 2, 'all');

    // ref not declared in dependencies -> refs ⊆ dependencies invariant
    expect(() =>
      replayTree({ nodes: [node('f1', [], e), node('f2', [], ref)] }),
    ).toThrow(FeatureTreeError);

    // ref names a node that is not in the tree
    expect(() =>
      replayTree({ nodes: [node('f2', ['ghost'], buildChamferFeatureRef('ghost', e, 2, 'all'))] }),
    ).toThrow(FeatureTreeError);

    // upstream is the wrong kind — chamfer needs extrude parameters
    const rev: RevolveFeature = {
      kind: 'revolve',
      loop: [{ x: 1, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 1, y: 2 }],
      angleDegrees: 360,
      mode: 'add',
    };
    expect(() =>
      replayTree({ nodes: [node('f1', [], rev), node('f2', ['f1'], ref)] }),
    ).toThrow(/requires upstream f1 to be a 'extrude' feature, but it is 'revolve'/);
  });

  it('cascades suppression from the upstream body to the chamfer', () => {
    const tree = chamferRefTree(10);
    const suppressed: FeatureTree = {
      nodes: [{ ...tree.nodes[0]!, suppressed: true }, tree.nodes[1]!],
    };
    const r = replayTree(suppressed);
    expect(r.autoSuppressed).toEqual(['f2']);
    expect(r.scad).toBe('');
  });

  it('syncEmbeddedSnapshots refreshes the chamfer snapshot for legacy consumers', () => {
    const tree1 = chamferRefTree(10);
    const tree2 = applyEdit(tree1, { type: 'set_payload', nodeId: 'f1', payload: box(25) });
    const synced = syncEmbeddedSnapshots(tree2);
    const p = synced.nodes[1]!.payload as { childExtrude: ExtrudeFeature };
    expect(p.childExtrude.depth).toBe(25);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// patterns — requireScad (design note §2.2)
// ══════════════════════════════════════════════════════════════════════════

const LINEAR_OPTS = {
  childScad: 'STALE_SNAPSHOT();',
  count: 3,
  direction: { x: 1, y: 0, z: 0 },
  spacing: 30,
};

describe('W2-A linear_pattern — upstream edit propagates downstream', () => {
  function tree(depth: number): FeatureTree {
    return {
      nodes: [
        node('f1', [], box(depth), 'seed'),
        node('p1', ['f1'], buildLinearPatternRef('f1', LINEAR_OPTS), 'row'),
      ],
    };
  }

  it('stamps the LIVE seed body, and follows it when the seed depth changes', () => {
    const tree1 = tree(10);
    const r1 = replayTree(tree1);
    const tree2 = applyEdit(tree1, { type: 'set_payload', nodeId: 'f1', payload: box(25) });
    const r2 = incrementalReplay(r1, tree1, tree2);

    expect(r1.perNode.get('p1') !== r2.perNode.get('p1')).toBe(true);

    // The stamped instance carries the new extrude height, not the old one.
    expect(r1.perNode.get('p1')!).toContain('linear_extrude(height=10');
    expect(r2.perNode.get('p1')!).toContain('linear_extrude(height=25');
    expect(r2.perNode.get('p1')!).not.toContain('height=10');

    // ...and never the stale snapshot text the payload still physically holds.
    expect(r2.perNode.get('p1')!).not.toContain('STALE_SNAPSHOT');
  });

  it('full replay agrees with incremental replay, and the seed is consumed', () => {
    const tree1 = tree(10);
    const tree2 = applyEdit(tree1, { type: 'set_payload', nodeId: 'f1', payload: box(25) });
    expect(incrementalReplay(replayTree(tree1), tree1, tree2).scad).toBe(
      replayTree(tree2).scad,
    );
    expect(replayTree(tree1).emittedOrder).toEqual(['p1']);
  });

  it('legacy embedded pattern still emits its snapshot verbatim', () => {
    const tree1: FeatureTree = {
      nodes: [
        node('f1', [], box(10)),
        node('p1', ['f1'], buildLinearPattern(LINEAR_OPTS)),
      ],
    };
    const r = replayTree(tree1);
    expect(r.perNode.get('p1')!).toContain('STALE_SNAPSHOT');
    expect(r.emittedOrder).toEqual(['f1', 'p1']); // no ref -> nothing consumed
  });

  it('refuses to emit a ref-mode pattern without a tree context', () => {
    const p = buildLinearPatternRef('f1', LINEAR_OPTS);
    expect(() => linearPatternToScad(p)).toThrow(/without a tree context/);
    expect(() => linearPatternToScad(p)).toThrow(/Refusing to fall back/);
  });

  it('refuses an undeclared ref', () => {
    expect(() =>
      replayTree({
        nodes: [node('f1', [], box(10)), node('p1', [], buildLinearPatternRef('f1', LINEAR_OPTS))],
      }),
    ).toThrow(FeatureTreeError);
  });

  it('rejects an empty childId at build time', () => {
    expect(() => buildLinearPatternRef('', LINEAR_OPTS)).toThrow(/non-empty string/);
  });

  it('requireScad is kind-agnostic — a pattern can stamp a non-extrude seed', () => {
    // This is the capability `requirePayload` cannot offer: fillet/chamfer
    // pin their upstream to 'extrude', a pattern replicates ANY body. It
    // restores the pattern feature's founding promise.
    const rev: RevolveFeature = {
      kind: 'revolve',
      loop: [{ x: 1, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 1, y: 2 }],
      angleDegrees: 360,
      mode: 'add',
    };
    const t: FeatureTree = {
      nodes: [node('f1', [], rev), node('p1', ['f1'], buildLinearPatternRef('f1', LINEAR_OPTS))],
    };
    const r = replayTree(t);
    expect(r.perNode.get('p1')!).toContain(r.perNode.get('f1')!.split('\n')[0]!.trim());
  });

  it('propagates two hops: extrude -> fillet -> pattern', () => {
    const e10 = box(10);
    const tree1: FeatureTree = {
      nodes: [
        node('f1', [], e10),
        node('f2', ['f1'], buildFilletFeatureRef('f1', e10, 2, 'all')),
        node('p1', ['f2'], buildLinearPatternRef('f2', LINEAR_OPTS)),
      ],
    };
    const tree2 = applyEdit(tree1, { type: 'set_payload', nodeId: 'f1', payload: box(25) });

    expect([...downstreamOf(tree1, 'f1')].sort()).toEqual(['f2', 'p1']);

    // The pattern stamps a filleted box whose core tracks depth - 2r, two
    // links away from the node that was actually edited.
    expect(coreDepthOf(replayTree(tree1).perNode.get('p1')!)).toBe(10 - 4);
    expect(coreDepthOf(replayTree(tree2).perNode.get('p1')!)).toBe(25 - 4);
    expect(replayTree(tree1).emittedOrder).toEqual(['p1']);
  });
});

describe('W2-A circular_pattern — upstream edit propagates downstream', () => {
  const CIRC_OPTS = {
    childScad: 'STALE_SNAPSHOT();',
    count: 6,
    axisOrigin: { x: 0, y: 0, z: 0 },
    axisDirection: { x: 0, y: 0, z: 1 },
  };

  function tree(depth: number): FeatureTree {
    return {
      nodes: [
        node('f1', [], box(depth), 'seed'),
        node('c1', ['f1'], buildCircularPatternRef('f1', CIRC_OPTS), 'ring'),
      ],
    };
  }

  it('follows the seed when its depth changes (10 -> 25)', () => {
    const tree1 = tree(10);
    const r1 = replayTree(tree1);
    const tree2 = applyEdit(tree1, { type: 'set_payload', nodeId: 'f1', payload: box(25) });
    const r2 = incrementalReplay(r1, tree1, tree2);

    expect(r1.perNode.get('c1')!).toContain('linear_extrude(height=10');
    expect(r2.perNode.get('c1')!).toContain('linear_extrude(height=25');
    expect(r2.perNode.get('c1')!).not.toContain('STALE_SNAPSHOT');
    expect(r2.scad).toBe(replayTree(tree2).scad);
  });

  it('refuses to emit without a tree context, and cascades suppression', () => {
    expect(() => circularPatternToScad(buildCircularPatternRef('f1', CIRC_OPTS))).toThrow(
      /without a tree context/,
    );
    const t = tree(10);
    const s: FeatureTree = { nodes: [{ ...t.nodes[0]!, suppressed: true }, t.nodes[1]!] };
    expect(replayTree(s).autoSuppressed).toEqual(['c1']);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// hole / rib — deliberately NOT converted
// ══════════════════════════════════════════════════════════════════════════

/**
 * W2-A judgement: hole and rib do NOT get a host `childId`.
 *
 * Both are self-contained TOOL BODIES. A hole's bore geometry is fixed by
 * its own center/diameter/depth and a rib's wall by its own centerline —
 * neither reads a single parameter from a host, so a host reference could
 * not make anything "follow" an upstream edit. The only effect would be to
 * re-read the host's rendered SCAD and combine it, which is exactly what
 * `boolean` already does, by reference, with tests.
 *
 * Composing them through `boolean` therefore gives full downstream
 * regeneration today — proved below — with no new reference machinery.
 */
describe('W2-A hole / rib — leaves, composed through boolean', () => {
  const hole = buildHoleFeature({
    center: { x: 10, y: 10 },
    holeType: 'drilled',
    diameter: 5,
    depth: 30,
  });
  const rib = buildRib({
    start: { x: 0, y: 10 },
    end: { x: 20, y: 10 },
    thickness: 3,
    height: 8,
  });

  it('carry no upstream refs (they are leaves, as W2-0 catalogued)', () => {
    expect(upstreamRefsOf(hole)).toEqual([]);
    expect(upstreamRefsOf(rib)).toEqual([]);
  });

  it('boolean difference(body, hole) regenerates when the body changes', () => {
    const tree1: FeatureTree = {
      nodes: [
        node('f1', [], box(10), 'plate'),
        node('h1', [], hole, 'bore'),
        node('b1', ['f1', 'h1'], { kind: 'boolean', op: 'difference', bodies: ['f1', 'h1'] }),
      ],
    };
    const tree2 = applyEdit(tree1, { type: 'set_payload', nodeId: 'f1', payload: box(25) });

    expect([...downstreamOf(tree1, 'f1')]).toEqual(['b1']);
    const r1 = replayTree(tree1);
    const r2 = incrementalReplay(r1, tree1, tree2);

    expect(r1.perNode.get('b1')!).toContain('linear_extrude(height=10');
    expect(r2.perNode.get('b1')!).toContain('linear_extrude(height=25');
    // Operands are consumed; only the combined body is emitted.
    expect(r1.emittedOrder).toEqual(['b1']);
  });

  it('boolean union(body, rib) regenerates when the body changes', () => {
    const tree1: FeatureTree = {
      nodes: [
        node('f1', [], box(10), 'plate'),
        node('r1', [], rib, 'stiffener'),
        node('b1', ['f1', 'r1'], { kind: 'boolean', op: 'union', bodies: ['f1', 'r1'] }),
      ],
    };
    const tree2 = applyEdit(tree1, { type: 'set_payload', nodeId: 'f1', payload: box(25) });
    expect(replayTree(tree1).perNode.get('b1')!).toContain('linear_extrude(height=10');
    expect(replayTree(tree2).perNode.get('b1')!).toContain('linear_extrude(height=25');
  });

  it("boolean's existing bodies[] form satisfies the generalised refs ⊆ deps invariant", () => {
    const payload: FeaturePayload = { kind: 'boolean', op: 'union', bodies: ['f1', 'r1'] };
    expect(upstreamRefsOf(payload)).toEqual(['f1', 'r1']);
    // Declaring the operands is now mandatory, not merely conventional.
    expect(() =>
      replayTree({
        nodes: [node('f1', [], box(10)), node('r1', [], rib), node('b1', ['f1'], payload)],
      }),
    ).toThrow(FeatureTreeError);
  });
});
