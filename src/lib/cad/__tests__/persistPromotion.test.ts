/**
 * W2-B — promoting saved trees from embedded snapshots to upstream refs.
 *
 * Every fixture here goes through the REAL persistence path
 * (`serializeFeatureTree` -> JSON string -> `deserializeFeatureTree*`), so
 * what is being tested is what a user's localStorage blob actually does on
 * load, not an in-memory approximation of it.
 *
 * Three properties are pinned:
 *   1. the promotion RULE — both the promotable and the un-promotable side,
 *      with the un-promotable side leaving a reason behind;
 *   2. ZERO LOSS — save/load round-trips are exact, with and without
 *      promotion, and promotion is a fixed point;
 *   3. FUNCTIONAL success — a promoted tree actually regenerates when its
 *      upstream is edited (promotion that is only structural is worthless).
 */
import { describe, it, expect } from 'vitest';
import {
  serializeFeatureTree,
  deserializeFeatureTree,
  deserializeFeatureTreeWithPromotion,
} from '../featureTreePersist';
import {
  promoteEmbeddedRefs,
  formatPromotionReport,
  SNAPSHOT_KINDS,
  REF_AWARE_EMITTERS,
} from '../featureTreeMigrate';
import {
  replayTree,
  validateTree,
  type FeatureTree,
  type FeatureNode,
  type FeatureKind,
  type FeaturePayload,
} from '../featureTree';
import { applyEdit, incrementalReplay } from '../featureTreeEdit';
import type { ExtrudeFeature } from '../extrudeProfile';
import {
  buildFilletFeature,
  buildFilletFeatureRef,
  filletToScad,
  type FilletFeature,
} from '../filletProfile';
import { buildChamferFeature, buildChamferFeatureRef } from '../chamferProfile';
import { buildShellFeatureRef } from '../shellProfile';

// ─── fixtures ─────────────────────────────────────────────────────────────

const box = (depth: number, size = 20): ExtrudeFeature => ({
  kind: 'extrude',
  loop: [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ],
  depth,
  direction: 'one_sided',
  mode: 'add',
});

const ext = (id: string, depth: number, size = 20): FeatureNode => ({
  id,
  name: `body ${id}`,
  dependencies: [],
  payload: box(depth, size),
});

/** Legacy (pre-W2-0) fillet: embedded snapshot, no childId. */
const legacyFillet = (
  id: string,
  deps: string[],
  snapshot: ExtrudeFeature,
  radius = 2,
): FeatureNode => ({
  id,
  name: `round ${id}`,
  dependencies: deps,
  payload: buildFilletFeature(snapshot, radius, 'all'),
});

/** Save a tree the way the editor does, then read it back the way a load does. */
function roundTrip(tree: FeatureTree): FeatureTree {
  const res = deserializeFeatureTree(serializeFeatureTree(tree));
  if (!res.ok) throw new Error(`deserialize failed: ${res.error} ${res.message}`);
  return res.tree;
}

function loadPromoted(tree: FeatureTree) {
  const res = deserializeFeatureTreeWithPromotion(serializeFeatureTree(tree));
  if (!res.ok) throw new Error(`deserialize failed: ${res.error} ${res.message}`);
  return res;
}

/** Z extent of the minkowski core cube in an 'all' fillet body. */
function coreDepthOf(scad: string): number {
  const m = scad.match(/cube\(\[[\d.]+, [\d.]+, ([\d.]+)\]\)/);
  if (!m) throw new Error(`no core cube in:\n${scad}`);
  return Number(m[1]);
}

function childIdOf(tree: FeatureTree, id: string): string | undefined {
  const n = tree.nodes.find((x) => x.id === id);
  return (n?.payload as { childId?: string } | undefined)?.childId;
}

// ─── 1. the rule: promotable side ─────────────────────────────────────────

