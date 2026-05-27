import { describe, it, expect } from 'vitest';
import {
  solveStatic,
  summarize,
  type Node,
  type Element,
  type AppliedLoad,
} from './staticLinearSolver';

describe('solveStatic', () => {
  it('empty inputs → unsolved', () => {
    const r = solveStatic([], [], []);
    expect(r.ok).toBe(false);
  });

  it('two-spring 1D system solves', () => {
    const nodes: Node[] = [
      { id: 'a', x: 0, fixed: true },
      { id: 'b', x: 1 },
      { id: 'c', x: 2 },
    ];
    const elements: Element[] = [
      { kind: 'spring', id: 'k1', nodeA: 'a', nodeB: 'b', stiffness: 100 },
      { kind: 'spring', id: 'k2', nodeA: 'b', nodeB: 'c', stiffness: 100 },
    ];
    const loads: AppliedLoad[] = [{ nodeId: 'c', fx: 10 }];
    const r = solveStatic(nodes, elements, loads);
    expect(r.ok).toBe(true);
    // Node c displacement = F / k_total_series; series k = 50. δ = 10/50 = 0.2.
    expect(r.displacements.get('c')!.dx).toBeCloseTo(0.2, 4);
  });

  it('fixed node has zero displacement', () => {
    const nodes: Node[] = [
      { id: 'a', x: 0, fixed: true },
      { id: 'b', x: 1 },
    ];
    const elements: Element[] = [{ kind: 'spring', id: 'k', nodeA: 'a', nodeB: 'b', stiffness: 100 }];
    const loads: AppliedLoad[] = [{ nodeId: 'b', fx: 10 }];
    const r = solveStatic(nodes, elements, loads);
    expect(r.displacements.get('a')!.dx).toBe(0);
  });

  it('reaction force at fixed node balances load', () => {
    const nodes: Node[] = [
      { id: 'a', x: 0, fixed: true },
      { id: 'b', x: 1 },
    ];
    const elements: Element[] = [{ kind: 'spring', id: 'k', nodeA: 'a', nodeB: 'b', stiffness: 100 }];
    const loads: AppliedLoad[] = [{ nodeId: 'b', fx: 50 }];
    const r = solveStatic(nodes, elements, loads);
    expect(r.reactions.get('a')!.fx).toBeCloseTo(-50, 3);
  });

  it('truss element computes stress (two-truss V system)', () => {
    // Two trusses in a V shape converging at a free apex.
    const nodes: Node[] = [
      { id: 'a', x: 0, y: 0, fixed: true },
      { id: 'b', x: 2000, y: 0, fixed: true },
      { id: 'apex', x: 1000, y: -1000 },
    ];
    const elements: Element[] = [
      { kind: 'truss', id: 't1', nodeA: 'a', nodeB: 'apex', youngMpa: 200000, areaMm2: 10 },
      { kind: 'truss', id: 't2', nodeA: 'b', nodeB: 'apex', youngMpa: 200000, areaMm2: 10 },
    ];
    const loads: AppliedLoad[] = [{ nodeId: 'apex', fx: 0, fy: -1000 }];
    const r = solveStatic(nodes, elements, loads);
    expect(r.ok).toBe(true);
    expect(Math.abs(r.elementForces.get('t1')!.stress)).toBeGreaterThan(0);
  });

  it('all fixed nodes returns error', () => {
    const nodes: Node[] = [{ id: 'a', x: 0, fixed: true }, { id: 'b', x: 1, fixed: true }];
    const elements: Element[] = [{ kind: 'spring', id: 'k', nodeA: 'a', nodeB: 'b', stiffness: 100 }];
    const r = solveStatic(nodes, elements, []);
    expect(r.ok).toBe(false);
  });

  it('parallel springs sum stiffness', () => {
    const nodes: Node[] = [
      { id: 'a', x: 0, fixed: true },
      { id: 'b', x: 1 },
    ];
    const elements: Element[] = [
      { kind: 'spring', id: 'k1', nodeA: 'a', nodeB: 'b', stiffness: 50 },
      { kind: 'spring', id: 'k2', nodeA: 'a', nodeB: 'b', stiffness: 50 },
    ];
    const loads: AppliedLoad[] = [{ nodeId: 'b', fx: 100 }];
    const r = solveStatic(nodes, elements, loads);
    // Parallel k = 100, δ = 1.
    expect(r.displacements.get('b')!.dx).toBeCloseTo(1, 3);
  });

  it('singular system returns unsolved', () => {
    const nodes: Node[] = [{ id: 'a', x: 0 }, { id: 'b', x: 1 }];
    // Unfixed — singular without BCs.
    const elements: Element[] = [{ kind: 'spring', id: 'k', nodeA: 'a', nodeB: 'b', stiffness: 100 }];
    const r = solveStatic(nodes, elements, [{ nodeId: 'b', fx: 10 }]);
    expect(r.ok).toBe(false);
  });
});

describe('summarize', () => {
  it('reports counts and max stress', () => {
    const nodes: Node[] = [{ id: 'a', x: 0, fixed: true }, { id: 'b', x: 1 }];
    const elements: Element[] = [{ kind: 'spring', id: 'k', nodeA: 'a', nodeB: 'b', stiffness: 100 }];
    const loads: AppliedLoad[] = [{ nodeId: 'b', fx: 10 }];
    const r = solveStatic(nodes, elements, loads);
    const s = summarize(nodes, elements, loads, r);
    expect(s.nodeCount).toBe(2);
    expect(s.elementCount).toBe(1);
    expect(s.loadCount).toBe(1);
    expect(s.solved).toBe(true);
  });

  it('empty', () => {
    const r = solveStatic([], [], []);
    const s = summarize([], [], [], r);
    expect(s.solved).toBe(false);
  });
});
