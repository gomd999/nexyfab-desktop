import { describe, it, expect } from 'vitest';
import {
  buildGraph,
  bodyDofUsage,
  diagnoseGraph,
  summarize,
  type Body,
  type Mate,
} from './mateDependencyGraph';

function body(id: string, isGround: boolean = false): Body {
  return isGround ? { id, isGround } : { id };
}

function mate(id: string, from: string, to: string, kind: string = 'concentric'): Mate {
  return { id, fromBody: from, toBody: to, kind };
}

describe('buildGraph', () => {
  it('empty → empty result', () => {
    const r = buildGraph([], []);
    expect(r.rebuildOrder).toEqual([]);
    expect(r.floatingBodies).toEqual([]);
  });

  it('linear chain ground → A → B', () => {
    const bodies = [body('G', true), body('A'), body('B')];
    const mates = [mate('m1', 'G', 'A'), mate('m2', 'A', 'B')];
    const r = buildGraph(bodies, mates);
    expect(r.rebuildOrder).toEqual(['G', 'A', 'B']);
  });

  it('depth reflects BFS distance', () => {
    const bodies = [body('G', true), body('A'), body('B')];
    const mates = [mate('m1', 'G', 'A'), mate('m2', 'A', 'B')];
    const r = buildGraph(bodies, mates);
    expect(r.depthByBody['G']).toBe(0);
    expect(r.depthByBody['A']).toBe(1);
    expect(r.depthByBody['B']).toBe(2);
  });

  it('unreachable body flagged as floating', () => {
    const bodies = [body('G', true), body('A'), body('X')];
    const mates = [mate('m1', 'G', 'A')];
    const r = buildGraph(bodies, mates);
    expect(r.floatingBodies).toContain('X');
  });

  it('cycle detected', () => {
    const bodies = [body('A', true), body('B'), body('C')];
    const mates = [mate('m1', 'A', 'B'), mate('m2', 'B', 'C'), mate('m3', 'C', 'A')];
    const r = buildGraph(bodies, mates);
    expect(r.cycles.length).toBeGreaterThan(0);
  });

  it('no cycle on linear chain', () => {
    const bodies = [body('A', true), body('B')];
    const mates = [mate('m1', 'A', 'B')];
    const r = buildGraph(bodies, mates);
    expect(r.cycles).toEqual([]);
  });

  it('no ground → first body used as datum', () => {
    const bodies = [body('A'), body('B')];
    const mates = [mate('m1', 'A', 'B')];
    const r = buildGraph(bodies, mates);
    expect(r.rebuildOrder[0]).toBe('A');
  });
});

describe('bodyDofUsage', () => {
  it('counts inbound + outbound mates', () => {
    const bodies = [body('A', true), body('B'), body('C')];
    const mates = [mate('m1', 'A', 'B'), mate('m2', 'A', 'C')];
    const result = buildGraph(bodies, mates);
    const dof = bodyDofUsage(bodies, mates, result);
    const a = dof.find(d => d.bodyId === 'A')!;
    expect(a.outboundMateCount).toBe(2);
    expect(a.inboundMateCount).toBe(0);
  });

  it('floating body depth -1', () => {
    const bodies = [body('A', true), body('X')];
    const result = buildGraph(bodies, []);
    const dof = bodyDofUsage(bodies, [], result);
    const x = dof.find(d => d.bodyId === 'X')!;
    expect(x.depth).toBe(-1);
  });
});

describe('diagnoseGraph', () => {
  it('floating bodies → warn diagnostic', () => {
    const bodies = [body('A', true), body('X')];
    const result = buildGraph(bodies, []);
    const diag = diagnoseGraph(result, bodies);
    expect(diag.some(d => d.severity === 'warn')).toBe(true);
  });

  it('cycles → error diagnostic', () => {
    const bodies = [body('A', true), body('B')];
    const mates = [mate('m1', 'A', 'B'), mate('m2', 'B', 'A')];
    const result = buildGraph(bodies, mates);
    const diag = diagnoseGraph(result, bodies);
    expect(diag.some(d => d.severity === 'error')).toBe(true);
  });

  it('no ground → info diagnostic', () => {
    const bodies = [body('A'), body('B')];
    const result = buildGraph(bodies, []);
    const diag = diagnoseGraph(result, bodies);
    expect(diag.some(d => d.severity === 'info')).toBe(true);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const bodies = [body('A', true), body('B')];
    const mates = [mate('m1', 'A', 'B')];
    const result = buildGraph(bodies, mates);
    const s = summarize(bodies, mates, result);
    expect(s.bodyCount).toBe(2);
    expect(s.mateCount).toBe(1);
    expect(s.rebuildOrderLength).toBe(2);
  });
});
