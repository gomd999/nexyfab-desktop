import { describe, it, expect } from 'vitest';
import {
  buildLinearDimension,
  validateLinearDimensionInput,
  LinearDimensionError,
  DEFAULT_EXTENSION_GAP,
  DEFAULT_EXTENSION_OVERRUN,
  type Pt,
} from './dimensionAnchor';

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('buildLinearDimension — x mode', () => {
  it('measures horizontal span and offsets the dim line in +Y', () => {
    const p1: Pt = { x: 0, y: 0 };
    const p2: Pt = { x: 10, y: 4 };
    const g = buildLinearDimension(p1, p2, { offset: 5, axis: 'x' });

    expect(g.value).toBe(10);
    expect(g.formatted).toBe('10.00 mm');
    expect(g.textAngle).toBe(0);

    // Dimension line is horizontal at y = point.y + offset for each end.
    expect(g.dimensionLine[0]).toEqual({ x: 0, y: 5 });
    expect(g.dimensionLine[1]).toEqual({ x: 10, y: 9 });

    // Text anchor at the dimension-line midpoint.
    expect(g.textAnchor).toEqual({ x: 5, y: 7 });
  });
});

describe('buildLinearDimension — y mode', () => {
  it('measures vertical span and offsets the dim line in X', () => {
    const p1: Pt = { x: 2, y: 0 };
    const p2: Pt = { x: 6, y: 8 };
    const g = buildLinearDimension(p1, p2, { offset: 3, axis: 'y' });

    expect(g.value).toBe(8);
    expect(g.formatted).toBe('8.00 mm');
    expect(g.textAngle).toBeCloseTo(Math.PI / 2, 12);

    // Dim line offset along +X, parallel to the vertical span.
    expect(g.dimensionLine[0]).toEqual({ x: 5, y: 0 });
    expect(g.dimensionLine[1]).toEqual({ x: 9, y: 8 });
  });
});

describe('buildLinearDimension — aligned mode', () => {
  it('measures true 3-4-5 distance and sets the line angle', () => {
    const p1: Pt = { x: 0, y: 0 };
    const p2: Pt = { x: 3, y: 4 };
    const g = buildLinearDimension(p1, p2, { offset: 0, axis: 'aligned' });

    expect(g.value).toBeCloseTo(5, 12);
    expect(g.formatted).toBe('5.00 mm');
    expect(g.textAngle).toBeCloseTo(Math.atan2(4, 3), 12);

    // With zero offset the dim line coincides with the span itself.
    expect(close(g.dimensionLine[0].x, 0)).toBe(true);
    expect(close(g.dimensionLine[1].x, 3)).toBe(true);
    expect(close(g.dimensionLine[1].y, 4)).toBe(true);
  });

  it('offsets perpendicular to the span direction', () => {
    const p1: Pt = { x: 0, y: 0 };
    const p2: Pt = { x: 10, y: 0 };
    // Horizontal span; left-hand normal of +X is +Y, so +offset pushes up.
    const g = buildLinearDimension(p1, p2, { offset: 5, axis: 'aligned' });
    expect(close(g.dimensionLine[0].x, 0)).toBe(true);
    expect(close(g.dimensionLine[0].y, 5)).toBe(true);
    expect(close(g.dimensionLine[1].y, 5)).toBe(true);
  });

  it('defaults axis to aligned when omitted', () => {
    const g = buildLinearDimension({ x: 0, y: 0 }, { x: 6, y: 8 }, { offset: 1 });
    expect(g.value).toBeCloseTo(10, 12);
  });
});

describe('buildLinearDimension — extension lines', () => {
  it('applies gap and overrun to the witness lines', () => {
    const g = buildLinearDimension(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { offset: 8, axis: 'x', extensionGap: 1.5, extensionOverrun: 2.5 },
    );
    // ext starts gap away from the point along +Y, ends at offset+overrun.
    expect(g.extension1[0]).toEqual({ x: 0, y: 1.5 });
    expect(g.extension1[1]).toEqual({ x: 0, y: 10.5 });
    expect(g.extension2[0]).toEqual({ x: 10, y: 1.5 });
    expect(g.extension2[1]).toEqual({ x: 10, y: 10.5 });
  });

  it('uses the documented defaults when gap/overrun are omitted', () => {
    const g = buildLinearDimension(
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { offset: 6, axis: 'x' },
    );
    expect(g.extension1[0].y).toBe(DEFAULT_EXTENSION_GAP);
    expect(g.extension1[1].y).toBe(6 + DEFAULT_EXTENSION_OVERRUN);
  });

  it('flips witness direction for a negative offset', () => {
    const g = buildLinearDimension(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { offset: -4, axis: 'x', extensionGap: 1, extensionOverrun: 2 },
    );
    // Negative offset puts the dim line below; witness goes down.
    expect(g.dimensionLine[0].y).toBe(-4);
    expect(g.extension1[0].y).toBe(-1);
    expect(g.extension1[1].y).toBe(-6);
  });
});

describe('buildLinearDimension — formatting', () => {
  it('honours precision and the inch unit', () => {
    const g = buildLinearDimension(
      { x: 0, y: 0 },
      { x: 2.54, y: 0 },
      { offset: 1, axis: 'x', precision: 3, unit: 'in' },
    );
    expect(g.formatted).toBe('2.540 in');
  });

  it('normalizes negative zero in the formatted string', () => {
    // A vertical-only span measured on the x-axis yields a zero magnitude;
    // ensure it never renders as "-0.00".
    const g = buildLinearDimension(
      { x: 5, y: 0 },
      { x: 5, y: 10 },
      { offset: 2, axis: 'x' },
    );
    expect(g.value).toBe(0);
    expect(g.formatted).toBe('0.00 mm');
    expect(g.formatted.startsWith('-')).toBe(false);
  });
});

describe('validateLinearDimensionInput', () => {
  it('accepts two distinct finite points', () => {
    const r = validateLinearDimensionInput({ x: 0, y: 0 }, { x: 1, y: 1 });
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('rejects coincident points', () => {
    const r = validateLinearDimensionInput({ x: 3, y: 3 }, { x: 3, y: 3 });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('coincident'))).toBe(true);
  });

  it('rejects non-finite coordinates', () => {
    const r = validateLinearDimensionInput({ x: NaN, y: 0 }, { x: Infinity, y: 1 });
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
  });

  it('makes buildLinearDimension throw on invalid input', () => {
    expect(() =>
      buildLinearDimension({ x: 0, y: 0 }, { x: 0, y: 0 }, { offset: 1 }),
    ).toThrow(LinearDimensionError);
    expect(() =>
      buildLinearDimension({ x: 0, y: 0 }, { x: 1, y: 1 }, { offset: NaN }),
    ).toThrow(LinearDimensionError);
  });
});
