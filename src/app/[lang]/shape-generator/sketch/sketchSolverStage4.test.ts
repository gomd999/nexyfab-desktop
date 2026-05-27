import { describe, it, expect } from 'vitest';
import {
  solveLarge,
  analyzeConvergence,
  makeDistanceConstraint,
  makeHorizontalConstraint,
  makeVerticalConstraint,
  type ConstraintEntity,
} from './sketchSolverStage4';

function ent(id: string, x: number, y: number, pinned: boolean = false): ConstraintEntity {
  return { id, positions: [x, y], pinned };
}

describe('solveLarge', () => {
  it('returns immediately with no constraints', () => {
    const r = solveLarge([ent('a', 0, 0), ent('b', 5, 0)], []);
    expect(r.entities.size).toBe(2);
    expect(r.componentSizes.length).toBeGreaterThanOrEqual(2);
  });

  it('partitions disconnected entities into separate components', () => {
    const r = solveLarge(
      [ent('a', 0, 0), ent('b', 5, 0), ent('c', 100, 0), ent('d', 105, 0)],
      [makeDistanceConstraint('a', 'b', 10), makeDistanceConstraint('c', 'd', 10)],
    );
    expect(r.componentSizes.length).toBe(2);
  });

  it('solves a simple distance constraint approximately', () => {
    const r = solveLarge(
      [ent('a', 0, 0, true), ent('b', 5, 0)],
      [makeDistanceConstraint('a', 'b', 10)],
      { maxIterations: 200, blockSize: 10 },
    );
    const b = r.entities.get('b')!;
    const distance = Math.hypot(b.positions[0]!, b.positions[1]!);
    expect(Math.abs(distance - 10)).toBeLessThan(1);
  });

  it('produces residual history', () => {
    const r = solveLarge(
      [ent('a', 0, 0, true), ent('b', 5, 0)],
      [makeDistanceConstraint('a', 'b', 10)],
      { maxIterations: 50 },
    );
    expect(r.residualHistory.length).toBeGreaterThan(0);
    expect(r.residualHistory.length).toBeLessThanOrEqual(50);
  });

  it('reports component sizes summing to entity count', () => {
    const entities = [ent('a', 0, 0), ent('b', 1, 0), ent('c', 2, 0), ent('d', 100, 0)];
    const r = solveLarge(entities, [makeDistanceConstraint('a', 'b', 2)]);
    const total = r.componentSizes.reduce((s, n) => s + n, 0);
    expect(total).toBe(4);
  });

  it('respects pinned entities', () => {
    const r = solveLarge(
      [ent('a', 0, 0, true), ent('b', 1, 0)],
      [makeDistanceConstraint('a', 'b', 100)],
      { maxIterations: 5 },
    );
    const a = r.entities.get('a')!;
    expect(a.positions).toEqual([0, 0]);
  });

  it('horizontal constraint aligns y coordinates', () => {
    const r = solveLarge(
      [ent('a', 0, 0, true), ent('b', 5, 7)],
      [makeHorizontalConstraint('a', 'b')],
      { maxIterations: 200 },
    );
    expect(Math.abs(r.entities.get('b')!.positions[1]!)).toBeLessThan(2);
  });

  it('vertical constraint aligns x coordinates', () => {
    const r = solveLarge(
      [ent('a', 0, 0, true), ent('b', 7, 5)],
      [makeVerticalConstraint('a', 'b')],
      { maxIterations: 200 },
    );
    expect(Math.abs(r.entities.get('b')!.positions[0]!)).toBeLessThan(2);
  });
});

describe('analyzeConvergence', () => {
  it('reports zeros for empty history', () => {
    const stats = analyzeConvergence({ entities: new Map(), residualHistory: [], converged: false, componentSizes: [] });
    expect(stats.iterationsRun).toBe(0);
    expect(stats.initialResidual).toBe(0);
  });

  it('detects monotonic decrease', () => {
    const stats = analyzeConvergence({
      entities: new Map(),
      residualHistory: [10, 5, 2, 1],
      converged: true,
      componentSizes: [],
    });
    expect(stats.monotonic).toBe(true);
    expect(stats.reductionFraction).toBeCloseTo(0.9, 5);
  });

  it('detects non-monotonic', () => {
    const stats = analyzeConvergence({
      entities: new Map(),
      residualHistory: [10, 5, 12, 1],
      converged: false,
      componentSizes: [],
    });
    expect(stats.monotonic).toBe(false);
  });

  it('reports iteration count', () => {
    const stats = analyzeConvergence({
      entities: new Map(),
      residualHistory: [3, 2, 1],
      converged: true,
      componentSizes: [],
    });
    expect(stats.iterationsRun).toBe(3);
  });
});

describe('constraint helpers', () => {
  it('makeDistanceConstraint computes residual = observed - target', () => {
    const c = makeDistanceConstraint('a', 'b', 10);
    const map = new Map<string, ConstraintEntity>();
    map.set('a', ent('a', 0, 0));
    map.set('b', ent('b', 7, 0));
    expect(c.residual(map)).toBeCloseTo(-3, 5);
  });

  it('makeHorizontalConstraint returns y delta', () => {
    const c = makeHorizontalConstraint('a', 'b');
    const map = new Map<string, ConstraintEntity>();
    map.set('a', ent('a', 0, 0));
    map.set('b', ent('b', 1, 5));
    expect(c.residual(map)).toBe(5);
  });

  it('makeVerticalConstraint returns x delta', () => {
    const c = makeVerticalConstraint('a', 'b');
    const map = new Map<string, ConstraintEntity>();
    map.set('a', ent('a', 0, 0));
    map.set('b', ent('b', 4, 5));
    expect(c.residual(map)).toBe(4);
  });
});
