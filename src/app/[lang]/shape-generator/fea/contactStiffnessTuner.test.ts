import { describe, it, expect } from 'vitest';
import {
  suggestInitial,
  adjustFromIterations,
  pickMethod,
  summarize,
  type ContactPair,
  type IterationData,
} from './contactStiffnessTuner';

function pair(id: string = 'c1', frictional: boolean = false): ContactPair {
  return { id, effectiveYoungMpa: 200000, elementSizeMm: 1, frictional };
}

function iter(idx: number, pen: number, res: number, conv: boolean = true): IterationData {
  return { iteration: idx, maxPenetrationMm: pen, residual: res, converged: conv };
}

describe('suggestInitial', () => {
  it('produces positive stiffness', () => {
    const r = suggestInitial(pair());
    expect(r.normalStiffness).toBeGreaterThan(0);
  });

  it('frictional → positive tangential', () => {
    const r = suggestInitial(pair('c1', true));
    expect(r.tangentialStiffness).toBeGreaterThan(0);
  });

  it('non-frictional → zero tangential', () => {
    const r = suggestInitial(pair('c1', false));
    expect(r.tangentialStiffness).toBe(0);
  });

  it('initial multiplier respected', () => {
    const high = suggestInitial(pair(), { initialMultiplier: 100 });
    const low = suggestInitial(pair(), { initialMultiplier: 1 });
    expect(high.normalStiffness).toBeGreaterThan(low.normalStiffness);
  });
});

describe('adjustFromIterations', () => {
  it('no iterations → returns initial', () => {
    const r = adjustFromIterations(pair(), 1000, []);
    expect(r.action).toBe('use-initial');
  });

  it('high penetration → increase', () => {
    const r = adjustFromIterations(pair(), 1000, [iter(1, 1, 0.001, true)]);
    expect(r.action).toBe('increase');
    expect(r.normalStiffness).toBeGreaterThan(1000);
  });

  it('oscillation → decrease', () => {
    const iters = [
      iter(1, 0.001, 1),
      iter(2, 0.001, 5),
      iter(3, 0.001, 0.5),
    ];
    const r = adjustFromIterations(pair(), 1000, iters);
    expect(r.action).toBe('decrease');
    expect(r.normalStiffness).toBeLessThan(1000);
  });

  it('many non-convergent iters → switch method', () => {
    const iters = Array.from({ length: 25 }, (_, i) => iter(i, 0.0001, 1, false));
    const r = adjustFromIterations(pair(), 1000, iters);
    expect(r.action).toBe('switch-method');
  });

  it('converged + low penetration → keep', () => {
    const r = adjustFromIterations(pair(), 1000, [iter(1, 0.0001, 0.0001, true)]);
    expect(r.action).toBe('use-initial');
  });
});

describe('pickMethod', () => {
  it('penalty by default', () => {
    expect(pickMethod(pair(), []).method).toBe('penalty');
  });

  it('Lagrange when penetration too high', () => {
    expect(pickMethod(pair(), [iter(1, 0.1, 1, true)]).method).toBe('lagrange-multiplier');
  });

  it('Augmented Lagrange for slow frictional', () => {
    const iters = Array.from({ length: 20 }, (_, i) => iter(i, 0.001, 1, false));
    expect(pickMethod(pair('c1', true), iters).method).toBe('augmented-lagrange');
  });
});

describe('summarize', () => {
  it('reports initial + final + iteration count', () => {
    const s = summarize(pair(), 1000, [iter(1, 0.0001, 0.0001, true)]);
    expect(s.iterationCount).toBe(1);
    expect(s.initialStiffness).toBeGreaterThan(0);
  });

  it('reports recommended method', () => {
    const s = summarize(pair(), 1000, [iter(1, 0.1, 1, true)]);
    expect(['penalty', 'lagrange-multiplier', 'augmented-lagrange']).toContain(s.recommendedMethod);
  });
});
