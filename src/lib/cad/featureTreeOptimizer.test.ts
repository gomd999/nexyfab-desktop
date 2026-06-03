/**
 * featureTreeOptimizer — tests for removeSuppressed + removeOrphans + cascade.
 *
 * Coverage targets (~18 tests):
 *   - empty tree fast path
 *   - flag defaults (both on by default)
 *   - removeSuppressed: simple, no-op, cascade single, cascade chain
 *   - removeOrphans: simple, terminal preservation, chain (fixed-point loop)
 *   - cross-pass: suppressed creates orphan
 *   - mergePatterns Phase 2 placeholder warning
 *   - purity (input not mutated)
 *   - flag granularity (each flag independently off)
 *   - input validation (broken tree throws)
 *   - validateTree-clean output
 *   - warnings + removedNodes accounting
 */
import { describe, it, expect } from 'vitest';
import { optimizeTree } from './featureTreeOptimizer';
import { validateTree, type FeatureNode, type FeatureTree } from './featureTree';
import type { ExtrudeFeature } from './extrudeProfile';
import type { LinearPatternFeature } from './pattern';

// ─── builders ─────────────────────────────────────────────────────────────

function extrudeNode(
  id: string,
  deps: string[] = [],
  opts: { suppressed?: boolean; depth?: number } = {},
): FeatureNode {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ],
    depth: opts.depth ?? 3,
    direction: 'one_sided',
    mode: 'add',
  };
  return {
    id,
    name: id,
    dependencies: deps,
    ...(opts.suppressed !== undefined ? { suppressed: opts.suppressed } : {}),
    payload,
  };
}

function patternNode(
  id: string,
  deps: string[],
  opts: { suppressed?: boolean; count?: number } = {},
): FeatureNode {
  const payload: LinearPatternFeature = {
    kind: 'linear_pattern',
    childScad: 'cube([1,1,1]);',
    count: opts.count ?? 3,
    direction: { x: 1, y: 0, z: 0 },
    spacing: 5,
  };
  return {
    id,
    name: id,
    dependencies: deps,
    ...(opts.suppressed !== undefined ? { suppressed: opts.suppressed } : {}),
    payload,
  };
}

const EMPTY: FeatureTree = { nodes: [] };

// ─── empty / fast paths ───────────────────────────────────────────────────

describe('optimizeTree — fast paths', () => {
  it('empty tree → empty result, no warnings', () => {
    const r = optimizeTree(EMPTY);
    expect(r.optimized.nodes).toEqual([]);
    expect(r.removedNodes).toEqual([]);
    expect(r.mergedNodes).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('single-node tree with no suppression / no orphans → unchanged', () => {
    const tree: FeatureTree = { nodes: [extrudeNode('a')] };
    const r = optimizeTree(tree);
    expect(r.optimized.nodes.map((n) => n.id)).toEqual(['a']);
    expect(r.removedNodes).toEqual([]);
  });

  it('returns a fresh tree object (no shared node refs)', () => {
    const tree: FeatureTree = { nodes: [extrudeNode('a')] };
    const r = optimizeTree(tree);
    expect(r.optimized).not.toBe(tree);
    expect(r.optimized.nodes[0]).not.toBe(tree.nodes[0]);
  });

  it('pure — input tree is not mutated', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('a', [], { suppressed: true }),
        extrudeNode('b', ['a']),
      ],
    };
    const before = JSON.stringify(tree);
    optimizeTree(tree);
    expect(JSON.stringify(tree)).toBe(before);
  });
});

// ─── removeSuppressed ────────────────────────────────────────────────────

