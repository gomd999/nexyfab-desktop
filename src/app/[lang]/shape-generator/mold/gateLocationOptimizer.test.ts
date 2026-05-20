import { describe, it, expect } from 'vitest';
import {
  optimize,
  balanceRatio,
  centroidGate,
  summarize,
  type Node2D,
} from './gateLocationOptimizer';

// A symmetric cross of nodes — centre should win.
const cross: Node2D[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: -10, y: 0 },
  { x: 0, y: 10 },
  { x: 0, y: -10 },
];

describe('optimize', () => {
  it('empty nodes → warning + null best', () => {
    const r = optimize({ nodes: [] });
    expect(r.best).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('symmetric cross → centre gate best', () => {
    const r = optimize({ nodes: cross });
    expect(r.best!.gate.x).toBeCloseTo(0, 6);
    expect(r.best!.gate.y).toBeCloseTo(0, 6);
  });

  it('ranked sorted ascending by score', () => {
    const r = optimize({ nodes: cross });
    for (let i = 1; i < r.ranked.length; i++) {
      expect(r.ranked[i]!.score).toBeGreaterThanOrEqual(r.ranked[i - 1]!.score);
    }
  });

  it('custom candidates restrict gate choices', () => {
    const candidates: Node2D[] = [{ x: 10, y: 0 }, { x: -10, y: 0 }];
    const r = optimize({ nodes: cross, candidateGates: candidates });
    expect(candidates).toContainEqual(r.best!.gate);
  });

  it('centre gate has lower max flow length than corner', () => {
    const centre = optimize({ nodes: cross, candidateGates: [{ x: 0, y: 0 }] });
    const corner = optimize({ nodes: cross, candidateGates: [{ x: 10, y: 0 }] });
    expect(centre.best!.maxFlowLengthMm).toBeLessThan(corner.best!.maxFlowLengthMm);
  });

  it('imbalance penalty affects score', () => {
    const low = optimize({ nodes: cross, candidateGates: [{ x: 10, y: 0 }], imbalancePenalty: 0 });
    const high = optimize({ nodes: cross, candidateGates: [{ x: 10, y: 0 }], imbalancePenalty: 5 });
    expect(high.best!.score).toBeGreaterThan(low.best!.score);
  });

  it('weighted node increases its flow length', () => {
    const weighted: Node2D[] = [{ x: 10, y: 0, weight: 3 }, { x: -10, y: 0 }];
    const r = optimize({ nodes: weighted, candidateGates: [{ x: 0, y: 0 }] });
    expect(r.best!.maxFlowLengthMm).toBeCloseTo(30, 6);
  });
});

describe('balanceRatio', () => {
  it('centre gate on cross → ratio = max/min', () => {
    const r = optimize({ nodes: cross, candidateGates: [{ x: 0, y: 0 }] });
    // min length is 0 (node at centre) → Infinity
    expect(balanceRatio(r.best!, cross)).toBe(Infinity);
  });

  it('finite ratio when no coincident node', () => {
    const nodes: Node2D[] = [{ x: 5, y: 0 }, { x: 20, y: 0 }];
    const r = optimize({ nodes, candidateGates: [{ x: 0, y: 0 }] });
    expect(balanceRatio(r.best!, nodes)).toBeCloseTo(20 / 5, 4);
  });
});

describe('centroidGate', () => {
  it('cross centroid is origin', () => {
    const c = centroidGate(cross);
    expect(c.x).toBeCloseTo(0, 6);
    expect(c.y).toBeCloseTo(0, 6);
  });

  it('empty → origin', () => {
    expect(centroidGate([])).toEqual({ x: 0, y: 0 });
  });
});

describe('summarize', () => {
  it('reports best gate + score', () => {
    const r = optimize({ nodes: cross });
    const s = summarize(r);
    expect(s.gate).toEqual(r.best!.gate);
    expect(s.score).toBe(r.best!.score);
  });
});
