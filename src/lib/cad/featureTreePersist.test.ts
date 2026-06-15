/**
 * featureTreePersist — round-trip + validation tests for all 9 payload kinds.
 *
 * Coverage targets:
 *   - empty tree round-trip
 *   - 9 FeaturePayload kinds round-trip individually
 *   - version mismatch (older / newer) → version_mismatch error
 *   - invalid JSON → invalid_json
 *   - missing required fields per kind → invalid_payload
 *   - validateTree failures (cycle / forward ref) → validate_tree_failed
 *   - large tree (100 nodes) round-trip stays stable
 *   - suppressed=true preserved
 *   - dependencies preserved
 */
import { describe, it, expect } from 'vitest';
import {
  SCHEMA_VERSION,
  serializeFeatureTree,
  deserializeFeatureTree,
} from './featureTreePersist';
import type { FeatureTree, FeatureNode, FeaturePayload } from './featureTree';

// ─── payload factories ────────────────────────────────────────────────────

const extrudePayload: FeaturePayload = {
  kind: 'extrude',
  loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }],
  depth: 3,
  direction: 'one_sided',
  mode: 'add',
};

const revolvePayload: FeaturePayload = {
  kind: 'revolve',
  loop: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 10 }, { x: 0, y: 10 }],
  angleDegrees: 360,
  mode: 'add',
};

const sweepPayload: FeaturePayload = {
  kind: 'sweep',
  profile: { points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }] },
  path: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }],
  mode: 'add',
};

const loftPayload: FeaturePayload = {
  kind: 'loft',
  sections: [
    { profile: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }] }, z: 0 },
    { profile: { points: [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 4 }, { x: 1, y: 4 }] }, z: 10 },
  ],
  mode: 'add',
};

const linearPatternPayload: FeaturePayload = {
  kind: 'linear_pattern',
  childScad: 'cube([1,1,1]);',
  count: 4,
  direction: { x: 1, y: 0, z: 0 },
  spacing: 5,
};

const circularPatternPayload: FeaturePayload = {
  kind: 'circular_pattern',
  childScad: 'cube([1,1,1]);',
  count: 6,
  axisOrigin: { x: 0, y: 0, z: 0 },
  axisDirection: { x: 0, y: 0, z: 1 },
  totalAngleDegrees: 360,
};

const holePayload: FeaturePayload = {
  kind: 'hole',
  center: { x: 5, y: 5 },
  holeType: 'drilled',
  diameter: 3,
  depth: 10,
};

const filletPayload: FeaturePayload = {
  kind: 'fillet',
  childExtrude: {
    kind: 'extrude',
    loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    depth: 5,
    direction: 'one_sided',
    mode: 'add',
  },
  radius: 1,
  edgeSelection: 'all',
};

const chamferPayload: FeaturePayload = {
  kind: 'chamfer',
  childExtrude: {
    kind: 'extrude',
    loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    depth: 5,
    direction: 'one_sided',
    mode: 'add',
  },
  distance: 1,
  edgeSelection: 'vertical',
};

function node(id: string, payload: FeaturePayload, deps: string[] = [], opts: Partial<FeatureNode> = {}): FeatureNode {
  return {
    id,
    name: opts.name ?? id,
    dependencies: deps,
    payload,
    ...(opts.suppressed !== undefined ? { suppressed: opts.suppressed } : {}),
  };
}

// ─── round-trip helper ────────────────────────────────────────────────────

function roundTrip(tree: FeatureTree): FeatureTree {
  const json = serializeFeatureTree(tree);
  const res = deserializeFeatureTree(json);
  if (!res.ok) {
    throw new Error(`round-trip failed: ${res.error} ${res.message}`);
  }
  return res.tree;
}

// ─── tests ────────────────────────────────────────────────────────────────

describe('serializeFeatureTree / deserializeFeatureTree — empty', () => {
  it('round-trips an empty tree', () => {
    const tree: FeatureTree = { nodes: [] };
    const out = roundTrip(tree);
    expect(out.nodes).toEqual([]);
  });

  it('emits the current SCHEMA_VERSION in the envelope', () => {
    const json = serializeFeatureTree({ nodes: [] });
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(SCHEMA_VERSION);
    expect(parsed.tree).toEqual({ nodes: [] });
  });
});

describe('round-trip — all 9 FeaturePayload kinds', () => {
  const cases: Array<[string, FeaturePayload]> = [
    ['extrude', extrudePayload],
    ['revolve', revolvePayload],
    ['sweep', sweepPayload],
    ['loft', loftPayload],
    ['linear_pattern', linearPatternPayload],
    ['circular_pattern', circularPatternPayload],
    ['hole', holePayload],
    ['fillet', filletPayload],
    ['chamfer', chamferPayload],
  ];

  for (const [name, payload] of cases) {
    it(`${name} payload round-trips`, () => {
      const tree: FeatureTree = { nodes: [node(`${name}-1`, payload)] };
      const out = roundTrip(tree);
      expect(out.nodes).toHaveLength(1);
      const n = out.nodes[0]!;
      expect(n.id).toBe(`${name}-1`);
      expect(n.payload).toEqual(payload);
    });
  }
});

describe('error: version mismatch', () => {
  it('rejects version: 2 with version_mismatch', () => {
    const blob = JSON.stringify({ version: 2, tree: { nodes: [] } });
    const res = deserializeFeatureTree(blob);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('version_mismatch');
      expect(res.message).toMatch(/version 1/);
    }
  });

  it('rejects version: 0 with version_mismatch', () => {
    const blob = JSON.stringify({ version: 0, tree: { nodes: [] } });
    const res = deserializeFeatureTree(blob);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('version_mismatch');
  });
});