describe('W2-B promotion rule — promotable', () => {
  it('promotes a legacy fillet whose dependencies contain exactly one extrude', () => {
    const e = box(10);
    const saved: FeatureTree = { nodes: [ext('f1', 10), legacyFillet('f2', ['f1'], e)] };

    const { tree, promotion } = loadPromoted(saved);

    expect(promotion.promoted.map((p) => p.id)).toEqual(['f2']);
    expect(promotion.promoted[0].childId).toBe('f1');
    expect(promotion.skipped).toEqual([]);
    expect(childIdOf(tree, 'f2')).toBe('f1');
    // Promoted trees must still satisfy the refs-subset-of-dependencies
    // invariant, or replay would refuse them.
    expect(() => validateTree(tree)).not.toThrow();
  });

  it('leaves an already-referenced fillet untouched (no double promotion)', () => {
    const e = box(10);
    const saved: FeatureTree = {
      nodes: [
        ext('f1', 10),
        { id: 'f2', name: 'round', dependencies: ['f1'], payload: buildFilletFeatureRef('f1', e, 2, 'all') },
      ],
    };

    const { tree, promotion } = loadPromoted(saved);

    expect(promotion.promoted).toEqual([]);
    expect(promotion.alreadyRef).toEqual(['f2']);
    expect(childIdOf(tree, 'f2')).toBe('f1');
  });

  it('reports a diverged snapshot — the node whose geometry will visibly change', () => {
    // Saved under the pre-W2-0 bug: upstream was later edited to depth 25,
    // but the fillet's embedded copy never followed (it still says 10).
    const saved: FeatureTree = { nodes: [ext('f1', 25), legacyFillet('f2', ['f1'], box(10))] };
    const { promotion } = loadPromoted(saved);
    expect(promotion.promoted[0].snapshotDiverged).toBe(true);

    // ...and a fillet whose copy was still in sync is reported as such.
    const clean: FeatureTree = { nodes: [ext('g1', 10), legacyFillet('g2', ['g1'], box(10))] };
    expect(loadPromoted(clean).promotion.promoted[0].snapshotDiverged).toBe(false);
  });
});

// ─── 2. the rule: un-promotable side, with reasons ────────────────────────

