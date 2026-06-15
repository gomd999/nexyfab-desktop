/**
 * featureTreeMerge — semantic merge strategy tests.
 *
 * Five strategies under test: structural / semantic_dedup / last_wins /
 * first_wins / composite. Each one has its own dedicated `describe` block
 * below plus a final cross-strategy block to catch dispatcher regressions.
 */
import { describe, it, expect } from 'vitest';
import {
  semanticMergeTrees,
  type CompositeFeatureNode,
  type MergeStrategy,
} from './featureTreeMerge';
import { validateTree, type FeatureNode, type FeatureTree } from './featureTree';
import type { ExtrudeFeature } from './extrudeProfile';
import type { LinearPatternFeature } from './pattern';

// ─── builders ─────────────────────────────────────────────────────────────

function extrudeNode(
  id: string,
  name: string,
  deps: string[] = [],
  depth = 3,
): FeatureNode {
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

function patternNode(
  id: string,
  name: string,
  deps: string[],
  count = 3,
): FeatureNode {
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

// ─── structural ──────────────────────────────────────────────────────────

describe('semanticMergeTrees — structural', () => {
  it('delegates to featureTreeOps.mergeTrees (no collisions)', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const other: FeatureTree = { nodes: [extrudeNode('b', 'B')] };
    const r = semanticMergeTrees(base, other, 'structural');
    expect(r.strategy).toBe('structural');
    expect(r.merged.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(r.dedupedCount).toBe(0);
    expect(r.replacedNodes).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('structural uses suffix collision policy', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'BaseA')] };
    const other: FeatureTree = { nodes: [extrudeNode('a', 'OtherA')] };
    const r = semanticMergeTrees(base, other, 'structural');
    expect(r.merged.nodes.map((n) => n.id)).toEqual(['a', 'a__2']);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toMatch(/suffix/);
  });

  it('structural empty + empty → empty', () => {
    const r = semanticMergeTrees(EMPTY, EMPTY, 'structural');
    expect(r.merged.nodes).toEqual([]);
  });
});

// ─── semantic_dedup ──────────────────────────────────────────────────────

describe('semanticMergeTrees — semantic_dedup', () => {
  it('two identical boxes → one node, dedupedCount=1', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'BaseBox')] };
    const other: FeatureTree = { nodes: [extrudeNode('b', 'OtherBox')] };
    const r = semanticMergeTrees(base, other, 'semantic_dedup');
    expect(r.merged.nodes.length).toBe(1);
    expect(r.merged.nodes[0]!.id).toBe('a'); // base wins as canonical
    expect(r.dedupedCount).toBe(1);
  });

  it('different sizes → no dedup', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A', [], 3)] };
    const other: FeatureTree = { nodes: [extrudeNode('b', 'B', [], 7)] };
    const r = semanticMergeTrees(base, other, 'semantic_dedup');
    expect(r.merged.nodes.length).toBe(2);
    expect(r.dedupedCount).toBe(0);
  });

  it('dep gets remapped to canonical id after dedup', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const other: FeatureTree = {
      nodes: [extrudeNode('b', 'B'), patternNode('p', 'Pat', ['b'])],
    };
    const r = semanticMergeTrees(base, other, 'semantic_dedup');
    // 'b' deduped against 'a'; 'p' should now depend on 'a', not 'b'.
    const pat = r.merged.nodes.find((n) => n.id === 'p')!;
    expect(pat.dependencies).toEqual(['a']);
    expect(r.dedupedCount).toBe(1);
  });

  it('same id same payload across base and other → silent dedup', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const other: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const r = semanticMergeTrees(base, other, 'semantic_dedup');
    expect(r.merged.nodes.length).toBe(1);
    expect(r.merged.nodes[0]!.id).toBe('a');
    expect(r.dedupedCount).toBe(1);
  });

  it('same id different payload → second renamed via suffix', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A', [], 3)] };
    const other: FeatureTree = { nodes: [extrudeNode('a', 'A2', [], 7)] };
    const r = semanticMergeTrees(base, other, 'semantic_dedup');
    expect(r.merged.nodes.map((n) => n.id)).toEqual(['a', 'a__2']);
    expect(r.warnings.some((w) => w.includes('different payload'))).toBe(true);
  });

  it('dedup is suppressed-aware (different suppressed → different)', () => {
    const baseNode = { ...extrudeNode('a', 'A'), suppressed: false };
    const otherNode = { ...extrudeNode('b', 'B'), suppressed: true };
    const r = semanticMergeTrees(
      { nodes: [baseNode] },
      { nodes: [otherNode] },
      'semantic_dedup',
    );
    // Suppressed states differ → not deduped.
    expect(r.merged.nodes.length).toBe(2);
  });

  it('result passes validateTree', () => {
    const base: FeatureTree = {
      nodes: [extrudeNode('a', 'A'), patternNode('p', 'P', ['a'])],
    };
    const other: FeatureTree = {
      nodes: [extrudeNode('b', 'B'), patternNode('q', 'Q', ['b'])],
    };
    const r = semanticMergeTrees(base, other, 'semantic_dedup');
    expect(() => validateTree(r.merged)).not.toThrow();
  });

  it('empty + empty → empty, dedupedCount=0', () => {
    const r = semanticMergeTrees(EMPTY, EMPTY, 'semantic_dedup');
    expect(r.merged.nodes).toEqual([]);
    expect(r.dedupedCount).toBe(0);
  });
});

