import { describe, it, expect } from 'vitest';
import {
  optimizeOrder,
  greedyNearestNeighbour,
  enforcePrecedence,
  twoOptImprovement,
  evaluateOrder,
  orderByToolGroup,
  type CamOperation,
} from './operationOrdering';

function makeOp(id: string, tool: string, x: number, y: number, opts: Partial<CamOperation> = {}): CamOperation {
  return {
    id,
    toolId: tool,
    kind: 'mill',
    startMm: [x, y, 0],
    endMm: [x + 1, y, 0],
    ...opts,
  };
}

describe('greedyNearestNeighbour', () => {
  it('orders by proximity', () => {
    const ops = [
      makeOp('far', 't1', 100, 0),
      makeOp('mid', 't1', 50, 0),
      makeOp('near', 't1', 10, 0),
    ];
    const order = greedyNearestNeighbour(ops, { rapidRateMmPerSec: 500, defaultToolChangeSec: 0, maxIterations: 0 });
    expect(order[0]).toBe('near');
  });

  it('prefers same-tool ops when tool change is expensive', () => {
    const ops = [
      makeOp('a', 't1', 0, 0),
      makeOp('b', 't2', 1, 0),
      makeOp('c', 't1', 100, 0),
    ];
    const order = greedyNearestNeighbour(ops, { rapidRateMmPerSec: 500, defaultToolChangeSec: 999, maxIterations: 0 });
    expect(order[1]).toBe('c'); // same tool as a, even though b is closer
  });
});

describe('enforcePrecedence', () => {
  it('places after-deps before their dependents', () => {
    const ops = [
      makeOp('tap', 't2', 0, 0, { afterIds: ['drill'] }),
      makeOp('drill', 't1', 0, 0),
    ];
    const order = enforcePrecedence(['tap', 'drill'], ops);
    expect(order.indexOf('drill')).toBeLessThan(order.indexOf('tap'));
  });

  it('preserves original order when no precedence conflict', () => {
    const ops = [makeOp('a', 't1', 0, 0), makeOp('b', 't1', 1, 0)];
    expect(enforcePrecedence(['a', 'b'], ops)).toEqual(['a', 'b']);
  });

  it('handles cycle gracefully (appends remaining)', () => {
    const ops = [
      makeOp('a', 't1', 0, 0, { afterIds: ['b'] }),
      makeOp('b', 't1', 1, 0, { afterIds: ['a'] }),
    ];
    const order = enforcePrecedence(['a', 'b'], ops);
    expect(order).toHaveLength(2);
  });
});

describe('twoOptImprovement', () => {
  it('does not break precedence', () => {
    const ops = [
      makeOp('a', 't1', 100, 0),
      makeOp('b', 't1', 0, 0, { afterIds: ['a'] }),
    ];
    const result = twoOptImprovement(['a', 'b'], ops, { rapidRateMmPerSec: 500, defaultToolChangeSec: 0, maxIterations: 50 });
    expect(result.indexOf('a')).toBeLessThan(result.indexOf('b'));
  });

  it('shortens total path for collinear points', () => {
    const ops = [
      makeOp('a', 't1', 0, 0),
      makeOp('b', 't1', 30, 0),
      makeOp('c', 't1', 10, 0),
      makeOp('d', 't1', 20, 0),
    ];
    const initial = ['a', 'b', 'c', 'd'];
    const initCost = evaluateOrder(initial, ops).totalRapidMm;
    const improved = twoOptImprovement(initial, ops, { rapidRateMmPerSec: 500, defaultToolChangeSec: 0, maxIterations: 50 });
    const finalCost = evaluateOrder(improved, ops).totalRapidMm;
    expect(finalCost).toBeLessThanOrEqual(initCost);
  });
});

describe('evaluateOrder', () => {
  it('reports rapid distance', () => {
    const ops = [
      makeOp('a', 't1', 10, 0),
      makeOp('b', 't1', 20, 0),
    ];
    const r = evaluateOrder(['a', 'b'], ops, { startPosition: [0, 0, 0] });
    expect(r.totalRapidMm).toBeGreaterThan(0);
  });

  it('counts tool changes', () => {
    const ops = [
      makeOp('a', 't1', 0, 0),
      makeOp('b', 't2', 1, 0),
      makeOp('c', 't1', 2, 0),
    ];
    const r = evaluateOrder(['a', 'b', 'c'], ops);
    expect(r.toolChangeCount).toBe(2);
  });

  it('precedence flag is true for valid order', () => {
    const ops = [
      makeOp('a', 't1', 0, 0),
      makeOp('b', 't1', 1, 0, { afterIds: ['a'] }),
    ];
    expect(evaluateOrder(['a', 'b'], ops).precedenceSatisfied).toBe(true);
  });

  it('precedence flag is false for violated order', () => {
    const ops = [
      makeOp('a', 't1', 0, 0),
      makeOp('b', 't1', 1, 0, { afterIds: ['a'] }),
    ];
    expect(evaluateOrder(['b', 'a'], ops).precedenceSatisfied).toBe(false);
  });
});

describe('optimizeOrder', () => {
  it('respects precedence in optimized output', () => {
    const ops = [
      makeOp('drill', 't1', 100, 0),
      makeOp('tap', 't2', 0, 0, { afterIds: ['drill'] }),
      makeOp('chamfer', 't3', 50, 0, { afterIds: ['drill'] }),
    ];
    const r = optimizeOrder(ops);
    expect(r.order.indexOf('drill')).toBeLessThan(r.order.indexOf('tap'));
    expect(r.order.indexOf('drill')).toBeLessThan(r.order.indexOf('chamfer'));
    expect(r.precedenceSatisfied).toBe(true);
  });

  it('empty input → empty result', () => {
    const r = optimizeOrder([]);
    expect(r.order).toHaveLength(0);
    expect(r.totalCostSec).toBe(0);
  });

  it('produces all ops in order', () => {
    const ops = [makeOp('a', 't1', 0, 0), makeOp('b', 't1', 1, 0), makeOp('c', 't1', 2, 0)];
    expect(optimizeOrder(ops).order).toHaveLength(3);
  });
});

describe('orderByToolGroup', () => {
  it('clusters same-tool ops', () => {
    const ops = [
      makeOp('a1', 't1', 0, 0),
      makeOp('b1', 't2', 1, 0),
      makeOp('a2', 't1', 2, 0),
    ];
    const order = orderByToolGroup(ops, { rapidRateMmPerSec: 500, defaultToolChangeSec: 0, maxIterations: 0 });
    const tools = order.map(id => ops.find(o => o.id === id)!.toolId);
    // Same-tool ops are contiguous.
    const t1Indices = tools.map((t, i) => t === 't1' ? i : -1).filter(i => i >= 0);
    expect(t1Indices[1]! - t1Indices[0]!).toBe(1);
  });
});