describe('error: invalid JSON', () => {
  it('rejects malformed JSON', () => {
    const res = deserializeFeatureTree('{not valid json');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_json');
  });

  it('rejects empty string', () => {
    const res = deserializeFeatureTree('');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_json');
  });

  it('rejects JSON whose top is not an object (array)', () => {
    const res = deserializeFeatureTree('[]');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('missing_envelope');
  });

  it('rejects envelope without version field', () => {
    const res = deserializeFeatureTree('{"tree":{"nodes":[]}}');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('missing_envelope');
  });
});

describe('error: missing required payload fields', () => {
  it('extrude without depth → invalid_payload', () => {
    const blob = JSON.stringify({
      version: SCHEMA_VERSION,
      tree: {
        nodes: [
          {
            id: 'e1', name: 'E', dependencies: [],
            payload: { kind: 'extrude', loop: [], direction: 'one_sided', mode: 'add' },
          },
        ],
      },
    });
    const res = deserializeFeatureTree(blob);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('invalid_payload');
      expect(res.message).toMatch(/depth/);
    }
  });

  it('hole without center → invalid_payload', () => {
    const blob = JSON.stringify({
      version: SCHEMA_VERSION,
      tree: {
        nodes: [
          {
            id: 'h1', name: 'H', dependencies: [],
            payload: { kind: 'hole', holeType: 'drilled', diameter: 3, depth: 5 },
          },
        ],
      },
    });
    const res = deserializeFeatureTree(blob);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/center/);
  });

  it('unknown payload.kind → invalid_payload', () => {
    const blob = JSON.stringify({
      version: SCHEMA_VERSION,
      tree: {
        nodes: [
          { id: 'x', name: 'X', dependencies: [], payload: { kind: 'bogus' } },
        ],
      },
    });
    const res = deserializeFeatureTree(blob);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('invalid_payload');
      expect(res.message).toMatch(/bogus/);
    }
  });

  it('fillet with non-extrude childExtrude kind → invalid_payload', () => {
    const blob = JSON.stringify({
      version: SCHEMA_VERSION,
      tree: {
        nodes: [
          {
            id: 'f1', name: 'F', dependencies: [],
            payload: {
              kind: 'fillet',
              childExtrude: { kind: 'revolve' },
              radius: 1,
              edgeSelection: 'all',
            },
          },
        ],
      },
    });
    const res = deserializeFeatureTree(blob);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('invalid_payload');
      expect(res.message).toMatch(/childExtrude.kind/);
    }
  });
});

describe('error: validateTree failures', () => {
  it('duplicate ids → validate_tree_failed', () => {
    const tree: FeatureTree = {
      nodes: [node('a', extrudePayload), node('a', extrudePayload)],
    };
    const json = serializeFeatureTree(tree);
    const res = deserializeFeatureTree(json);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('validate_tree_failed');
      expect(res.message).toMatch(/duplicate/);
    }
  });

  it('forward dependency reference → validate_tree_failed', () => {
    const tree: FeatureTree = {
      nodes: [node('b', extrudePayload, ['a']), node('a', extrudePayload)],
    };
    const json = serializeFeatureTree(tree);
    const res = deserializeFeatureTree(json);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('validate_tree_failed');
  });
});

describe('large tree (100 nodes)', () => {
  it('round-trips a 100-node tree without loss', () => {
    const nodes: FeatureNode[] = [];
    for (let i = 0; i < 100; i++) {
      nodes.push(node(`n${i}`, extrudePayload, i > 0 ? [`n${i - 1}`] : []));
    }
    const tree: FeatureTree = { nodes };
    const out = roundTrip(tree);
    expect(out.nodes).toHaveLength(100);
    expect(out.nodes[99]!.dependencies).toEqual(['n98']);
    // spot-check payload depth survives
    expect((out.nodes[50]!.payload as { depth?: number }).depth).toBe(3);
  });
});

describe('suppressed flag', () => {
  it('preserves suppressed=true', () => {
    const tree: FeatureTree = {
      nodes: [node('a', extrudePayload, [], { suppressed: true })],
    };
    const out = roundTrip(tree);
    expect(out.nodes[0]!.suppressed).toBe(true);
  });

  it('omits suppressed when undefined (does not introduce a false)', () => {
    const tree: FeatureTree = { nodes: [node('a', extrudePayload)] };
    const json = serializeFeatureTree(tree);
    const parsed = JSON.parse(json);
    expect('suppressed' in parsed.tree.nodes[0]).toBe(false);
  });

  it('preserves suppressed=false explicitly', () => {
    const tree: FeatureTree = {
      nodes: [node('a', extrudePayload, [], { suppressed: false })],
    };
    const out = roundTrip(tree);
    expect(out.nodes[0]!.suppressed).toBe(false);
  });
});

describe('dependencies', () => {
  it('preserves dependency order and content', () => {
    const tree: FeatureTree = {
      nodes: [
        node('a', extrudePayload),
        node('b', extrudePayload),
        node('c', linearPatternPayload, ['a', 'b']),
      ],
    };
    const out = roundTrip(tree);
    expect(out.nodes[2]!.dependencies).toEqual(['a', 'b']);
  });
});
