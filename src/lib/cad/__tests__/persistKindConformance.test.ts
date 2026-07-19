/**
 * F15 — cross-module conformance between `FeatureKind` and the persistence
 * validator.
 *
 * The defect this locks down: `boolean`, `rib` and `sweep_path` were members
 * of `FeatureKind`, were rendered by `replayTree`, and were rejected by
 * `deserializeFeatureTree`. A model with a hole in it (boolean difference)
 * displayed correctly and could not be saved.
 *
 * Two levels of guard:
 *   1. set-level — every FeatureKind is a KNOWN_KIND (catches a kind added
 *      to the union but not to the persistence table);
 *   2. round-trip — one representative payload per kind actually survives
 *      serialize → deserialize (catches a kind that is *listed* but whose
 *      per-kind field checks reject its own canonical shape).
 *
 * (1) alone is not enough: a kind can be admitted at the `kind` gate and
 * still fail its field checks, which is a save failure by another name.
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_FEATURE_KINDS,
  upstreamRefsOf,
  type FeatureKind,
  type FeaturePayload,
  type FeatureTree,
} from '../featureTree';
import {
  KNOWN_KINDS,
  serializeFeatureTree,
  deserializeFeatureTree,
} from '../featureTreePersist';

const SQUARE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

/**
 * One canonical, minimally-valid payload per kind. Written as literals
 * rather than produced by the builders on purpose: the builders are the
 * thing a corrupt save bypasses, so the persistence layer must be probed
 * with raw IR shapes.
 *
 * Typed as a total Record so a new FeatureKind cannot be added without a
 * sample appearing here too.
 */
const SAMPLES: Record<FeatureKind, FeaturePayload> = {
  extrude: {
    kind: 'extrude',
    loop: SQUARE,
    depth: 10,
    direction: 'one_sided',
    mode: 'add',
  } as FeaturePayload,
  revolve: {
    kind: 'revolve',
    loop: SQUARE,
    angleDegrees: 360,
    mode: 'add',
  } as FeaturePayload,
  sweep: {
    kind: 'sweep',
    profile: { points: SQUARE },
    path: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 50 },
    ],
    mode: 'add',
  } as FeaturePayload,
  loft: {
    kind: 'loft',
    sections: [
      { profile: { points: SQUARE }, z: 0 },
      { profile: { points: SQUARE }, z: 20 },
    ],
    mode: 'add',
  } as FeaturePayload,
  linear_pattern: {
    kind: 'linear_pattern',
    childScad: 'cube([1,1,1]);',
    count: 3,
    direction: { x: 1, y: 0, z: 0 },
    spacing: 30,
  } as FeaturePayload,
  circular_pattern: {
    kind: 'circular_pattern',
    childScad: 'cube([1,1,1]);',
    count: 4,
    axisOrigin: { x: 0, y: 0, z: 0 },
    axisDirection: { x: 0, y: 0, z: 1 },
    totalAngleDegrees: 360,
  } as FeaturePayload,
  hole: {
    kind: 'hole',
    center: { x: 5, y: 5 },
    holeType: 'drilled',
    diameter: 4,
    depth: 10,
  } as FeaturePayload,
  fillet: {
    kind: 'fillet',
    childExtrude: {
      kind: 'extrude',
      loop: SQUARE,
      depth: 10,
      direction: 'one_sided',
      mode: 'add',
    },
    radius: 2,
    edgeSelection: 'vertical',
  } as FeaturePayload,
  chamfer: {
    kind: 'chamfer',
    childExtrude: {
      kind: 'extrude',
      loop: SQUARE,
      depth: 10,
      direction: 'one_sided',
      mode: 'add',
    },
    distance: 2,
    edgeSelection: 'vertical',
  } as FeaturePayload,
  rib: {
    kind: 'rib',
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
    thickness: 3,
    height: 8,
  } as FeaturePayload,
  sweep_path: {
    kind: 'sweep_path',
    profile: SQUARE,
    path: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 50 },
    ],
  } as FeaturePayload,
  boolean: {
    kind: 'boolean',
    op: 'difference',
    bodies: ['a', 'b'],
  } as FeaturePayload,
};

describe('F15 — every FeatureKind is persistable', () => {
  it('KNOWN_KINDS covers the whole FeatureKind union', () => {
    const missing = ALL_FEATURE_KINDS.filter((k) => !KNOWN_KINDS.has(k));
    expect(missing).toEqual([]);
  });

  it('KNOWN_KINDS contains no kind that FeatureKind does not declare', () => {
    const extra = [...KNOWN_KINDS].filter((k) => !ALL_FEATURE_KINDS.includes(k));
    expect(extra).toEqual([]);
  });

  it.each(ALL_FEATURE_KINDS)('round-trips a %s payload', (kind) => {
    // The node under test, plus whatever upstream nodes its payload names.
    // `upstreamRefsOf` derives those from the payload itself so this stays
    // correct as more kinds convert from embedded snapshots to refs (W2-A);
    // without it, `boolean` fails validateTree's declared-dependency rule for
    // a reason that has nothing to do with the payload schema being tested.
    const refs = upstreamRefsOf(SAMPLES[kind]);
    const tree: FeatureTree = {
      nodes: [
        ...refs.map((id) => ({
          id,
          name: `upstream ${id}`,
          dependencies: [] as string[],
          payload: SAMPLES.extrude,
        })),
        { id: 'n1', name: kind, dependencies: refs, payload: SAMPLES[kind] },
      ],
    };
    const back = deserializeFeatureTree(serializeFeatureTree(tree));
    if (!back.ok) {
      throw new Error(`${kind} failed to round-trip: ${back.error} — ${back.message}`);
    }
    const under = back.tree.nodes.find((n) => n.id === 'n1')!;
    expect(under.payload).toEqual(SAMPLES[kind]);
  });
});

describe('F15 — the boolean tree from the bracket dogfood saves', () => {
  it('serialize → deserialize preserves a difference over two upstream bodies', () => {
    const tree: FeatureTree = {
      nodes: [
        { id: 'plate', name: 'Plate', dependencies: [], payload: SAMPLES.extrude },
        { id: 'hole', name: 'Hole', dependencies: [], payload: SAMPLES.hole },
        {
          id: 'cut',
          name: 'Cut',
          dependencies: ['plate', 'hole'],
          payload: {
            kind: 'boolean',
            op: 'difference',
            bodies: ['plate', 'hole'],
          } as FeaturePayload,
        },
      ],
    };
    const back = deserializeFeatureTree(serializeFeatureTree(tree));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.tree).toEqual(tree);
  });

  it('still rejects a boolean whose bodies are not id strings', () => {
    const bad = JSON.stringify({
      version: 1,
      tree: {
        nodes: [
          {
            id: 'b',
            name: 'Bad',
            dependencies: [],
            payload: { kind: 'boolean', op: 'union', bodies: [{ inline: 'body' }] },
          },
        ],
      },
    });
    const res = deserializeFeatureTree(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('invalid_payload');
      expect(res.message).toContain('bodies[0]');
    }
  });

  it('still rejects an unknown kind', () => {
    const bad = JSON.stringify({
      version: 1,
      tree: {
        nodes: [
          { id: 'x', name: 'X', dependencies: [], payload: { kind: 'teleport' } },
        ],
      },
    });
    const res = deserializeFeatureTree(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('not a known FeatureKind');
  });
});