describe('W2-B promotion rule — refuses to guess, and says why', () => {
  it('skips a fillet with NO extrude dependency', () => {
    const saved: FeatureTree = { nodes: [legacyFillet('f2', [], box(10))] };
    const { tree, promotion } = loadPromoted(saved);

    expect(promotion.promoted).toEqual([]);
    expect(promotion.skipped).toHaveLength(1);
    expect(promotion.skipped[0].reason).toBe('no_extrude_dependency');
    expect(promotion.skipped[0].id).toBe('f2');
    expect(promotion.skipped[0].message).toMatch(/no extrude dependency/i);
    expect(childIdOf(tree, 'f2')).toBeUndefined();
  });

  it('skips a fillet with TWO extrude dependencies rather than picking one', () => {
    const saved: FeatureTree = {
      nodes: [ext('a', 10), ext('b', 30, 40), legacyFillet('f2', ['a', 'b'], box(10))],
    };
    const { tree, promotion } = loadPromoted(saved);

    expect(promotion.promoted).toEqual([]);
    expect(promotion.skipped[0].reason).toBe('ambiguous_extrude_dependencies');
    expect(promotion.skipped[0].candidates).toEqual(['a', 'b']);
    expect(childIdOf(tree, 'f2')).toBeUndefined();
  });

  it('does NOT prefer the extrude whose geometry matches the stale snapshot', () => {
    // 'b' is byte-identical to the embedded snapshot, 'a' is not. Under the
    // pre-W2-0 bug a snapshot that disagrees with its true parent is the
    // EXPECTED state, so similarity is not evidence — a tie-break on it
    // would systematically pick the least-edited node. Stay ambiguous.
    const snapshot = box(10);
    const saved: FeatureTree = {
      nodes: [ext('a', 25), ext('b', 10), legacyFillet('f2', ['a', 'b'], snapshot)],
    };
    const { promotion } = loadPromoted(saved);
    expect(promotion.promoted).toEqual([]);
    expect(promotion.skipped[0].reason).toBe('ambiguous_extrude_dependencies');
  });

  it('skips an unambiguous node whose emitter cannot follow a reference', () => {
    // Every snapshot-carrying kind currently in the codebase IS ref-aware,
    // so this branch is driven through the capability override rather than
    // left untested. It is the branch that protects a kind mid-conversion:
    // giving it a childId would change what replayTree emits (the upstream
    // becomes 'consumed') while its emitter still read the stale snapshot.
    const e = box(10);
    const saved: FeatureTree = {
      nodes: [
        ext('f1', 10),
        { id: 'f2', name: 'bevel', dependencies: ['f1'], payload: buildChamferFeature(e, 1, 'all') },
      ],
    };
    const loaded = roundTrip(saved);
    const { tree, report: promotion } = promoteEmbeddedRefs(loaded, {
      refAwareKinds: new Set<FeatureKind>(['fillet']),
    });

    expect(promotion.promoted).toEqual([]);
    expect(promotion.skipped[0].reason).toBe('emitter_not_ref_aware');
    expect(promotion.skipped[0].candidates).toEqual(['f1']);
    expect(childIdOf(tree, 'f2')).toBeUndefined();
    // Refusing to promote must leave the node untouched, identity included.
    expect(tree.nodes[1]).toBe(loaded.nodes[1]);
  });

  it('the ref-aware capability list is verified by execution, not asserted', () => {
    // REF_AWARE_EMITTERS is a claim about OTHER modules' emitters. Probe
    // each snapshot-carrying kind for real: build it in reference mode,
    // edit the upstream, and see whether the emitted body actually moves.
    // If a later wave converts a kind (or regresses one), this fails and
    // forces the constant to be corrected — the promotion rule must never
    // out-run what the emitters can do.
    const refNode = (kind: FeatureKind, childId: string, snap: ExtrudeFeature): FeaturePayload => {
      if (kind === 'fillet') return buildFilletFeatureRef(childId, snap, 2, 'all');
      if (kind === 'chamfer') return buildChamferFeatureRef(childId, snap, 1, 'all');
      if (kind === 'shell') return buildShellFeatureRef(childId, snap, 1, { openTopFace: true });
      throw new Error(`no ref builder known for kind '${kind}' — extend this probe`);
    };

    for (const kind of SNAPSHOT_KINDS) {
      const snap = box(10);
      const tree: FeatureTree = {
        nodes: [
          ext('u', 10),
          { id: 'd', name: 'downstream', dependencies: ['u'], payload: refNode(kind, 'u', snap) },
        ],
      };
      const before = replayTree(tree).perNode.get('d')!;
      const after = replayTree(
        applyEdit(tree, { type: 'set_payload', nodeId: 'u', payload: box(25) }),
      ).perNode.get('d')!;

      const followsUpstream = before !== after;
      expect(
        followsUpstream,
        `kind '${kind}': emitter ${followsUpstream ? 'DOES' : 'does NOT'} follow upstream, ` +
          `but REF_AWARE_EMITTERS says ${REF_AWARE_EMITTERS.has(kind)}`,
      ).toBe(REF_AWARE_EMITTERS.has(kind));
    }
  });

  it('promotes an unambiguous chamfer now that its emitter is ref-aware', () => {
    const saved: FeatureTree = {
      nodes: [
        ext('f1', 10),
        { id: 'f2', name: 'bevel', dependencies: ['f1'], payload: buildChamferFeature(box(10), 1, 'all') },
      ],
    };
    const { tree, promotion } = loadPromoted(saved);
    expect(promotion.promoted.map((p) => p.id)).toEqual(['f2']);
    expect(childIdOf(tree, 'f2')).toBe('f1');

    // ...and functionally: it follows an upstream edit.
    const r1 = replayTree(tree);
    const edited = applyEdit(tree, { type: 'set_payload', nodeId: 'f1', payload: box(25) });
    expect(replayTree(edited).perNode.get('f2')).not.toBe(r1.perNode.get('f2'));
  });

  it('reports a pattern as un-promotable rather than ignoring it', () => {
    const saved: FeatureTree = {
      nodes: [
        {
          id: 'p1',
          name: 'row',
          dependencies: [],
          payload: {
            kind: 'linear_pattern',
            childScad: 'cube([1, 1, 1]);',
            count: 3,
            direction: { x: 1, y: 0, z: 0 },
            spacing: 5,
          },
        } as FeatureNode,
      ],
    };
    const { promotion } = loadPromoted(saved);
    expect(promotion.skipped[0].reason).toBe('no_promotion_rule');
    expect(promotion.skipped[0].id).toBe('p1');
  });

  it('never silently drops a skipped node: the report accounts for every candidate', () => {
    const saved: FeatureTree = {
      nodes: [
        ext('f1', 10),
        legacyFillet('ok', ['f1'], box(10)),
        legacyFillet('orphan', [], box(10)),
        ext('a', 12),
        legacyFillet('ambig', ['f1', 'a'], box(10)),
      ],
    };
    const { promotion } = loadPromoted(saved);

    expect(promotion.considered).toBe(3);
    expect(promotion.promoted.map((p) => p.id)).toEqual(['ok']);
    expect(promotion.skipped.map((s) => s.id).sort()).toEqual(['ambig', 'orphan']);

    // The user-facing rendering names every non-parametric feature.
    const text = formatPromotionReport(promotion);
    expect(text).toContain('1/3 parametric');
    expect(text).toContain('orphan');
    expect(text).toContain('ambig');
  });
});

