import { describe, it, expect } from 'vitest';
import {
  markAsReference,
  unmarkReference,
  validateReferences,
  formatDimension,
  buildDerivationGraph,
  summarize,
  type Dimension,
} from './referenceDimension';

function dim(id: string, value: number, isRef: boolean = false): Dimension {
  return { id, nominalMm: value, isReference: isRef };
}

describe('markAsReference', () => {
  it('sets isReference flag', () => {
    const d = markAsReference(dim('a', 10));
    expect(d.isReference).toBe(true);
  });

  it('clears tolerance', () => {
    const original: Dimension = { id: 'a', nominalMm: 10, tolerance: { plus: 0.1, minus: 0.1 } };
    const d = markAsReference(original);
    expect(d.tolerance).toBeUndefined();
  });
});

describe('unmarkReference', () => {
  it('clears isReference flag', () => {
    const d = unmarkReference(markAsReference(dim('a', 10)));
    expect(d.isReference).toBe(false);
  });
});

describe('validateReferences', () => {
  it('non-reference dim passes', () => {
    const r = validateReferences([dim('a', 10)]);
    expect(r.valid).toBe(true);
  });

  it('reference with tolerance flagged', () => {
    const d: Dimension = { id: 'a', nominalMm: 10, isReference: true, tolerance: { plus: 0.1, minus: 0.1 } };
    const r = validateReferences([d]);
    expect(r.valid).toBe(false);
  });

  it('derived reference matches sum', () => {
    const dims: Dimension[] = [
      dim('p1', 10),
      dim('p2', 5),
      { id: 'total', nominalMm: 15, isReference: true, derivedFrom: { p1: 1, p2: 1 } },
    ];
    const r = validateReferences(dims);
    expect(r.valid).toBe(true);
  });

  it('mismatched derivation flagged', () => {
    const dims: Dimension[] = [
      dim('p1', 10),
      dim('p2', 5),
      { id: 'total', nominalMm: 100, isReference: true, derivedFrom: { p1: 1, p2: 1 } },
    ];
    const r = validateReferences(dims);
    expect(r.valid).toBe(false);
    expect(r.issues[0]!.reason).toContain('derived');
  });

  it('missing referenced dimension flagged', () => {
    const dims: Dimension[] = [
      { id: 'a', nominalMm: 15, isReference: true, derivedFrom: { ghost: 1 } },
    ];
    const r = validateReferences(dims);
    expect(r.valid).toBe(false);
  });
});

describe('formatDimension', () => {
  it('reference adds parentheses', () => {
    expect(formatDimension(markAsReference(dim('a', 10)), { showParentheses: true })).toContain('(');
  });

  it('controlling shows tolerance', () => {
    const d: Dimension = { id: 'a', nominalMm: 10, tolerance: { plus: 0.1, minus: 0.1 } };
    expect(formatDimension(d)).toContain('±');
  });

  it('unit suffix appended', () => {
    expect(formatDimension(dim('a', 10), { unitSuffix: 'mm' })).toContain('mm');
  });

  it('decimals respected', () => {
    expect(formatDimension(dim('a', 10.456), { decimals: 1 })).toContain('10.5');
  });

  it('no parens when option off', () => {
    expect(formatDimension(markAsReference(dim('a', 10)), { showParentheses: false })).not.toContain('(');
  });
});

describe('buildDerivationGraph', () => {
  it('empty input → empty graph', () => {
    const g = buildDerivationGraph([]);
    expect(g.dependencies.size).toBe(0);
  });

  it('captures derived-from edges', () => {
    const dims: Dimension[] = [
      dim('a', 10),
      dim('b', 5),
      { id: 'sum', nominalMm: 15, isReference: true, derivedFrom: { a: 1, b: 1 } },
    ];
    const g = buildDerivationGraph(dims);
    expect(g.dependencies.get('sum')?.has('a')).toBe(true);
    expect(g.dependents.get('a')?.has('sum')).toBe(true);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const s = summarize([], { valid: true, issues: [] });
    expect(s.totalDimensions).toBe(0);
  });

  it('counts references vs controlling', () => {
    const dims = [dim('a', 10), dim('b', 5, true), dim('c', 8, true)];
    const s = summarize(dims, { valid: true, issues: [] });
    expect(s.referenceCount).toBe(2);
    expect(s.controllingCount).toBe(1);
  });

  it('hasInvalidReferences when issues found', () => {
    const dims: Dimension[] = [
      { id: 'r', nominalMm: 100, isReference: true, derivedFrom: { ghost: 1 } },
    ];
    const s = summarize(dims, validateReferences(dims));
    expect(s.hasInvalidReferences).toBe(true);
  });
});