describe('optimizeTree — removeSuppressed', () => {
  it('drops a single suppressed node with no dependents', () => {
    const tree: FeatureTree = {
      nodes: [extrudeNode('a'), extrudeNode('b', [], { suppressed: true })],
    };
    const r = optimizeTree(tree);
    expect(r.optimized.nodes.map((n) => n.id)).toEqual(['a']);
    expect(r.removedNodes).toContain('b');
  });

  it('cascade: dropping suppressed drops its sole dependent', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('a', [], { suppressed: true }),
        extrudeNode('b', ['a']),
      ],
    };
    const r = optimizeTree(tree);
    expect(r.optimized.nodes).toEqual([]);
    expect(r.removedNodes.sort()).toEqual(['a', 'b']);
    // Cascade reason recorded in warnings.
    expect(r.warnings.some((w) => /cascade-removed/.test(w) && /\"b\"/.test(w))).toBe(true);
  });

  it('cascade chain: a→b→c, suppress a → all three drop', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('a', [], { suppressed: true }),
        extrudeNode('b', ['a']),
        extrudeNode('c', ['b']),
      ],
    };
    const r = optimizeTree(tree);
    expect(r.optimized.nodes).toEqual([]);
    expect(r.removedNodes.sort()).toEqual(['a', 'b', 'c']);
  });

  it('cascade respects unaffected siblings', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('a'),
        extrudeNode('b', [], { suppressed: true }),
        extrudeNode('c', ['b']),
        patternNode('d', ['a']),
      ],
    };
    const r = optimizeTree(tree);
    expect(r.optimized.nodes.map((n) => n.id).sort()).toEqual(['a', 'd']);
    expect(r.removedNodes.sort()).toEqual(['b', 'c']);
  });

  it('flag off → suppressed nodes stay', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('a'),
        extrudeNode('b', ['a'], { suppressed: true }),
      ],
    };
    const r = optimizeTree(tree, { removeSuppressed: false, removeOrphans: false });
    expect(r.optimized.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(r.removedNodes).toEqual([]);
  });

  it('no suppressed nodes → no warnings from this pass', () => {
    const tree: FeatureTree = {
      nodes: [extrudeNode('a'), patternNode('b', ['a'])],
    };
    const r = optimizeTree(tree, { removeSuppressed: true, removeOrphans: false });
    expect(r.removedNodes).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

// ─── removeOrphans ───────────────────────────────────────────────────────

describe('optimizeTree — removeOrphans', () => {
  it('drops a non-terminal node with no dependents', () => {
    // a → b is the live chain; c is orphan (no one depends on c, c is not last).
    const tree: FeatureTree = {
      nodes: [extrudeNode('a'), extrudeNode('c'), patternNode('b', ['a'])],
    };
    const r = optimizeTree(tree, { removeSuppressed: false, removeOrphans: true });
    expect(r.optimized.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(r.removedNodes).toContain('c');
  });

  it('preserves the terminal (last) node even if it has no dependents', () => {
    const tree: FeatureTree = {
      nodes: [extrudeNode('a'), patternNode('b', ['a'])],
    };
    const r = optimizeTree(tree, { removeSuppressed: false, removeOrphans: true });
    // 'b' is last → preserved even though nothing depends on it.
    // 'a' is preserved because 'b' depends on it.
    expect(r.optimized.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(r.removedNodes).toEqual([]);
  });

  it('orphan chain collapses in one call (fixed-point loop)', () => {
    // terminal = 'final'. 'a' → 'b' → 'c' is a dead chain that nothing
    // else references. After dropping 'c' (an orphan), 'b' becomes
    // orphan; after dropping 'b', 'a' becomes orphan.
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('a'),
        extrudeNode('b', ['a']),
        extrudeNode('c', ['b']),
        extrudeNode('final'),
      ],
    };
    const r = optimizeTree(tree, { removeSuppressed: false, removeOrphans: true });
    expect(r.optimized.nodes.map((n) => n.id)).toEqual(['final']);
    expect(r.removedNodes.sort()).toEqual(['a', 'b', 'c']);
  });

  it('flag off → orphans stay', () => {
    const tree: FeatureTree = {
      nodes: [extrudeNode('a'), extrudeNode('orphan'), patternNode('b', ['a'])],
    };
    const r = optimizeTree(tree, { removeSuppressed: false, removeOrphans: false });
    expect(r.optimized.nodes.map((n) => n.id)).toEqual(['a', 'orphan', 'b']);
    expect(r.removedNodes).toEqual([]);
  });
});

// ─── cross-pass interactions ─────────────────────────────────────────────

describe('optimizeTree — cross-pass', () => {
  it('suppressed removal can create new orphans for the orphan pass', () => {
    // 'a' is the only thing referencing 'b'; 'a' is suppressed. After
    // suppression-drop, 'b' would still be present (it's not suppressed
    // and a's removal doesn't cascade-drop b because b is upstream, not
    // downstream, of a). But then 'b' has no dependents and isn't the
    // terminal — orphan pass drops it.
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('b'),
        extrudeNode('a', ['b'], { suppressed: true }),
        extrudeNode('term'),
      ],
    };
    const r = optimizeTree(tree);
    expect(r.optimized.nodes.map((n) => n.id)).toEqual(['term']);
    expect(r.removedNodes.sort()).toEqual(['a', 'b']);
  });

  it('both flags off → tree unchanged', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('a', [], { suppressed: true }),
        extrudeNode('b', ['a']),
        extrudeNode('orphan'),
      ],
    };
    const r = optimizeTree(tree, { removeSuppressed: false, removeOrphans: false });
    expect(r.optimized.nodes.map((n) => n.id)).toEqual(['a', 'b', 'orphan']);
    expect(r.removedNodes).toEqual([]);
  });
});

