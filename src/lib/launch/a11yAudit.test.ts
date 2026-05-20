import { describe, it, expect } from 'vitest';
import {
  aggregateAxeResults,
  formatA11yReport,
  assertA11y,
  type AxeResultSet,
  type AxeViolation,
} from './a11yAudit';

function violation(id: string, impact: AxeViolation['impact'], nodeCount = 1): AxeViolation {
  return {
    id,
    impact,
    description: id,
    help: id,
    nodes: Array.from({ length: nodeCount }, (_, i) => ({ target: [`#${id}-${i}`] })),
  };
}

const clean: AxeResultSet = { url: '/home', violations: [] };

describe('aggregateAxeResults', () => {
  it('returns score 100 when no violations', () => {
    const r = aggregateAxeResults([clean]);
    expect(r.score).toBe(100);
    expect(r.failed).toBe(false);
  });

  it('failed=true when critical violation present', () => {
    const set: AxeResultSet = { url: '/x', violations: [violation('color-contrast', 'critical')] };
    const r = aggregateAxeResults([set]);
    expect(r.failed).toBe(true);
  });

  it('failed=true when serious violation present', () => {
    const set: AxeResultSet = { url: '/x', violations: [violation('image-alt', 'serious')] };
    expect(aggregateAxeResults([set]).failed).toBe(true);
  });

  it('failed=false for minor + moderate only', () => {
    const set: AxeResultSet = { url: '/x', violations: [violation('a', 'minor'), violation('b', 'moderate')] };
    expect(aggregateAxeResults([set]).failed).toBe(false);
  });

  it('weights critical heaviest', () => {
    const minor: AxeResultSet = { url: '/x', violations: [violation('a', 'minor', 5)] };
    const crit: AxeResultSet = { url: '/y', violations: [violation('b', 'critical', 1)] };
    expect(aggregateAxeResults([crit]).score).toBeLessThan(aggregateAxeResults([minor]).score);
  });

  it('rolls up by-impact counts', () => {
    const set: AxeResultSet = {
      url: '/x',
      violations: [violation('a', 'minor', 3), violation('b', 'serious', 2)],
    };
    const r = aggregateAxeResults([set]);
    expect(r.byImpact.minor).toBe(3);
    expect(r.byImpact.serious).toBe(2);
  });

  it('top rules sorted by node count desc', () => {
    const set: AxeResultSet = {
      url: '/x',
      violations: [violation('rare', 'minor', 1), violation('common', 'minor', 10)],
    };
    const r = aggregateAxeResults([set]);
    expect(r.topRules[0]!.id).toBe('common');
  });

  it('score floors at 0', () => {
    const set: AxeResultSet = {
      url: '/x',
      violations: [violation('a', 'critical', 100)],
    };
    expect(aggregateAxeResults([set]).score).toBe(0);
  });
});

describe('formatA11yReport', () => {
  it('includes score line and by-impact counts', () => {
    const set: AxeResultSet = { url: '/x', violations: [violation('a', 'moderate')] };
    const txt = formatA11yReport(aggregateAxeResults([set]));
    expect(txt).toContain('A11y score');
    expect(txt).toContain('moderate=1');
  });
});

describe('assertA11y', () => {
  it('returns report on clean run', () => {
    expect(() => assertA11y([clean])).not.toThrow();
  });

  it('throws on serious violation', () => {
    const set: AxeResultSet = { url: '/x', violations: [violation('a', 'serious')] };
    expect(() => assertA11y([set])).toThrow();
  });

  it('throws on low score', () => {
    const set: AxeResultSet = { url: '/x', violations: [violation('a', 'moderate', 50)] };
    expect(() => assertA11y([set], 90)).toThrow();
  });
});
