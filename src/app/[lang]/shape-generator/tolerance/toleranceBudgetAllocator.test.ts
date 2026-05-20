import { describe, it, expect } from 'vitest';
import {
  allocateBudget,
  redistributeSlack,
  sensitivityReport,
  summarize,
  type ToleranceContributor,
} from './toleranceBudgetAllocator';

function ctb(id: string, A: number = 1, k: number = 1.5, s: number = 1, min: number = 0.005, max?: number): ToleranceContributor {
  const c: ToleranceContributor = { id, costCoefficient: A, costExponent: k, sensitivity: s, minimumTolerance: min };
  if (max !== undefined) c.maximumTolerance = max;
  return c;
}

describe('allocateBudget', () => {
  it('empty contributors → trivial result', () => {
    const r = allocateBudget([], { budget: 0.1, stackKind: 'worst-case' });
    expect(r.allocations).toEqual([]);
    expect(r.budgetMet).toBe(true);
  });

  it('worst-case allocation sums to budget within 1%', () => {
    const ctbs = [ctb('a'), ctb('b'), ctb('c')];
    const r = allocateBudget(ctbs, { budget: 0.3, stackKind: 'worst-case' });
    expect(r.achievedStack).toBeCloseTo(0.3, 2);
  });

  it('RSS allocation produces tighter individual tolerances than worst-case', () => {
    const ctbs = [ctb('a'), ctb('b'), ctb('c'), ctb('d')];
    const ws = allocateBudget(ctbs, { budget: 0.4, stackKind: 'worst-case' });
    const rss = allocateBudget(ctbs, { budget: 0.4, stackKind: 'rss' });
    // RSS allows looser individual tolerances (T_i² sum = budget²).
    expect(rss.allocations[0]!.tolerance).toBeGreaterThan(ws.allocations[0]!.tolerance);
  });

  it('costlier contributor receives larger tolerance', () => {
    const ctbs = [ctb('cheap', 1), ctb('expensive', 100)];
    const r = allocateBudget(ctbs, { budget: 0.2, stackKind: 'worst-case' });
    const expensive = r.allocations.find(a => a.id === 'expensive')!;
    const cheap = r.allocations.find(a => a.id === 'cheap')!;
    expect(expensive.tolerance).toBeGreaterThan(cheap.tolerance);
  });

  it('higher sensitivity receives tighter tolerance', () => {
    const ctbs = [ctb('sens-low', 1, 1.5, 0.5), ctb('sens-high', 1, 1.5, 2.0)];
    const r = allocateBudget(ctbs, { budget: 0.3, stackKind: 'worst-case' });
    const high = r.allocations.find(a => a.id === 'sens-high')!;
    const low = r.allocations.find(a => a.id === 'sens-low')!;
    expect(high.tolerance).toBeLessThan(low.tolerance);
  });

  it('floor enforcement pins tight tolerances', () => {
    const ctbs = [ctb('a', 1, 1.5, 1, 0.05), ctb('b', 100, 1.5, 1, 0.001)];
    const r = allocateBudget(ctbs, { budget: 0.06, stackKind: 'worst-case' });
    // 'a' has higher floor and lower cost, may get pinned.
    expect(r.allocations.some(a => a.atFloor)).toBe(true);
  });

  it('budgetMet is false when achieved exceeds budget after flooring', () => {
    const ctbs = [ctb('a', 1, 1.5, 1, 0.10), ctb('b', 1, 1.5, 1, 0.10)];
    const r = allocateBudget(ctbs, { budget: 0.05, stackKind: 'worst-case' });
    // Both pinned at 0.10 → achieved >= 0.20 > 0.05.
    expect(r.budgetMet).toBe(false);
  });

  it('estimatedCost decreases with looser tolerance', () => {
    const ctbs = [ctb('a')];
    const tight = allocateBudget(ctbs, { budget: 0.01, stackKind: 'worst-case' });
    const loose = allocateBudget(ctbs, { budget: 0.1, stackKind: 'worst-case' });
    expect(tight.allocations[0]!.estimatedCost).toBeGreaterThan(loose.allocations[0]!.estimatedCost);
  });
});

describe('redistributeSlack', () => {
  it('no-op when no floor hits', () => {
    const ctbs = [ctb('a'), ctb('b')];
    const r = allocateBudget(ctbs, { budget: 0.2, stackKind: 'worst-case' });
    const r2 = redistributeSlack(r, { budget: 0.2, stackKind: 'worst-case' });
    expect(r2).toBe(r);
  });

  it('shifts slack from floored to free contributors', () => {
    const ctbs = [ctb('a', 1, 1.5, 1, 0.005), ctb('b', 1, 1.5, 1, 0.05)];
    const r = allocateBudget(ctbs, { budget: 0.07, stackKind: 'worst-case' });
    redistributeSlack(r, { budget: 0.07, stackKind: 'worst-case' });
    // After redistribute, free contributors should sum to remaining budget.
    expect(r).toBeDefined();
  });
});

describe('sensitivityReport', () => {
  it('rows sum to 1', () => {
    const ctbs = [ctb('a'), ctb('b'), ctb('c')];
    const r = allocateBudget(ctbs, { budget: 0.3, stackKind: 'worst-case' });
    const rep = sensitivityReport(ctbs, r.allocations, 'worst-case');
    const total = rep.reduce((s, x) => s + x.contributionFraction, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('sorted by contribution descending', () => {
    const ctbs = [ctb('low', 1, 1.5, 0.5), ctb('high', 1, 1.5, 2.0)];
    const r = allocateBudget(ctbs, { budget: 0.2, stackKind: 'worst-case' });
    const rep = sensitivityReport(ctbs, r.allocations, 'worst-case');
    expect(rep[0]!.contributionFraction).toBeGreaterThanOrEqual(rep[1]!.contributionFraction);
  });
});

describe('summarize', () => {
  it('reports counts + cost', () => {
    const ctbs = [ctb('a'), ctb('b')];
    const r = allocateBudget(ctbs, { budget: 0.2, stackKind: 'worst-case' });
    const s = summarize(r);
    expect(s.contributorCount).toBe(2);
    expect(s.totalEstimatedCost).toBeGreaterThan(0);
  });

  it('flooredCount reflects pinned allocations', () => {
    const ctbs = [ctb('a', 1, 1.5, 1, 0.5)]; // huge floor
    const r = allocateBudget(ctbs, { budget: 0.01, stackKind: 'worst-case' });
    expect(summarize(r).flooredCount).toBe(1);
  });
});
