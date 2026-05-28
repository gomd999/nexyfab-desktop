import { describe, it, expect } from 'vitest';
import { expandRectPattern, expandPattern } from '../index';

/**
 * Pattern helper — rect (W5 — Track C5). Mostly a regression of the C2
 * inline rect behaviour now that it lives in a dedicated module.
 */

const ARRAY_ID = 'arr-x';

describe('expandRectPattern', () => {
  it('emits 2×3 grid in row-major order', () => {
    const out = expandRectPattern(ARRAY_ID, {
      kind: 'rect',
      startX: 0, startY: 0, stepX: 10, stepY: 20, rows: 2, cols: 3,
    });
    expect(out).toHaveLength(6);
    expect(out.map((q) => [q.x, q.y])).toEqual([
      [0, 0], [10, 0], [20, 0],
      [0, 20], [10, 20], [20, 20],
    ]);
  });

  it('honours stable id format `#rect-rXcY`', () => {
    const out = expandRectPattern(ARRAY_ID, {
      kind: 'rect',
      startX: 0, startY: 0, stepX: 10, stepY: 10, rows: 2, cols: 2,
    });
    expect(out.map((q) => q.id)).toEqual([
      'arr-x#rect-r0c0', 'arr-x#rect-r0c1',
      'arr-x#rect-r1c0', 'arr-x#rect-r1c1',
    ]);
  });

  it('emits N×1 column correctly', () => {
    const out = expandRectPattern(ARRAY_ID, {
      kind: 'rect',
      startX: 5, startY: 5, stepX: 0, stepY: 10, rows: 3, cols: 1,
    });
    expect(out).toHaveLength(3);
    expect(out.map((q) => [q.x, q.y])).toEqual([[5, 5], [5, 15], [5, 25]]);
  });

  it('emits 1×N row correctly', () => {
    const out = expandRectPattern(ARRAY_ID, {
      kind: 'rect',
      startX: 0, startY: 0, stepX: 10, stepY: 0, rows: 1, cols: 4,
    });
    expect(out).toHaveLength(4);
    expect(out.map((q) => q.x)).toEqual([0, 10, 20, 30]);
  });

  it('returns [] for rows=0', () => {
    const out = expandRectPattern(ARRAY_ID, {
      kind: 'rect',
      startX: 0, startY: 0, stepX: 10, stepY: 10, rows: 0, cols: 3,
    });
    expect(out).toEqual([]);
  });

  it('returns [] for cols=0', () => {
    const out = expandRectPattern(ARRAY_ID, {
      kind: 'rect',
      startX: 0, startY: 0, stepX: 10, stepY: 10, rows: 3, cols: 0,
    });
    expect(out).toEqual([]);
  });

  it('returns [] for negative rows', () => {
    const out = expandRectPattern(ARRAY_ID, {
      kind: 'rect',
      startX: 0, startY: 0, stepX: 10, stepY: 10, rows: -1, cols: 3,
    });
    expect(out).toEqual([]);
  });

  it('returns [] for fractional cols', () => {
    const out = expandRectPattern(ARRAY_ID, {
      kind: 'rect',
      startX: 0, startY: 0, stepX: 10, stepY: 10, rows: 2, cols: 2.5,
    });
    expect(out).toEqual([]);
  });

  it('stamps source=rect on every emitted position', () => {
    const out = expandRectPattern(ARRAY_ID, {
      kind: 'rect',
      startX: 0, startY: 0, stepX: 1, stepY: 1, rows: 2, cols: 2,
    });
    expect(out.every((p) => p.source === 'rect')).toBe(true);
  });

  it('routes through expandPattern dispatcher', () => {
    const out = expandPattern(ARRAY_ID, {
      kind: 'rect',
      startX: 0, startY: 0, stepX: 5, stepY: 5, rows: 2, cols: 2,
    });
    expect(out).toHaveLength(4);
  });
});
