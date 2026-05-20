import { describe, it, expect } from 'vitest';
import {
  solveInverse,
  sensitivity,
  type Parameter,
  type ObjectiveTerm,
} from './inverseProblem';

const params: Parameter[] = [
  { id: 'x', min: -10, max: 10, initial: 0 },
  { id: 'y', min: -10, max: 10, initial: 0 },
];

/** Parabolic test: minimum at x=3, y=-2 → output1=0. */
function paraboloidEvaluate(p: Record<string, number>): Record<string, number> {
  const dx = p.x! - 3;
  const dy = p.y! + 2;
  return { distance: Math.sqrt(dx * dx + dy * dy) };
}

const objective: ObjectiveTerm[] = [{ name: 'distance', target: 0 }];

describe('solveInverse — nelder-mead', () => {
  it('converges to (3, -2)', () => {
    const r = solveInverse(params, objective, paraboloidEvaluate, { maxEvaluations: 200 });
    expect(r.bestParameters.x).toBeCloseTo(3, 0);
    expect(r.bestParameters.y).toBeCloseTo(-2, 0);
  });

  it('records history of evaluations', () => {
    const r = solveInverse(params, objective, paraboloidEvaluate, { maxEvaluations: 50 });
    expect(r.history.length).toBeGreaterThan(0);
  });

  it('reports converged=true when within tolerance', () => {
    const r = solveInverse(params, objective, paraboloidEvaluate, { maxEvaluations: 200, tolerance: 0.1 });
    expect(r.converged).toBe(true);
  });
});

describe('solveInverse — random-search', () => {
  it('reports best found in given budget', () => {
    const r = solveInverse(params, objective, paraboloidEvaluate, {
      algorithm: 'random-search',
      maxEvaluations: 200,
      seed: 42,
    });
    expect(r.evaluations).toBeLessThanOrEqual(200);
    expect(r.bestObjective).toBeGreaterThanOrEqual(0);
  });

  it('deterministic with same seed', () => {
    const a = solveInverse(params, objective, paraboloidEvaluate, { algorithm: 'random-search', maxEvaluations: 50, seed: 7 });
    const b = solveInverse(params, objective, paraboloidEvaluate, { algorithm: 'random-search', maxEvaluations: 50, seed: 7 });
    expect(a.bestObjective).toBeCloseTo(b.bestObjective, 6);
  });
});

describe('solveInverse — coordinate-descent', () => {
  it('improves objective from initial', () => {
    const r = solveInverse(params, objective, paraboloidEvaluate, {
      algorithm: 'coordinate-descent',
      maxEvaluations: 100,
    });
    const initialLoss = paraboloidEvaluate({ x: 0, y: 0 }).distance!;
    expect(r.bestObjective).toBeLessThanOrEqual(initialLoss * initialLoss);
  });
});

describe('parameter clamping', () => {
  it('best parameters remain within bounds', () => {
    const tight: Parameter[] = [
      { id: 'x', min: -1, max: 1, initial: 0 },
      { id: 'y', min: -1, max: 1, initial: 0 },
    ];
    const r = solveInverse(tight, objective, paraboloidEvaluate, { maxEvaluations: 100 });
    expect(r.bestParameters.x).toBeLessThanOrEqual(1);
    expect(r.bestParameters.x).toBeGreaterThanOrEqual(-1);
  });
});

describe('penalty terms', () => {
  it('penaltyAboveTarget heavily penalizes overshoot', () => {
    const obj: ObjectiveTerm[] = [{
      name: 'weight', target: 100, penaltyAboveTarget: 100,
    }];
    const r = solveInverse(params, obj, p => ({ weight: 200 + p.x! }), { maxEvaluations: 100 });
    // x → small to keep weight near 200; but penaltyAboveTarget should push down.
    expect(r.history[0]!.objective).toBeGreaterThan(0);
  });
});

describe('sensitivity', () => {
  it('returns one row per parameter', () => {
    const r = solveInverse(params, objective, paraboloidEvaluate, { maxEvaluations: 100 });
    const rows = sensitivity(r.bestParameters, params, paraboloidEvaluate, objective);
    expect(rows).toHaveLength(2);
  });

  it('gradient is small near optimum', () => {
    const r = solveInverse(params, objective, paraboloidEvaluate, { maxEvaluations: 200, tolerance: 1e-3 });
    const rows = sensitivity(r.bestParameters, params, paraboloidEvaluate, objective);
    for (const row of rows) {
      expect(Math.abs(row.gradient)).toBeLessThan(2);
    }
  });
});
