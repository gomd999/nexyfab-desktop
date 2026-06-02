/**
 * featureTreeOps — clone / merge / diff / extract / applyDiff tests.
 */
import { describe, it, expect } from 'vitest';
import {
  cloneTree,
  mergeTrees,
  diffTrees,
  extractSubtree,
  applyDiff,
  type TreeDiff,
} from './featureTreeOps';
import { validateTree, type FeatureNode, type FeatureTree } from './featureTree';
import type { ExtrudeFeature } from './extrudeProfile';
import type { LinearPatternFeature } from './pattern';

// ─── builders ─────────────────────────────────────────────────────────────

function extrudeNode(id: string, name: string, deps: string[] = [], depth = 3): FeatureNode {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ],
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
  return { id, name, dependencies: deps, payload };
}

function patternNode(id: string, name: string, deps: string[], count = 3): FeatureNode {
  const payload: LinearPatternFeature = {
    kind: 'linear_pattern',
    childScad: 'cube([1,1,1]);',
    count,
    direction: { x: 1, y: 0, z: 0 },
    spacing: 5,
  };
  return { id, name, dependencies: deps, payload };
}

const EMPTY: FeatureTree = { nodes: [] };

// ─── cloneTree ────────────────────────────────────────────────────────────

describe('cloneTree', () => {
  it('clones empty tree', () => {
    const t = cloneTree(EMPTY);
    expect(t).toEqual(EMPTY);
    expect(t).not.toBe(EMPTY);
  });

  it('clones a multi-node tree with structural equality', () => {
    const src: FeatureTree = {
      nodes: [extrudeNode('a', 'Base'), patternNode('b', 'Pat', ['a'])],
    };
    const dst = cloneTree(src);
    expect(dst).toEqual(src);
    expect(dst).not.toBe(src);
  });

  it('returns a deep copy — payload mutation does not leak', () => {
    const src: FeatureTree = { nodes: [extrudeNode('a', 'Base')] };
    const dst = cloneTree(src);
    const dstPayload = dst.nodes[0]!.payload as ExtrudeFeature;
    (dstPayload as { depth: number }).depth = 999;
    expect((src.nodes[0]!.payload as ExtrudeFeature).depth).toBe(3);
  });

  it('returns a deep copy — dependencies array mutation does not leak', () => {
    const src: FeatureTree = {
      nodes: [extrudeNode('a', 'Base'), patternNode('b', 'Pat', ['a'])],
    };
    const dst = cloneTree(src);
    (dst.nodes[1]!.dependencies as string[]).push('phantom');
    expect(src.nodes[1]!.dependencies.length).toBe(1);
  });

  it('clones nested loop arrays without identity sharing', () => {
    const src: FeatureTree = { nodes: [extrudeNode('a', 'Base')] };
    const dst = cloneTree(src);
    const srcLoop = (src.nodes[0]!.payload as ExtrudeFeature).loop;
    const dstLoop = (dst.nodes[0]!.payload as ExtrudeFeature).loop;
    expect(dstLoop).not.toBe(srcLoop);
    expect(dstLoop[0]).not.toBe(srcLoop[0]);
  });
});

// ─── mergeTrees ───────────────────────────────────────────────────────────

