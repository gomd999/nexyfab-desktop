import { describe, it, expect } from 'vitest';
import {
  detectCycles,
  topologicalSort,
  summarize,
  type RevGraph,
} from './revisionGraphCycleDetector';

describe('detectCycles', () => {
  it('empty graph → no cycles', () => {
    const r = detectCycles({ nodes: [], edges: [] });
    expect(r.hasCycles).toBe(false);
  });

  it('linear chain A→B→C → no cycle', () => {
    const g: RevGraph = {
      nodes: ['A', 'B', 'C'],
      edges: [{ parent: 'A', child: 'B' }, { parent: 'B', child: 'C' }],
    };
    expect(detectCycles(g).hasCycles).toBe(false);
  });

  it('A→B→A → cycle of size 2', () => {
    const g: RevGraph = {
      nodes: ['A', 'B'],
      edges: [{ parent: 'A', child: 'B' }, { parent: 'B', child: 'A' }],
    };
    const r = detectCycles(g);
    expect(r.hasCycles).toBe(true);
    expect(r.cycles).toHaveLength(1);
    expect(r.cycles[0]!.nodes.length).toBe(2);
  });

  it('larger cycle A→B→C→A', () => {
    const g: RevGraph = {
      nodes: ['A', 'B', 'C'],
      edges: [{ parent: 'A', child: 'B' }, { parent: 'B', child: 'C' }, { parent: 'C', child: 'A' }],
    };
    const r = detectCycles(g);
    expect(r.hasCycles).toBe(true);
    expect(r.cycles[0]!.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it('disjoint nodes + 1 cycle elsewhere', () => {
    const g: RevGraph = {
      nodes: ['X', 'Y', 'A', 'B'],
      edges: [{ parent: 'A', child: 'B' }, { parent: 'B', child: 'A' }],
    };
    const r = detectCycles(g);
    expect(r.hasCycles).toBe(true);
  });

  it('recommends removal of high-frequency edge', () => {
    const g: RevGraph = {
      nodes: ['A', 'B'],
      edges: [{ parent: 'A', child: 'B' }, { parent: 'B', child: 'A' }],
    };
    const r = detectCycles(g);
    expect(r.recommendedRemovals.length).toBeGreaterThan(0);
  });

  it('removal count grows with cycle count', () => {
    const g: RevGraph = {
      nodes: ['A', 'B', 'C', 'D'],
      edges: [
        { parent: 'A', child: 'B' }, { parent: 'B', child: 'A' },
        { parent: 'C', child: 'D' }, { parent: 'D', child: 'C' },
      ],
    };
    const r = detectCycles(g);
    expect(r.recommendedRemovals.length).toBeGreaterThanOrEqual(2);
  });
});

describe('topologicalSort', () => {
  it('linear chain produces sorted order', () => {
    const g: RevGraph = {
      nodes: ['A', 'B', 'C'],
      edges: [{ parent: 'A', child: 'B' }, { parent: 'B', child: 'C' }],
    };
    const order = topologicalSort(g);
    expect(order).not.toBeNull();
    expect(order!.indexOf('A')).toBeLessThan(order!.indexOf('B'));
    expect(order!.indexOf('B')).toBeLessThan(order!.indexOf('C'));
  });

  it('cyclic graph returns null', () => {
    const g: RevGraph = {
      nodes: ['A', 'B'],
      edges: [{ parent: 'A', child: 'B' }, { parent: 'B', child: 'A' }],
    };
    expect(topologicalSort(g)).toBeNull();
  });

  it('empty graph returns empty list', () => {
    expect(topologicalSort({ nodes: [], edges: [] })).toEqual([]);
  });
});

describe('summarize', () => {
  it('reports cycle count + largest', () => {
    const g: RevGraph = {
      nodes: ['A', 'B', 'C'],
      edges: [{ parent: 'A', child: 'B' }, { parent: 'B', child: 'C' }, { parent: 'C', child: 'A' }],
    };
    const r = detectCycles(g);
    const s = summarize(g, r);
    expect(s.cycleCount).toBeGreaterThan(0);
    expect(s.largestCycleSize).toBeGreaterThanOrEqual(2);
  });

  it('acyclic graph → zero cycles', () => {
    const g: RevGraph = {
      nodes: ['A', 'B'],
      edges: [{ parent: 'A', child: 'B' }],
    };
    const r = detectCycles(g);
    const s = summarize(g, r);
    expect(s.cycleCount).toBe(0);
    expect(s.largestCycleSize).toBe(0);
  });
});
