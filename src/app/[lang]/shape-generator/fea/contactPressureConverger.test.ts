import { describe, it, expect } from 'vitest';
import {
  runConvergence,
  dampedRelaxation,
  summarize,
  type IterationState,
  type IteratorFn,
} from './contactPressureConverger';

function decayingIterator(): IteratorFn {
  let n = 0;
  return (_prev): IterationState => {
    n++;
    return {
      iteration: n,
      maxPressureMpa: 100 * Math.pow(0.5, n),
      maxPenetrationMm: 0.001 * Math.pow(0.5, n),
      forceResidualN: 0.5 * Math.pow(0.5, n),
    };
  };
}

function risingIterator(): IteratorFn {
  let n = 0;
  return (_prev): IterationState => {
    n++;
    return { iteration: n, maxPressureMpa: n * 10, maxPenetrationMm: 0.1, forceResidualN: 5 };
  };
}

function oscillatingIterator(): IteratorFn {
  let n = 0;
  return (_prev): IterationState => {
    n++;
    return {
      iteration: n,
      maxPressureMpa: 50 + (n % 2 === 0 ? 10 : -10),
      maxPenetrationMm: 0.005,
      forceResidualN: 2,
    };
  };
}

describe('runConvergence', () => {
  it('decaying iterator converges quickly', () => {
    const r = runConvergence(decayingIterator(), { pressureToleranceMpa: 0.05, penetrationToleranceMm: 0.01, forceResidualN: 1, maxIterations: 30 });
    expect(r.converged).toBe(true);
  });

  it('rising iterator does not converge', () => {
    const r = runConvergence(risingIterator(), { maxIterations: 10 });
    expect(r.converged).toBe(false);
  });

  it('oscillating trajectory classified', () => {
    const r = runConvergence(oscillatingIterator(), { maxIterations: 8 });
    expect(r.trajectory).toBe('oscillating');
  });

  it('rising trajectory classified', () => {
    const r = runConvergence(risingIterator(), { maxIterations: 8 });
    expect(r.trajectory).toBe('monotone-rising');
  });

  it('decaying trajectory classified', () => {
    const r = runConvergence(decayingIterator(), { maxIterations: 8, pressureToleranceMpa: 0.0001, penetrationToleranceMm: 0.0001, forceResidualN: 0.0001 });
    expect(r.trajectory).toBe('monotone-falling');
  });

  it('recommendation provided', () => {
    const r = runConvergence(oscillatingIterator(), { maxIterations: 6 });
    expect(r.recommendation.length).toBeGreaterThan(0);
  });

  it('states list grows with iterations', () => {
    const r = runConvergence(risingIterator(), { maxIterations: 5 });
    expect(r.states).toHaveLength(5);
  });

  it('final state reported', () => {
    const r = runConvergence(decayingIterator(), { maxIterations: 30 });
    expect(r.finalState).not.toBeNull();
  });
});

describe('dampedRelaxation', () => {
  it('blends new and old values', () => {
    const iter = dampedRelaxation((_prev) => ({
      maxPressureMpa: 100,
      maxPenetrationMm: 0.01,
      forceResidualN: 1,
    }), 0.5);
    const first = iter(null);
    const second = iter(first);
    // first = raw, second = first + 0.5*(raw - first) = (100 + 100)/2 = 100. Stable case.
    expect(second.maxPressureMpa).toBeCloseTo(100, 3);
  });

  it('damping smooths fluctuation', () => {
    let flag = true;
    const iter = dampedRelaxation((_prev) => {
      flag = !flag;
      return { maxPressureMpa: flag ? 100 : 0, maxPenetrationMm: 0.01, forceResidualN: 1 };
    }, 0.5);
    const s1 = iter(null);
    const s2 = iter(s1);
    // Second should be halfway between s1 and toggled value, NOT the toggle itself.
    expect(s2.maxPressureMpa).not.toBe(0);
    expect(s2.maxPressureMpa).not.toBe(100);
  });
});

describe('summarize', () => {
  it('reports key metrics', () => {
    const r = runConvergence(decayingIterator(), { maxIterations: 20, pressureToleranceMpa: 0.05, penetrationToleranceMm: 0.01, forceResidualN: 1 });
    const s = summarize(r);
    expect(s.iterations).toBeGreaterThan(0);
    expect(s.finalPressureMpa).toBeGreaterThanOrEqual(0);
  });

  it('converged flag passed through', () => {
    const r = runConvergence(decayingIterator(), { maxIterations: 20, pressureToleranceMpa: 0.05, penetrationToleranceMm: 0.01, forceResidualN: 1 });
    expect(summarize(r).converged).toBe(true);
  });
});