describe('mergeTrees', () => {
  it('empty base + other → other', () => {
    const other: FeatureTree = { nodes: [extrudeNode('x', 'X')] };
    const { merged, remappedIds } = mergeTrees(EMPTY, other);
    expect(merged.nodes.map((n) => n.id)).toEqual(['x']);
    expect(remappedIds.size).toBe(0);
  });

  it('base + empty other → base', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const { merged, remappedIds } = mergeTrees(base, EMPTY);
    expect(merged.nodes.map((n) => n.id)).toEqual(['a']);
    expect(remappedIds.size).toBe(0);
  });

  it('no id collisions → appended verbatim', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const other: FeatureTree = { nodes: [extrudeNode('b', 'B')] };
    const { merged, remappedIds } = mergeTrees(base, other);
    expect(merged.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(remappedIds.size).toBe(0);
  });

  it('id collision with suffix strategy → __2 appended', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'BaseA')] };
    const other: FeatureTree = { nodes: [extrudeNode('a', 'OtherA')] };
    const { merged, remappedIds } = mergeTrees(base, other, {
      collisionStrategy: 'suffix',
    });
    expect(merged.nodes.map((n) => n.id)).toEqual(['a', 'a__2']);
    expect(remappedIds.get('a')).toBe('a__2');
  });

  it('id collision with prefix strategy → merged__ prepended', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'BaseA')] };
    const other: FeatureTree = { nodes: [extrudeNode('a', 'OtherA')] };
    const { merged, remappedIds } = mergeTrees(base, other, {
      collisionStrategy: 'prefix',
    });
    expect(merged.nodes.map((n) => n.id)).toEqual(['a', 'merged__a']);
    expect(remappedIds.get('a')).toBe('merged__a');
  });

  it('id collision with skip strategy → conflicting node dropped', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'BaseA')] };
    const other: FeatureTree = { nodes: [extrudeNode('a', 'OtherA'), extrudeNode('b', 'B')] };
    const { merged, remappedIds } = mergeTrees(base, other, {
      collisionStrategy: 'skip',
    });
    expect(merged.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(remappedIds.get('a')).toBe('');
    expect(remappedIds.has('b')).toBe(false);
  });

  it('skip cascades to dependents of dropped nodes', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'BaseA')] };
    const other: FeatureTree = {
      nodes: [extrudeNode('a', 'OtherA'), patternNode('p', 'Pat', ['a'])],
    };
    const { merged, remappedIds } = mergeTrees(base, other, {
      collisionStrategy: 'skip',
    });
    expect(merged.nodes.map((n) => n.id)).toEqual(['a']);
    expect(remappedIds.get('a')).toBe('');
    expect(remappedIds.get('p')).toBe('');
  });

  it('remaps internal dependencies when ids change', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'BaseA')] };
    const other: FeatureTree = {
      nodes: [extrudeNode('a', 'OtherA'), patternNode('p', 'Pat', ['a'])],
    };
    const { merged, remappedIds } = mergeTrees(base, other, {
      collisionStrategy: 'suffix',
    });
    expect(remappedIds.get('a')).toBe('a__2');
    const pat = merged.nodes.find((n) => n.id === 'p')!;
    expect(pat.dependencies).toEqual(['a__2']);
  });

  it('result passes validateTree', () => {
    const base: FeatureTree = {
      nodes: [extrudeNode('a', 'A'), patternNode('b', 'B', ['a'])],
    };
    const other: FeatureTree = {
      nodes: [extrudeNode('a', 'OtherA'), patternNode('b', 'OtherB', ['a'])],
    };
    const { merged } = mergeTrees(base, other);
    expect(() => validateTree(merged)).not.toThrow();
  });

  it('suffix bumps __2 → __3 if both already taken', () => {
    const base: FeatureTree = {
      nodes: [extrudeNode('a', 'A'), extrudeNode('a__2', 'A2')],
    };
    const other: FeatureTree = { nodes: [extrudeNode('a', 'New')] };
    const { merged, remappedIds } = mergeTrees(base, other);
    expect(merged.nodes.map((n) => n.id)).toEqual(['a', 'a__2', 'a__3']);
    expect(remappedIds.get('a')).toBe('a__3');
  });

  it('does not mutate base or other', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const other: FeatureTree = { nodes: [extrudeNode('a', 'X')] };
    const baseSnapshot = JSON.stringify(base);
    const otherSnapshot = JSON.stringify(other);
    mergeTrees(base, other);
    expect(JSON.stringify(base)).toBe(baseSnapshot);
    expect(JSON.stringify(other)).toBe(otherSnapshot);
  });
});

// ─── diffTrees ────────────────────────────────────────────────────────────

