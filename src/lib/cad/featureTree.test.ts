/**
 * featureTree — validation, replay, downstream-of tests.
 */
import { describe, it, expect } from 'vitest';
import {
  validateTree,
  replayTree,
  downstreamOf,
  FeatureTreeError,
  type FeatureTree,
  type FeatureNode,
} from './featureTree';
import type { ExtrudeFeature } from './extrudeProfile';
import type { LinearPatternFeature } from './pattern';

function extrudeNode(id: string, name: string, deps: string[] = []): FeatureNode {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }],
    depth: 3,
    direction: 'one_sided',
    mode: 'add',
  };
  return { id, name, dependencies: deps, payload };
}

function linearPatternNode(id: string, name: string, deps: string[]): FeatureNode {
  const payload: LinearPatternFeature = {
    kind: 'linear_pattern',
    childScad: 'cube([1,1,1]);',
    count: 3,
    direction: { x: 1, y: 0, z: 0 },
    spacing: 5,
  };
  return { id, name, dependencies: deps, payload };
}

// ─── validateTree ─────────────────────────────────────────────────────────

describe('validateTree', () => {
  it('accepts a valid linear tree', () => {
    const tree: FeatureTree = {
      nodes: [extrudeNode('a', 'Base'), linearPatternNode('b', 'Holes', ['a'])],
    };
    expect(() => validateTree(tree)).not.toThrow();
  });

  it('rejects duplicate ids', () => {
    const tree: FeatureTree = {
      nodes: [extrudeNode('a', 'Base'), extrudeNode('a', 'Dup')],
    };
    expect(() => validateTree(tree)).toThrow(FeatureTreeError);
    expect(() => validateTree(tree)).toThrow(/duplicate/);
  });

  it('rejects forward references', () => {
    const tree: FeatureTree = {
      nodes: [linearPatternNode('b', 'Holes', ['a']), extrudeNode('a', 'Base')],
    };
    expect(() => validateTree(tree)).toThrow(/later or not at all/);
  });

  it('rejects self-dependency', () => {
    const tree: FeatureTree = { nodes: [extrudeNode('a', 'Base', ['a'])] };
    expect(() => validateTree(tree)).toThrow(/depends on itself/);
  });

  it('rejects empty id', () => {
    const tree: FeatureTree = { nodes: [extrudeNode('', 'Anon')] };
    expect(() => validateTree(tree)).toThrow(/empty id/);
  });

  it('rejects missing dependency target', () => {
    const tree: FeatureTree = { nodes: [linearPatternNode('a', 'Orphan', ['missing'])] };
    expect(() => validateTree(tree)).toThrow(/depends on missing/);
  });
});

// ─── replayTree ───────────────────────────────────────────────────────────

describe('replayTree', () => {
  it('emits header comments and per-node SCAD for each non-suppressed node', () => {
    const tree: FeatureTree = {
      nodes: [extrudeNode('base', 'Base Plate'), linearPatternNode('holes', 'Hole Array', ['base'])],
    };
    const r = replayTree(tree);
    expect(r.scad).toContain('// === base (Base Plate) ===');
    expect(r.scad).toContain('// === holes (Hole Array) ===');
    expect(r.scad).toContain('linear_extrude(height=3');
    expect(r.scad).toContain('module nexyfab_pattern_child');
    expect(r.perNode.get('base')).toContain('linear_extrude');
    expect(r.perNode.get('holes')).toContain('module nexyfab_pattern_child');
    expect(r.emittedOrder).toEqual(['base', 'holes']);
  });

  it('skips suppressed nodes from SCAD output but keeps them in perNode map', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('a', 'A'),
        { ...extrudeNode('b', 'B'), suppressed: true },
        linearPatternNode('c', 'C', ['a']),
      ],
    };
    const r = replayTree(tree);
    expect(r.emittedOrder).toEqual(['a', 'c']);
    expect(r.scad).not.toContain('// === b (B) ===');
    expect(r.perNode.has('b')).toBe(true); // still emitted to perNode for caching
  });

  it('propagates validation errors before emitting', () => {
    const tree: FeatureTree = {
      nodes: [extrudeNode('a', 'A'), extrudeNode('a', 'Dup')],
    };
    expect(() => replayTree(tree)).toThrow(FeatureTreeError);
  });
});

// ─── downstreamOf ─────────────────────────────────────────────────────────

describe('downstreamOf', () => {
  it('finds direct dependents', () => {
    const tree: FeatureTree = {
      nodes: [extrudeNode('a', 'A'), linearPatternNode('b', 'B', ['a'])],
    };
    const d = downstreamOf(tree, 'a');
    expect(d).toEqual(new Set(['b']));
  });

  it('finds transitive dependents', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('a', 'A'),
        linearPatternNode('b', 'B', ['a']),
        linearPatternNode('c', 'C', ['b']),
        linearPatternNode('d', 'D', ['c']),
      ],
    };
    const d = downstreamOf(tree, 'a');
    expect(d).toEqual(new Set(['b', 'c', 'd']));
  });

  it('returns empty for leaf-most node', () => {
    const tree: FeatureTree = {
      nodes: [extrudeNode('a', 'A'), linearPatternNode('b', 'B', ['a'])],
    };
    expect(downstreamOf(tree, 'b')).toEqual(new Set());
  });

  it('handles fan-out (one source → many dependents)', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('a', 'A'),
        linearPatternNode('b', 'B', ['a']),
        linearPatternNode('c', 'C', ['a']),
        linearPatternNode('d', 'D', ['b', 'c']),
      ],
    };
    expect(downstreamOf(tree, 'a')).toEqual(new Set(['b', 'c', 'd']));
  });
});
