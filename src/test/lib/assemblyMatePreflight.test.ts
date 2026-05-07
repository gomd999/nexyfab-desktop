import { describe, it, expect } from 'vitest';
import { mateGraphSummary, preflightAssemblyMates } from '@/lib/assemblyMatePreflight';

describe('preflightAssemblyMates', () => {
  it('accepts valid mates', () => {
    const r = preflightAssemblyMates([
      { id: 'm1', partA: 'a', partB: 'b' },
    ]);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('flags same part on both sides', () => {
    const r2 = preflightAssemblyMates([{ id: 'm1', partA: 'a', partB: 'a' }]);
    expect(r2.ok).toBe(false);
    expect(r2.issues.some(x => /same (part|instance)/i.test(x))).toBe(true);
  });

  it('flags duplicate ids', () => {
    const r = preflightAssemblyMates([
      { id: 'm1', partA: 'a', partB: 'b' },
      { id: 'm1', partA: 'a', partB: 'c' },
    ]);
    expect(r.ok).toBe(false);
  });
});

describe('mateGraphSummary', () => {
  it('warns when many parts and few mates', () => {
    const s = mateGraphSummary([
      { id: 'm1', partA: 'a', partB: 'b' },
      { id: 'm2', partA: 'c', partB: 'd' },
    ]);
    expect(s.uniqueParts).toBe(4);
    expect(s.warnings.some(w => /under-constrained/i.test(w))).toBe(true);
  });
});