describe('diffTrees', () => {
  it('two empty trees → all empty', () => {
    const d = diffTrees(EMPTY, EMPTY);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.modified).toEqual([]);
    expect(d.unchanged).toEqual([]);
  });

  it('identical trees → all unchanged', () => {
    const t: FeatureTree = {
      nodes: [extrudeNode('a', 'A'), patternNode('b', 'B', ['a'])],
    };
    const t2 = cloneTree(t);
    const d = diffTrees(t, t2);
    expect(d.unchanged.map((n) => n.id)).toEqual(['a', 'b']);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.modified).toEqual([]);
  });

  it('one node added', () => {
    const a: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const b: FeatureTree = { nodes: [extrudeNode('a', 'A'), extrudeNode('b', 'B')] };
    const d = diffTrees(a, b);
    expect(d.added.map((n) => n.id)).toEqual(['b']);
    expect(d.removed).toEqual([]);
    expect(d.modified).toEqual([]);
    expect(d.unchanged.map((n) => n.id)).toEqual(['a']);
  });

  it('one node removed', () => {
    const a: FeatureTree = { nodes: [extrudeNode('a', 'A'), extrudeNode('b', 'B')] };
    const b: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const d = diffTrees(a, b);
    expect(d.added).toEqual([]);
    expect(d.removed.map((n) => n.id)).toEqual(['b']);
    expect(d.unchanged.map((n) => n.id)).toEqual(['a']);
  });

  it('one node modified (depth change)', () => {
    const a: FeatureTree = { nodes: [extrudeNode('a', 'A', [], 5)] };
    const b: FeatureTree = { nodes: [extrudeNode('a', 'A', [], 7)] };
    const d = diffTrees(a, b);
    expect(d.modified.length).toBe(1);
    expect(d.modified[0]!.before.id).toBe('a');
    expect((d.modified[0]!.after.payload as ExtrudeFeature).depth).toBe(7);
    expect(d.unchanged).toEqual([]);
  });

  it('name change counts as modified', () => {
    const a: FeatureTree = { nodes: [extrudeNode('a', 'OldName')] };
    const b: FeatureTree = { nodes: [extrudeNode('a', 'NewName')] };
    const d = diffTrees(a, b);
    expect(d.modified.length).toBe(1);
    expect(d.unchanged).toEqual([]);
  });

  it('suppressed change counts as modified', () => {
    const a: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const bNode = { ...extrudeNode('a', 'A'), suppressed: true };
    const b: FeatureTree = { nodes: [bNode] };
    const d = diffTrees(a, b);
    expect(d.modified.length).toBe(1);
  });

  it('suppressed: undefined vs false treated as equal', () => {
    const a: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const bNode = { ...extrudeNode('a', 'A'), suppressed: false };
    const b: FeatureTree = { nodes: [bNode] };
    const d = diffTrees(a, b);
    expect(d.unchanged.length).toBe(1);
    expect(d.modified).toEqual([]);
  });

  it('payload key order does not cause false modified', () => {
    const base = extrudeNode('a', 'A');
    const reordered: FeatureNode = {
      id: base.id,
      name: base.name,
      dependencies: base.dependencies,
      // Note: re-built with different key insertion order on payload.
      payload: {
        mode: 'add',
        direction: 'one_sided',
        depth: 3,
        kind: 'extrude',
        loop: [
          { y: 0, x: 0 },
          { y: 0, x: 10 },
          { y: 5, x: 10 },
          { y: 5, x: 0 },
        ],
      } as ExtrudeFeature,
    };
    const d = diffTrees({ nodes: [base] }, { nodes: [reordered] });
    expect(d.unchanged.length).toBe(1);
    expect(d.modified).toEqual([]);
  });

  it('dependency-order change counts as modified', () => {
    const a: FeatureTree = {
      nodes: [
        extrudeNode('x', 'X'),
        extrudeNode('y', 'Y'),
        patternNode('p', 'P', ['x', 'y']),
      ],
    };
    const b: FeatureTree = {
      nodes: [
        extrudeNode('x', 'X'),
        extrudeNode('y', 'Y'),
        patternNode('p', 'P', ['y', 'x']),
      ],
    };
    // Note: this tree wouldn't satisfy the "deps must appear earlier"
    // rule if we cared — but both orderings here satisfy it (both x and
    // y precede p). We're testing the diff classifier, not validation.
    const d = diffTrees(a, b);
    expect(d.modified.length).toBe(1);
    expect(d.modified[0]!.before.id).toBe('p');
  });
});

// ─── extractSubtree ──────────────────────────────────────────────────────