// ─── 3. zero loss ─────────────────────────────────────────────────────────

describe('W2-B zero loss across save -> load -> save', () => {
  const corpus = (): Array<[string, FeatureTree]> => [
    ['promotable', { nodes: [ext('f1', 10), legacyFillet('f2', ['f1'], box(10))] }],
    ['orphan fillet', { nodes: [legacyFillet('f2', [], box(10))] }],
    ['ambiguous', { nodes: [ext('a', 10), ext('b', 12), legacyFillet('f2', ['a', 'b'], box(10))] }],
    [
      'chamfer',
      {
        nodes: [
          ext('f1', 10),
          { id: 'f2', name: 'bevel', dependencies: ['f1'], payload: buildChamferFeature(box(10), 1, 'all') },
        ],
      },
    ],
    [
      'already ref',
      {
        nodes: [
          ext('f1', 10),
          { id: 'f2', name: 'r', dependencies: ['f1'], payload: buildFilletFeatureRef('f1', box(10), 2, 'all') },
        ],
      },
    ],
    [
      'suppressed flag survives',
      {
        nodes: [
          ext('f1', 10),
          { ...legacyFillet('f2', ['f1'], box(10)), suppressed: true } as FeatureNode,
        ],
      },
    ],
  ];

  it.each(corpus())('plain round-trip is the identity: %s', (_name, tree) => {
    expect(roundTrip(tree)).toEqual(tree);
  });

  it.each(corpus())('promoted load loses nothing outside childId/snapshot: %s', (_name, tree) => {
    const { tree: loaded } = loadPromoted(tree);
    expect(loaded.nodes).toHaveLength(tree.nodes.length);

    for (let i = 0; i < tree.nodes.length; i++) {
      const before = tree.nodes[i];
      const after = loaded.nodes[i];
      expect(after.id).toBe(before.id);
      expect(after.name).toBe(before.name);
      expect(after.dependencies).toEqual(before.dependencies);
      expect(after.suppressed).toEqual(before.suppressed);

      // Every payload field the file carried is still there and unchanged,
      // except `childExtrude` (deliberately re-synced) and `childId`
      // (deliberately added). Nothing else may move.
      const b = before.payload as unknown as Record<string, unknown>;
      const a = after.payload as unknown as Record<string, unknown>;
      for (const k of Object.keys(b)) {
        if (k === 'childExtrude') continue;
        expect(a[k]).toEqual(b[k]);
      }
      const added = Object.keys(a).filter((k) => !(k in b));
      expect(added.every((k) => k === 'childId')).toBe(true);
    }
  });

  it.each(corpus())('promotion is a fixed point under a second save/load: %s', (_name, tree) => {
    const once = loadPromoted(tree).tree;
    const twice = loadPromoted(once).tree;
    expect(twice).toEqual(once);
    // ...and the second pass finds nothing left to promote.
    expect(loadPromoted(once).promotion.promoted).toEqual([]);
  });

  it('skipped nodes are passed through by reference (diffTrees sees no change)', () => {
    const tree: FeatureTree = {
      nodes: [ext('a', 10), ext('b', 12), legacyFillet('f2', ['a', 'b'], box(10))],
    };
    const { tree: after } = promoteEmbeddedRefs(tree);
    expect(after).toBe(tree);
    expect(after.nodes[2]).toBe(tree.nodes[2]);
  });

  it('an unresolvable reference is reported, not thrown, and the tree survives', () => {
    // childId points at a node that is not an extrude: syncEmbeddedSnapshots
    // would throw. Losing the user's file to an exception is worse than
    // returning it unsynced.
    const bad: FeatureTree = {
      nodes: [
        { id: 'r1', name: 'rev', dependencies: [], payload: { kind: 'revolve', loop: box(10).loop, angleDegrees: 360, mode: 'add' } } as FeatureNode,
        { id: 'f2', name: 'r', dependencies: ['r1'], payload: { ...buildFilletFeature(box(10), 2, 'all'), childId: 'r1' } } as FeatureNode,
      ],
    };
    const { tree, report } = promoteEmbeddedRefs(bad);
    expect(report.syncSkippedReason).toMatch(/revolve/);
    expect(tree).toBe(bad);
  });
});

