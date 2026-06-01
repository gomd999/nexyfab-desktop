/**
 * dimension — tolerance + dimension + GD&T validation tests.
 */
import { describe, it, expect } from 'vitest';
import {
  validateTolerance,
  formatTolerance,
  validateDimension,
  validateGdt,
  formatGdt,
  ToleranceError,
  DimensionError,
  GdtError,
  type Dimension,
  type GdtCallout,
} from './dimension';

// ─── tolerance ───────────────────────────────────────────────────────────

describe('validateTolerance', () => {
  it('none accepts unconditionally', () => {
    expect(() => validateTolerance({ kind: 'none' })).not.toThrow();
  });

  it('bilateral rejects negative values', () => {
    expect(() => validateTolerance({ kind: 'bilateral', upper: -0.1, lower: 0.1 })).toThrow(ToleranceError);
  });

  it('unilateral requires exactly one of upper/lower to be 0', () => {
    expect(() => validateTolerance({ kind: 'unilateral', upper: 0.1, lower: 0 })).not.toThrow();
    expect(() => validateTolerance({ kind: 'unilateral', upper: 0, lower: 0.1 })).not.toThrow();
    expect(() => validateTolerance({ kind: 'unilateral', upper: 0.1, lower: 0.1 })).toThrow(/exactly one/);
  });

  it('limit rejects min > max', () => {
    expect(() => validateTolerance({ kind: 'limit', min: 10, max: 5 })).toThrow(/min.*max/);
  });

  it('iso_fit rejects malformed designation', () => {
    expect(() => validateTolerance({ kind: 'iso_fit', designation: 'H7' })).not.toThrow();
    expect(() => validateTolerance({ kind: 'iso_fit', designation: 'invalid' })).toThrow(/designation/);
  });
});

describe('formatTolerance', () => {
  it('bilateral equal upper/lower formats as ±', () => {
    expect(formatTolerance({ kind: 'bilateral', upper: 0.1, lower: 0.1 })).toBe(' ± 0.1');
  });
  it('bilateral unequal formats as +x/-y', () => {
    expect(formatTolerance({ kind: 'bilateral', upper: 0.2, lower: 0.1 })).toBe(' +0.2/-0.1');
  });
  it('unilateral +x/-0 and +0/-x', () => {
    expect(formatTolerance({ kind: 'unilateral', upper: 0.5, lower: 0 })).toBe(' +0.5/-0');
    expect(formatTolerance({ kind: 'unilateral', upper: 0, lower: 0.5 })).toBe(' +0/-0.5');
  });
  it('limit and iso_fit format with brackets / fit string', () => {
    expect(formatTolerance({ kind: 'limit', min: 9.9, max: 10.1 })).toBe(' (9.9..10.1)');
    expect(formatTolerance({ kind: 'iso_fit', designation: 'H7' })).toBe(' H7');
  });
});

// ─── dimension ───────────────────────────────────────────────────────────

describe('validateDimension', () => {
  function dim(overrides: Partial<Dimension> = {}): Dimension {
    return {
      id: 'd1', viewportId: 'vp1', kind: 'linear', refs: ['e1', 'e2'],
      ...overrides,
    } as Dimension;
  }

  it('linear needs 2 refs', () => {
    expect(() => validateDimension(dim())).not.toThrow();
    expect(() => validateDimension(dim({ refs: ['e1'] }))).toThrow(/2 refs/);
  });
  it('radial needs 1 ref', () => {
    expect(() => validateDimension(dim({ kind: 'radial', refs: ['e1'] }))).not.toThrow();
    expect(() => validateDimension(dim({ kind: 'radial', refs: ['e1', 'e2'] }))).toThrow(/1 refs/);
  });
  it('angular needs 2 refs', () => {
    expect(() => validateDimension(dim({ kind: 'angular', refs: ['l1', 'l2'] }))).not.toThrow();
    expect(() => validateDimension(dim({ kind: 'angular', refs: ['l1'] }))).toThrow(/2 refs/);
  });
  it('propagates tolerance validation errors', () => {
    expect(() =>
      validateDimension(dim({ tolerance: { kind: 'bilateral', upper: -1, lower: 0.1 } })),
    ).toThrow(ToleranceError);
  });
  it('rejects empty id / viewportId', () => {
    expect(() => validateDimension(dim({ id: '' }))).toThrow(DimensionError);
    expect(() => validateDimension(dim({ viewportId: '' }))).toThrow(DimensionError);
  });
});

// ─── GD&T ────────────────────────────────────────────────────────────────

describe('validateGdt', () => {
  function g(overrides: Partial<GdtCallout> = {}): GdtCallout {
    return {
      id: 'g1', viewportId: 'vp1', kind: 'flatness', targetRef: 'f1',
      toleranceValue: 0.05, ...overrides,
    };
  }

  it('accepts flatness with no datums', () => {
    expect(() => validateGdt(g({ kind: 'flatness' }))).not.toThrow();
  });

  it('position requires at least 1 datum', () => {
    expect(() => validateGdt(g({ kind: 'position', datums: [] }))).toThrow(/datums/);
    expect(() => validateGdt(g({ kind: 'position', datums: ['A'] }))).not.toThrow();
  });

  it('runout requires at least 1 datum', () => {
    expect(() => validateGdt(g({ kind: 'runout' }))).toThrow(/datums/);
    expect(() => validateGdt(g({ kind: 'runout', datums: ['A'] }))).not.toThrow();
  });

  it('rejects non-positive tolerance', () => {
    expect(() => validateGdt(g({ toleranceValue: 0 }))).toThrow(/positive/);
  });
});

describe('formatGdt', () => {
  it('flatness: [FLT|0.05]', () => {
    expect(formatGdt({ id: 'g1', viewportId: 'v', kind: 'flatness', targetRef: 'f', toleranceValue: 0.05 }))
      .toBe('[FLT|0.05]');
  });
  it('position with datums + M modifier: [POS|0.1(M)|A|B]', () => {
    expect(
      formatGdt({
        id: 'g1', viewportId: 'v', kind: 'position', targetRef: 'f',
        toleranceValue: 0.1, materialCondition: 'M', datums: ['A', 'B'],
      }),
    ).toBe('[POS|0.1(M)|A|B]');
  });
});