describe('extractSubtree', () => {
  it('throws on missing root', () => {
    const t: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    expect(() => extractSubtree(t, 'phantom')).toThrow(/not found/);
  });

  it('single root with no deps → just that node', () => {
    const t: FeatureTree = { nodes: [extrudeNode('a', 'A'), extrudeNode('b', 'B')] };
    const sub = extractSubtree(t, 'a');
    expect(sub.nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('includes transitive dependencies', () => {
    const t: FeatureTree = {
      nodes: [
        extrudeNode('a', 'A'),
        extrudeNode('b', 'B'),
        patternNode('c', 'C', ['a']),
        patternNode('d', 'D', ['c', 'b']),
      ],
    };
    const sub = extractSubtree(t, 'd');
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('excludes unrelated nodes', () => {
    const t: FeatureTree = {
      nodes: [
        extrudeNode('a', 'A'),
        extrudeNode('b', 'B'),
        patternNode('c', 'C', ['a']),
      ],
    };
    const sub = extractSubtree(t, 'c');
    expect(sub.nodes.map((n) => n.id)).toEqual(['a', 'c']);
    expect(sub.nodes.some((n) => n.id === 'b')).toBe(false);
  });

  it('preserves declared order (topological)', () => {
    const t: FeatureTree = {
      nodes: [
        extrudeNode('a', 'A'),
        extrudeNode('b', 'B'),
        patternNode('c', 'C', ['a', 'b']),
      ],
    };
    const sub = extractSubtree(t, 'c');
    expect(sub.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('result passes validateTree', () => {
    const t: FeatureTree = {
      nodes: [
        extrudeNode('a', 'A'),
        patternNode('c', 'C', ['a']),
      ],
    };
    const sub = extractSubtree(t, 'c');
    expect(() => validateTree(sub)).not.toThrow();
  });

  it('returns a deep copy — mutation does not affect source', () => {
    const t: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const sub = extractSubtree(t, 'a');
    (sub.nodes[0]!.payload as { depth: number }).depth = 999;
    expect((t.nodes[0]!.payload as ExtrudeFeature).depth).toBe(3);
  });
});

// ─── applyDiff ────────────────────────────────────────────────────────────

describe('applyDiff', () => {
  it('empty diff → base clone (structurally equal)', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const empty: TreeDiff = { added: [], removed: [], modified: [], unchanged: [] };
    const result = applyDiff(base, empty);
    expect(result).toEqual(base);
    expect(result).not.toBe(base);
  });

  it('round-trip: a + diff(a,b) → structurally equal to b', () => {
    const a: FeatureTree = {
      nodes: [extrudeNode('a', 'A'), extrudeNode('b', 'B', [], 5)],
    };
    const b: FeatureTree = {
      nodes: [extrudeNode('a', 'A'), extrudeNode('b', 'B', [], 9), extrudeNode('c', 'C')],
    };
    const diff = diffTrees(a, b);
    const result = applyDiff(a, diff);
    // Compare via structural diff: should be all-unchanged.
    const reDiff = diffTrees(b, result);
    expect(reDiff.modified).toEqual([]);
    expect(reDiff.added).toEqual([]);
    expect(reDiff.removed).toEqual([]);
  });

  it('removes nodes listed in diff.removed', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A'), extrudeNode('b', 'B')] };
    const diff: TreeDiff = {
      added: [],
      removed: [extrudeNode('b', 'B')],
      modified: [],
      unchanged: [],
    };
    const result = applyDiff(base, diff);
    expect(result.nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('replaces nodes listed in diff.modified', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A', [], 3)] };
    const diff: TreeDiff = {
      added: [],
      removed: [],
      modified: [
        { before: extrudeNode('a', 'A', [], 3), after: extrudeNode('a', 'A', [], 99) },
      ],
      unchanged: [],
    };
    const result = applyDiff(base, diff);
    expect((result.nodes[0]!.payload as ExtrudeFeature).depth).toBe(99);
  });

  it('appends nodes listed in diff.added', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const diff: TreeDiff = {
      added: [extrudeNode('b', 'B')],
      removed: [],
      modified: [],
      unchanged: [],
    };
    const result = applyDiff(base, diff);
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('throws when modified node does not exist in base', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const diff: TreeDiff = {
      added: [],
      removed: [],
      modified: [
        { before: extrudeNode('phantom', 'X'), after: extrudeNode('phantom', 'Y') },
      ],
      unchanged: [],
    };
    expect(() => applyDiff(base, diff)).toThrow(/phantom/);
  });

  it('throws when added node collides with existing id', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const diff: TreeDiff = {
      added: [extrudeNode('a', 'Dup')],
      removed: [],
      modified: [],
      unchanged: [],
    };
    expect(() => applyDiff(base, diff)).toThrow(/already exists/);
  });

  it('result passes validateTree', () => {
    const base: FeatureTree = {
      nodes: [extrudeNode('a', 'A'), patternNode('b', 'B', ['a'])],
    };
    const diff: TreeDiff = {
      added: [],
      removed: [],
      modified: [
        { before: extrudeNode('a', 'A'), after: extrudeNode('a', 'A-renamed') },
      ],
      unchanged: [],
    };
    const result = applyDiff(base, diff);
    expect(() => validateTree(result)).not.toThrow();
  });

  it('does not mutate base', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A', [], 3)] };
    const snapshot = JSON.stringify(base);
    const diff: TreeDiff = {
      added: [extrudeNode('b', 'B')],
      removed: [],
      modified: [
        { before: extrudeNode('a', 'A', [], 3), after: extrudeNode('a', 'A', [], 7) },
      ],
      unchanged: [],
    };
    applyDiff(base, diff);
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});