// ─── mergePatterns Phase 2 placeholder ───────────────────────────────────

describe('optimizeTree — mergePatterns (Phase 2)', () => {
  it('defaults to false (no merge, no warning)', () => {
    const tree: FeatureTree = {
      nodes: [extrudeNode('a'), patternNode('b', ['a'])],
    };
    const r = optimizeTree(tree);
    expect(r.mergedNodes).toEqual([]);
    expect(r.warnings.some((w) => /mergePatterns/.test(w))).toBe(false);
  });

  it('flag on → emits placeholder warning, no actual merge', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('a'),
        patternNode('p1', ['a']),
        patternNode('p2', ['a']),
      ],
    };
    const r = optimizeTree(tree, {
      removeSuppressed: false,
      removeOrphans: false,
      mergePatterns: true,
    });
    expect(r.mergedNodes).toEqual([]);
    expect(r.warnings.some((w) => /mergePatterns: not implemented/.test(w))).toBe(true);
  });
});

// ─── validation ──────────────────────────────────────────────────────────

describe('optimizeTree — validation', () => {
  it('throws on input tree with duplicate ids (fail fast)', () => {
    const tree: FeatureTree = {
      nodes: [extrudeNode('a'), extrudeNode('a')],
    };
    expect(() => optimizeTree(tree)).toThrow();
  });

  it('throws on input tree with forward dep (fail fast)', () => {
    const tree: FeatureTree = {
      nodes: [extrudeNode('b', ['a']), extrudeNode('a')],
    };
    expect(() => optimizeTree(tree)).toThrow();
  });

  it('output is always validateTree-clean', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('a'),
        extrudeNode('b', ['a'], { suppressed: true }),
        extrudeNode('c', ['b']),
        extrudeNode('d', ['a']),
      ],
    };
    const r = optimizeTree(tree);
    expect(() => validateTree(r.optimized)).not.toThrow();
  });

  it('removedNodes is consistent with what is missing from the output', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('a', [], { suppressed: true }),
        extrudeNode('b', ['a']),
        extrudeNode('keep'),
      ],
    };
    const r = optimizeTree(tree);
    const remainingIds = new Set(r.optimized.nodes.map((n) => n.id));
    const inputIds = new Set(tree.nodes.map((n) => n.id));
    for (const removed of r.removedNodes) {
      expect(remainingIds.has(removed)).toBe(false);
      expect(inputIds.has(removed)).toBe(true);
    }
    // Every input id is either in optimized or in removedNodes — no leaks.
    for (const id of inputIds) {
      expect(remainingIds.has(id) || r.removedNodes.includes(id)).toBe(true);
    }
  });
});