// ─── last_wins ───────────────────────────────────────────────────────────

describe('semanticMergeTrees — last_wins', () => {
  it('same id, different payload → other wins', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'BaseA', [], 3)] };
    const other: FeatureTree = { nodes: [extrudeNode('a', 'OtherA', [], 99)] };
    const r = semanticMergeTrees(base, other, 'last_wins');
    expect(r.merged.nodes.length).toBe(1);
    expect((r.merged.nodes[0]!.payload as ExtrudeFeature).depth).toBe(99);
    expect(r.merged.nodes[0]!.name).toBe('OtherA');
    expect(r.replacedNodes).toEqual([{ id: 'a', kept: 'other' }]);
  });

  it('id only in base → preserved as-is', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const other: FeatureTree = { nodes: [extrudeNode('b', 'B')] };
    const r = semanticMergeTrees(base, other, 'last_wins');
    expect(r.merged.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(r.replacedNodes).toEqual([]);
  });

  it('preserves base order with other-only appended at end', () => {
    const base: FeatureTree = {
      nodes: [extrudeNode('a', 'A'), extrudeNode('b', 'B')],
    };
    const other: FeatureTree = {
      nodes: [extrudeNode('b', 'B-new', [], 5), extrudeNode('c', 'C')],
    };
    const r = semanticMergeTrees(base, other, 'last_wins');
    expect(r.merged.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    // 'b' should be other's version (depth=5).
    const b = r.merged.nodes.find((n) => n.id === 'b')!;
    expect((b.payload as ExtrudeFeature).depth).toBe(5);
  });
});

// ─── first_wins ──────────────────────────────────────────────────────────

describe('semanticMergeTrees — first_wins', () => {
  it('same id, different payload → base wins', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'BaseA', [], 3)] };
    const other: FeatureTree = { nodes: [extrudeNode('a', 'OtherA', [], 99)] };
    const r = semanticMergeTrees(base, other, 'first_wins');
    expect(r.merged.nodes.length).toBe(1);
    expect((r.merged.nodes[0]!.payload as ExtrudeFeature).depth).toBe(3);
    expect(r.merged.nodes[0]!.name).toBe('BaseA');
    expect(r.replacedNodes).toEqual([{ id: 'a', kept: 'base' }]);
  });

  it('still appends other-only nodes', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const other: FeatureTree = {
      nodes: [extrudeNode('a', 'X'), extrudeNode('b', 'B')],
    };
    const r = semanticMergeTrees(base, other, 'first_wins');
    expect(r.merged.nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('other-only node depending on shared id is preserved (no cascade)', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'BaseA')] };
    const other: FeatureTree = {
      nodes: [extrudeNode('a', 'OtherA', [], 7), patternNode('p', 'P', ['a'])],
    };
    const r = semanticMergeTrees(base, other, 'first_wins');
    // 'a' is base's version; 'p' (other-only) still depends on 'a', valid.
    expect(r.merged.nodes.map((n) => n.id)).toEqual(['a', 'p']);
    expect((r.merged.nodes[0]!.payload as ExtrudeFeature).depth).toBe(3);
  });
});

// ─── composite ───────────────────────────────────────────────────────────

describe('semanticMergeTrees — composite', () => {
  it('tags every node with originalSource', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const other: FeatureTree = { nodes: [extrudeNode('b', 'B')] };
    const r = semanticMergeTrees(base, other, 'composite');
    expect(r.merged.nodes.length).toBe(2);
    const a = r.merged.nodes[0]! as CompositeFeatureNode;
    const b = r.merged.nodes[1]! as CompositeFeatureNode;
    expect(a.originalSource).toBe('base');
    expect(b.originalSource).toBe('other');
  });

  it('id collisions get suffix renamed, still tagged correctly', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'BaseA')] };
    const other: FeatureTree = { nodes: [extrudeNode('a', 'OtherA')] };
    const r = semanticMergeTrees(base, other, 'composite');
    expect(r.merged.nodes.map((n) => n.id)).toEqual(['a', 'a__2']);
    const tagged = r.merged.nodes.map((n) => (n as CompositeFeatureNode).originalSource);
    // 'a' was in baseIds set → 'base'; 'a__2' (renamed from other's 'a') →
    // not in baseIds → 'other'.
    expect(tagged).toEqual(['base', 'other']);
    expect(r.warnings.some((w) => w.includes('collision'))).toBe(true);
  });

  it('no warning when no collisions', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const other: FeatureTree = { nodes: [extrudeNode('b', 'B')] };
    const r = semanticMergeTrees(base, other, 'composite');
    expect(r.warnings).toEqual([]);
  });
});