// ─── 4. functional success: does the promoted tree actually regenerate? ───

describe('W2-B promoted trees regenerate downstream', () => {
  it('a promoted legacy fillet follows an upstream depth edit (10 -> 25)', () => {
    const saved: FeatureTree = { nodes: [ext('f1', 10), legacyFillet('f2', ['f1'], box(10))] };
    const { tree: loaded } = loadPromoted(saved);

    const r1 = replayTree(loaded);
    expect(coreDepthOf(r1.perNode.get('f2')!)).toBe(10 - 4); // depth - 2r

    const edited = applyEdit(loaded, { type: 'set_payload', nodeId: 'f1', payload: box(25) });
    const r2 = incrementalReplay(r1, loaded, edited);

    expect(r2.perNode.get('f2')).not.toBe(r1.perNode.get('f2'));
    expect(coreDepthOf(r2.perNode.get('f2')!)).toBe(25 - 4);
    // Incremental must agree with a from-scratch replay.
    expect(r2.scad).toBe(replayTree(edited).scad);
  });

  it('a SKIPPED fillet still renders, and still does not follow (legacy behaviour intact)', () => {
    const saved: FeatureTree = {
      nodes: [ext('a', 10), ext('b', 12), legacyFillet('f2', ['a', 'b'], box(10))],
    };
    const { tree: loaded, promotion } = loadPromoted(saved);
    expect(promotion.skipped[0].reason).toBe('ambiguous_extrude_dependencies');

    const r1 = replayTree(loaded);
    expect(coreDepthOf(r1.perNode.get('f2')!)).toBe(10 - 4); // it OPENS and RENDERS

    const edited = applyEdit(loaded, { type: 'set_payload', nodeId: 'a', payload: box(25) });
    const r2 = replayTree(edited);
    expect(coreDepthOf(r2.perNode.get('f2')!)).toBe(10 - 4); // ...but is not parametric
  });

  it('promotion repairs a tree that had drifted under the pre-W2-0 bug', () => {
    // Upstream is depth 25; the stale copy says 10. Before promotion the
    // fillet renders the WRONG body; after promotion it renders the right one.
    const saved: FeatureTree = { nodes: [ext('f1', 25), legacyFillet('f2', ['f1'], box(10))] };

    expect(coreDepthOf(replayTree(roundTrip(saved)).perNode.get('f2')!)).toBe(10 - 4);
    expect(coreDepthOf(replayTree(loadPromoted(saved).tree).perNode.get('f2')!)).toBe(25 - 4);
  });
});

// ─── 5. measured promotion rate ───────────────────────────────────────────

