import { describe, it, expect } from 'vitest';
import {
  evaluateBudget,
  formatViolation,
  formatBudgetReport,
  assertBudget,
  type BudgetFile,
} from './perfBudget';

const budget: BudgetFile = {
  version: 1,
  entries: [
    { label: 'LCP', path: 'webVitals.lcp', limit: 2500, kind: 'lt' },
    { label: 'TBT', path: 'webVitals.tbt', limit: 300, kind: 'lt' },
    { label: 'bundle.js', path: 'bundles.main', limit: 250_000, kind: 'lt', severity: 'warn' },
    { label: 'lighthouse-perf', path: 'lighthouse.performance', limit: 80, kind: 'gt' },
  ],
};

describe('evaluateBudget', () => {
  it('reports all-ok when every metric within limit', () => {
    const m = { webVitals: { lcp: 1500, tbt: 100 }, bundles: { main: 200_000 }, lighthouse: { performance: 95 } };
    const r = evaluateBudget(budget, m);
    expect(r.failed).toBe(false);
    expect(r.ok).toHaveLength(4);
  });

  it('flags lt violations', () => {
    const m = { webVitals: { lcp: 3000, tbt: 100 }, bundles: { main: 200_000 }, lighthouse: { performance: 95 } };
    const r = evaluateBudget(budget, m);
    expect(r.blocked).toHaveLength(1);
    expect(r.blocked[0]!.entry.label).toBe('LCP');
    expect(r.failed).toBe(true);
  });

  it('flags gt violations', () => {
    const m = { webVitals: { lcp: 1500, tbt: 100 }, bundles: { main: 200_000 }, lighthouse: { performance: 60 } };
    const r = evaluateBudget(budget, m);
    expect(r.blocked.some(v => v.entry.label === 'lighthouse-perf')).toBe(true);
  });

  it('warn severity does not set failed=true', () => {
    const m = { webVitals: { lcp: 1500, tbt: 100 }, bundles: { main: 500_000 }, lighthouse: { performance: 95 } };
    const r = evaluateBudget(budget, m);
    expect(r.warned).toHaveLength(1);
    expect(r.failed).toBe(false);
  });

  it('skips entries whose path resolves to non-number', () => {
    const m = { webVitals: { lcp: 'oops', tbt: 100 }, bundles: { main: 200_000 }, lighthouse: { performance: 95 } };
    const r = evaluateBudget(budget, m);
    // LCP is skipped (non-number), others still evaluated.
    expect(r.ok.length + r.blocked.length + r.warned.length).toBe(3);
  });
});

describe('formatViolation', () => {
  it('uses > arrow for lt violations', () => {
    const v = { entry: budget.entries[0]!, observed: 3000, delta: 500 };
    expect(formatViolation(v)).toContain('>');
  });

  it('uses < arrow for gt violations', () => {
    const v = { entry: budget.entries[3]!, observed: 60, delta: 20 };
    expect(formatViolation(v)).toContain('<');
  });
});

describe('formatBudgetReport', () => {
  it('summarizes ok count', () => {
    const m = { webVitals: { lcp: 1500, tbt: 100 }, bundles: { main: 200_000 }, lighthouse: { performance: 95 } };
    const r = evaluateBudget(budget, m);
    expect(formatBudgetReport(r)).toContain('4/4 ok');
  });
});

describe('assertBudget', () => {
  it('returns report when within budget', () => {
    const m = { webVitals: { lcp: 1500, tbt: 100 }, bundles: { main: 200_000 }, lighthouse: { performance: 95 } };
    expect(() => assertBudget(budget, m)).not.toThrow();
  });

  it('throws on violation', () => {
    const m = { webVitals: { lcp: 3000, tbt: 100 }, bundles: { main: 200_000 }, lighthouse: { performance: 95 } };
    expect(() => assertBudget(budget, m)).toThrow();
  });
});