// ─── cross-strategy / dispatcher ─────────────────────────────────────────

describe('semanticMergeTrees — dispatcher and invariants', () => {
  it('every strategy returns its own strategy field', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const other: FeatureTree = { nodes: [extrudeNode('b', 'B')] };
    const strategies: MergeStrategy[] = [
      'structural',
      'semantic_dedup',
      'last_wins',
      'first_wins',
      'composite',
    ];
    for (const s of strategies) {
      const r = semanticMergeTrees(base, other, s);
      expect(r.strategy).toBe(s);
    }
  });

  it('every strategy produces a validateTree-clean result', () => {
    const base: FeatureTree = {
      nodes: [extrudeNode('a', 'A'), patternNode('p', 'P', ['a'])],
    };
    const other: FeatureTree = {
      nodes: [extrudeNode('b', 'B'), patternNode('q', 'Q', ['b'])],
    };
    const strategies: MergeStrategy[] = [
      'structural',
      'semantic_dedup',
      'last_wins',
      'first_wins',
      'composite',
    ];
    for (const s of strategies) {
      const r = semanticMergeTrees(base, other, s);
      expect(() => validateTree(r.merged)).not.toThrow();
    }
  });

  it('does not mutate base or other', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A', [], 3)] };
    const other: FeatureTree = { nodes: [extrudeNode('a', 'A', [], 7)] };
    const baseSnap = JSON.stringify(base);
    const otherSnap = JSON.stringify(other);
    const strategies: MergeStrategy[] = [
      'structural',
      'semantic_dedup',
      'last_wins',
      'first_wins',
      'composite',
    ];
    for (const s of strategies) {
      semanticMergeTrees(base, other, s);
    }
    expect(JSON.stringify(base)).toBe(baseSnap);
    expect(JSON.stringify(other)).toBe(otherSnap);
  });

  it('throws fast on invalid input tree (base)', () => {
    const bad: FeatureTree = {
      nodes: [patternNode('p', 'P', ['missing'])],
    };
    const ok: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    expect(() => semanticMergeTrees(bad, ok, 'structural')).toThrow();
  });

  it('throws fast on invalid input tree (other)', () => {
    const ok: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const bad: FeatureTree = {
      nodes: [patternNode('p', 'P', ['missing'])],
    };
    expect(() => semanticMergeTrees(ok, bad, 'semantic_dedup')).toThrow();
  });

  it('empty + empty → empty across all strategies', () => {
    const strategies: MergeStrategy[] = [
      'structural',
      'semantic_dedup',
      'last_wins',
      'first_wins',
      'composite',
    ];
    for (const s of strategies) {
      const r = semanticMergeTrees(EMPTY, EMPTY, s);
      expect(r.merged.nodes).toEqual([]);
    }
  });

  it('last_wins differs from first_wins on same id with diff payload', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A', [], 3)] };
    const other: FeatureTree = { nodes: [extrudeNode('a', 'A', [], 9)] };
    const lw = semanticMergeTrees(base, other, 'last_wins');
    const fw = semanticMergeTrees(base, other, 'first_wins');
    expect((lw.merged.nodes[0]!.payload as ExtrudeFeature).depth).toBe(9);
    expect((fw.merged.nodes[0]!.payload as ExtrudeFeature).depth).toBe(3);
  });

  it('structural and composite both keep both bodies on collision (suffix)', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const other: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const struct = semanticMergeTrees(base, other, 'structural');
    const composite = semanticMergeTrees(base, other, 'composite');
    expect(struct.merged.nodes.length).toBe(2);
    expect(composite.merged.nodes.length).toBe(2);
  });

  it('semantic_dedup beats structural on payload-equal nodes', () => {
    const base: FeatureTree = { nodes: [extrudeNode('a', 'A')] };
    const other: FeatureTree = { nodes: [extrudeNode('b', 'B')] };
    const struct = semanticMergeTrees(base, other, 'structural');
    const dedup = semanticMergeTrees(base, other, 'semantic_dedup');
    expect(struct.merged.nodes.length).toBe(2);
    expect(dedup.merged.nodes.length).toBe(1);
  });
});
