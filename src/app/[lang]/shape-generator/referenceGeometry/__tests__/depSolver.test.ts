/**
 * depSolver.test.ts — toposort + cycle detection.
 *
 * The solver is graph-only; it never inspects `params`. We build graphs
 * by hand here to keep tests readable.
 */

import { describe, it, expect } from 'vitest';
import {
  buildGraph,
  buildReverseGraph,
  bumpVersion,
  collectDownstream,
  findAllCycles,
  toposort,
  wouldCreateCycle,
  type DepGraph,
} from '../depSolver';
import type { ReferenceNode } from '../types';

/** Helper: build a node with explicit `dependsOn` (we don't care about
 *  kind/method for the solver — it's graph-only). */
function n(id: string, dependsOn: string[] = []): ReferenceNode {
  return {
    id,
    kind: 'plane',
    method: 'standard',
    label: id,
    hidden: false,
    dependsOn,
    evaluatedAt: 0,
    params: { method: 'standard', id: 'front' },
  };
}

function graphOf(...nodes: ReferenceNode[]): DepGraph {
  return buildGraph(nodes);
}

describe('toposort — linear chains', () => {
  it('empty graph: empty order, no cycle', () => {
    const r = toposort(buildGraph([]));
    expect(r.order).toEqual([]);
    expect(r.cycle).toBeNull();
    expect(r.missing).toEqual([]);
  });

  it('single isolated node', () => {
    const r = toposort(graphOf(n('a')));
    expect(r.order).toEqual(['a']);
    expect(r.cycle).toBeNull();
  });

  it('linear chain a → b → c: parents first', () => {
    // a has no deps, b depends on a, c depends on b.
    const r = toposort(graphOf(n('a'), n('b', ['a']), n('c', ['b'])));
    expect(r.cycle).toBeNull();
    // Parents must precede children.
    expect(r.order.indexOf('a')).toBeLessThan(r.order.indexOf('b'));
    expect(r.order.indexOf('b')).toBeLessThan(r.order.indexOf('c'));
  });

  it('multi-level chain a → b → c → d → e', () => {
    const r = toposort(
      graphOf(
        n('a'),
        n('b', ['a']),
        n('c', ['b']),
        n('d', ['c']),
        n('e', ['d']),
      ),
    );
    expect(r.cycle).toBeNull();
    expect(r.order).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('toposort — branching graphs', () => {
  it('diamond a → b, a → c, b → d, c → d', () => {
    const r = toposort(
      graphOf(n('a'), n('b', ['a']), n('c', ['a']), n('d', ['b', 'c'])),
    );
    expect(r.cycle).toBeNull();
    expect(r.order.indexOf('a')).toBeLessThan(r.order.indexOf('b'));
    expect(r.order.indexOf('a')).toBeLessThan(r.order.indexOf('c'));
    expect(r.order.indexOf('b')).toBeLessThan(r.order.indexOf('d'));
    expect(r.order.indexOf('c')).toBeLessThan(r.order.indexOf('d'));
  });

  it('tree with 1 root, 3 children', () => {
    const r = toposort(
      graphOf(n('r'), n('a', ['r']), n('b', ['r']), n('c', ['r'])),
    );
    expect(r.cycle).toBeNull();
    expect(r.order.length).toBe(4);
    expect(r.order.indexOf('r')).toBe(0); // root first
  });

  it('fan-in: a, b, c → d', () => {
    const r = toposort(
      graphOf(n('a'), n('b'), n('c'), n('d', ['a', 'b', 'c'])),
    );
    expect(r.cycle).toBeNull();
    expect(r.order.indexOf('d')).toBe(3); // d emitted last
  });

  it('disjoint subgraphs', () => {
    const r = toposort(
      graphOf(n('a'), n('b', ['a']), n('c'), n('d', ['c'])),
    );
    expect(r.cycle).toBeNull();
    expect(r.order.length).toBe(4);
  });
});

describe('toposort — cycle detection', () => {
  it('self-loop a → a', () => {
    const r = toposort(graphOf(n('a', ['a'])));
    expect(r.cycle).not.toBeNull();
    expect(r.cycle![0]).toBe('a');
    expect(r.cycle![r.cycle!.length - 1]).toBe('a');
  });

  it('two-node cycle a ↔ b', () => {
    const r = toposort(graphOf(n('a', ['b']), n('b', ['a'])));
    expect(r.cycle).not.toBeNull();
    // Cycle contains both a and b, starts and ends on same node.
    expect(r.cycle![0]).toBe(r.cycle![r.cycle!.length - 1]);
    const unique = new Set(r.cycle);
    expect(unique.has('a')).toBe(true);
    expect(unique.has('b')).toBe(true);
  });

  it('three-node cycle a → b → c → a', () => {
    const r = toposort(
      graphOf(n('a', ['c']), n('b', ['a']), n('c', ['b'])),
    );
    expect(r.cycle).not.toBeNull();
    const unique = new Set(r.cycle);
    expect(unique.has('a')).toBe(true);
    expect(unique.has('b')).toBe(true);
    expect(unique.has('c')).toBe(true);
    expect(r.cycle![0]).toBe(r.cycle![r.cycle!.length - 1]);
  });

  it('cycle embedded in acyclic graph is detected', () => {
    // a → b, c → d → e → c (cycle in c-d-e branch).
    const r = toposort(
      graphOf(
        n('a'),
        n('b', ['a']),
        n('c', ['e']),
        n('d', ['c']),
        n('e', ['d']),
      ),
    );
    expect(r.cycle).not.toBeNull();
    const unique = new Set(r.cycle);
    expect(unique.has('c')).toBe(true);
    expect(unique.has('d')).toBe(true);
    expect(unique.has('e')).toBe(true);
  });

  it('large pathological cycle terminates (no infinite loop)', () => {
    // 50-node cycle.
    const nodes: ReferenceNode[] = [];
    for (let i = 0; i < 50; i += 1) {
      const prev = i === 0 ? 49 : i - 1;
      nodes.push(n(`x${i}`, [`x${prev}`]));
    }
    const r = toposort(buildGraph(nodes));
    expect(r.cycle).not.toBeNull();
  });
});

describe('toposort — missing parents (spec §7.4)', () => {
  it('reports missing upstream ids', () => {
    // b depends on 'ghost' which isn't in the graph.
    const r = toposort(graphOf(n('a'), n('b', ['ghost', 'a'])));
    expect(r.cycle).toBeNull();
    expect(r.missing).toEqual(['ghost']);
  });

  it('multiple missing deps', () => {
    const r = toposort(graphOf(n('a', ['x', 'y', 'z'])));
    expect([...r.missing].sort()).toEqual(['x', 'y', 'z']);
  });

  it('mixed missing + valid deps still produces partial order', () => {
    const r = toposort(graphOf(n('a'), n('b', ['a', 'ghost'])));
    expect(r.cycle).toBeNull();
    expect(r.order).toContain('a');
    expect(r.order).toContain('b');
    expect(r.missing).toEqual(['ghost']);
  });
});

describe('wouldCreateCycle (spec §7.2)', () => {
  it('inserting non-cyclic dep returns false', () => {
    const g = graphOf(n('a'), n('b'));
    // b depending on a does NOT create a cycle.
    expect(wouldCreateCycle(g, 'b', ['a'])).toBe(false);
  });

  it('adding self-loop returns true', () => {
    const g = graphOf(n('a'));
    expect(wouldCreateCycle(g, 'a', ['a'])).toBe(true);
  });

  it('back-edge in existing chain returns true', () => {
    // a → b → c; making a depend on c closes the loop.
    const g = graphOf(n('a'), n('b', ['a']), n('c', ['b']));
    expect(wouldCreateCycle(g, 'a', ['c'])).toBe(true);
  });

  it('parallel dep that does not reach target is safe', () => {
    // a, b, c are independent. Adding d → a is safe even if c is in graph.
    const g = graphOf(n('a'), n('b'), n('c'), n('d'));
    expect(wouldCreateCycle(g, 'd', ['a'])).toBe(false);
  });

  it('deep cycle: target reachable through 3 levels', () => {
    // a → b → c → d; d depending on a would close.
    const g = graphOf(
      n('a'),
      n('b', ['a']),
      n('c', ['b']),
      n('d', ['c']),
    );
    expect(wouldCreateCycle(g, 'a', ['d'])).toBe(true);
  });

  it('empty newDeps is always safe', () => {
    const g = graphOf(n('a'), n('b', ['a']));
    expect(wouldCreateCycle(g, 'a', [])).toBe(false);
  });
});

describe('findAllCycles', () => {
  it('acyclic graph returns no cycles', () => {
    const g = graphOf(n('a'), n('b', ['a']), n('c', ['b']));
    const r = findAllCycles(g);
    expect(r.cycles).toEqual([]);
    expect(r.brokenEdges).toEqual([]);
  });

  it('single cycle: 1 cycle reported, 1 edge broken', () => {
    const g = graphOf(n('a', ['b']), n('b', ['a']));
    const r = findAllCycles(g);
    expect(r.cycles.length).toBe(1);
    expect(r.brokenEdges.length).toBe(1);
  });

  it('two disjoint cycles: both reported', () => {
    // Cycle 1: a ↔ b. Cycle 2: c ↔ d.
    const g = graphOf(
      n('a', ['b']),
      n('b', ['a']),
      n('c', ['d']),
      n('d', ['c']),
    );
    const r = findAllCycles(g);
    expect(r.cycles.length).toBe(2);
    expect(r.brokenEdges.length).toBe(2);
  });
});

describe('buildReverseGraph + collectDownstream', () => {
  it('reverse of a → b is b → a (consumer direction)', () => {
    const g = graphOf(n('a'), n('b', ['a']));
    const rev = buildReverseGraph(g);
    expect(rev.get('a')).toEqual(['b']);
    expect(rev.get('b')).toEqual([]);
  });

  it('collectDownstream walks the reverse graph', () => {
    // a → b → c, a → d. Downstream of a: a, b, c, d.
    const g = graphOf(n('a'), n('b', ['a']), n('c', ['b']), n('d', ['a']));
    const rev = buildReverseGraph(g);
    const downstream = collectDownstream(rev, 'a');
    expect(new Set(downstream)).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('collectDownstream of leaf is just itself', () => {
    const g = graphOf(n('a'), n('b', ['a']));
    const rev = buildReverseGraph(g);
    expect(collectDownstream(rev, 'b')).toEqual(['b']);
  });

  it('collectDownstream of unknown id returns just that id', () => {
    const g = graphOf(n('a'));
    const rev = buildReverseGraph(g);
    expect(collectDownstream(rev, 'ghost')).toEqual(['ghost']);
  });
});

describe('bumpVersion (spec §7.3)', () => {
  it('monotonic increment', () => {
    expect(bumpVersion(0)).toBe(1);
    expect(bumpVersion(42)).toBe(43);
  });

  it('wraps near MAX_SAFE_INTEGER', () => {
    expect(bumpVersion(Number.MAX_SAFE_INTEGER)).toBe(1);
    expect(bumpVersion(Number.MAX_SAFE_INTEGER - 1)).toBe(1);
  });
});

describe('toposort — stability', () => {
  it('preserves input order for unrelated nodes', () => {
    const r = toposort(graphOf(n('a'), n('b'), n('c'), n('d')));
    expect(r.order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('deterministic across runs', () => {
    const g = graphOf(n('a'), n('b', ['a']), n('c', ['a']), n('d', ['b', 'c']));
    const r1 = toposort(g);
    const r2 = toposort(g);
    expect(r1.order).toEqual(r2.order);
  });
});

describe('toposort — performance (100-node graph stays sub-second)', () => {
  it('linear chain of 200 nodes terminates quickly', () => {
    const nodes: ReferenceNode[] = [];
    for (let i = 0; i < 200; i += 1) {
      nodes.push(n(`n${i}`, i === 0 ? [] : [`n${i - 1}`]));
    }
    const start = Date.now();
    const r = toposort(buildGraph(nodes));
    const elapsed = Date.now() - start;
    expect(r.cycle).toBeNull();
    expect(r.order.length).toBe(200);
    expect(elapsed).toBeLessThan(500); // generous, normally <10ms
  });
});