describe('W2-B promotion rate over a synthetic corpus', () => {
  it('reports an exact, reproducible rate and reason distribution', () => {
    // NOTE ON WHAT THIS NUMBER MEANS: the corpus enumerates the STRUCTURAL
    // shapes a saved tree can present, one instance each. It is not weighted
    // by how often real users produce each shape, so the rate below is a
    // property of the rule, not a forecast for a real population. In a real
    // corpus the promotable shape dominates heavily (a fillet is normally
    // created against exactly one body), so the field rate should be higher.
    const e = box(10);
    const corpus: FeatureTree = {
      nodes: [
        ext('b1', 10),
        ext('b2', 12),
        ext('b3', 14),
        // promotable: single extrude dependency
        legacyFillet('p1', ['b1'], e),
        legacyFillet('p2', ['b2'], box(12)),
        { id: 'p3', name: 'bevel', dependencies: ['b3'], payload: buildChamferFeature(box(14), 1, 'all') } as FeatureNode,
        // already in reference mode
        { id: 'r1', name: 'ref', dependencies: ['b1'], payload: buildFilletFeatureRef('b1', e, 2, 'all') } as FeatureNode,
        // un-promotable: no extrude dependency
        legacyFillet('s1', [], e),
        // un-promotable: ambiguous
        legacyFillet('s2', ['b1', 'b2'], e),
        legacyFillet('s3', ['b1', 'b2', 'b3'], e),
        // un-promotable: upstream stored as rendered text
        {
          id: 's4',
          name: 'row',
          dependencies: [],
          payload: {
            kind: 'linear_pattern',
            childScad: 'cube([1, 1, 1]);',
            count: 3,
            direction: { x: 1, y: 0, z: 0 },
            spacing: 5,
          },
        } as FeatureNode,
      ],
    };

    const { promotion } = loadPromoted(corpus);

    expect(promotion.considered).toBe(8);
    expect(promotion.promoted).toHaveLength(3);
    expect(promotion.alreadyRef).toHaveLength(1);
    expect(promotion.skipped).toHaveLength(4);

    const byReason = promotion.skipped.reduce<Record<string, number>>((acc, s) => {
      acc[s.reason] = (acc[s.reason] ?? 0) + 1;
      return acc;
    }, {});
    expect(byReason).toEqual({
      no_extrude_dependency: 1,
      ambiguous_extrude_dependencies: 2,
      no_promotion_rule: 1,
    });

    // Of the 7 legacy (non-ref) candidates, 3 were promoted: 42.9%.
    const legacyCandidates = promotion.considered - promotion.alreadyRef.length;
    expect(legacyCandidates).toBe(7);
    expect(Math.round((promotion.promoted.length / legacyCandidates) * 1000) / 10).toBe(42.9);

    // Every node in the corpus is either parametric or has a stated reason —
    // nothing falls through the report unaccounted for.
    const accounted = new Set([
      ...promotion.promoted.map((p) => p.id),
      ...promotion.alreadyRef,
      ...promotion.skipped.map((s) => s.id),
    ]);
    const expectedIds = corpus.nodes
      .filter((n) => n.payload.kind !== 'extrude')
      .map((n) => n.id);
    expect([...accounted].sort()).toEqual(expectedIds.sort());
  });
});

// ─── 6. backward compatibility (both directions) ──────────────────────────

describe('W2-B backward compatibility — a pre-W2-0 reader still gets geometry', () => {
  it('a promoted file renders correctly for a reader that ignores childId', () => {
    // A pre-W2-0 reader does two things differently: its payload validator
    // requires `childExtrude` (still present -> the file loads), and its
    // emitter reads that snapshot instead of resolving `childId`. Promotion
    // re-syncs the snapshot precisely so that reader is CORRECT, not merely
    // non-crashing. This is why SCHEMA_VERSION stays at 1 and why
    // syncEmbeddedSnapshots must run as part of the pass.
    const saved: FeatureTree = { nodes: [ext('f1', 25), legacyFillet('f2', ['f1'], box(10))] };
    const { tree: promoted } = loadPromoted(saved);

    // The old file format contract still holds: childExtrude present, kind extrude.
    const p = promoted.nodes[1].payload as FilletFeature;
    expect(p.childExtrude.kind).toBe('extrude');
    expect(p.childExtrude.depth).toBe(25); // re-synced, no longer the stale 10
    expect(deserializeFeatureTree(serializeFeatureTree(promoted)).ok).toBe(true);

    // Emit the way an old reader does: no EmitContext, snapshot only.
    const oldReaderScad = filletToScad({ ...p, childId: undefined });
    expect(coreDepthOf(oldReaderScad)).toBe(25 - 4);
    // ...and it agrees with what the new reader produces.
    expect(coreDepthOf(replayTree(promoted).perNode.get('f2')!)).toBe(25 - 4);
  });
});
