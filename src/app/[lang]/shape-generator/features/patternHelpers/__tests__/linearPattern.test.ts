import { describe, it, expect } from 'vitest';
import {
  expandLinearPattern,
  expandLinear2DPattern,
  expandPattern,
  type LinearPatternParams,
  type Linear2DPatternParams,
} from '../index';

/**
 * Pattern helper — linear + linear2D (W5 — Track C5).
 *
 * Both modules are pure; tests cover the happy paths the wizard exercises,
 * the validator-bound edges (count 0, fractional, NaN), and the
 * id-determinism rule the holeArray expansion path depends on.
 */

const ARRAY_ID = 'arr-x';

describe('expandLinearPattern — 1D', () => {
  it('emits N positions along +X with dx=10', () => {
    const p: LinearPatternParams = {
      kind: 'linear', startX: 0, startY: 0, dx: 10, dy: 0, count: 5,
    };
    const out = expandLinearPattern(ARRAY_ID, p);
    expect(out).toHaveLength(5);
    expect(out.map((q) => q.x)).toEqual([0, 10, 20, 30, 40]);
    expect(out.every((q) => q.y === 0)).toBe(true);
    expect(out.every((q) => q.source === 'linear')).toBe(true);
  });

  it('honours stable id format `#lin-<i>`', () => {
    const out = expandLinearPattern(ARRAY_ID, {
      kind: 'linear', startX: 0, startY: 0, dx: 1, dy: 0, count: 3,
    });
    expect(out.map((q) => q.id)).toEqual([
      'arr-x#lin-0', 'arr-x#lin-1', 'arr-x#lin-2',
    ]);
  });

  it('supports diagonal step', () => {
    const out = expandLinearPattern(ARRAY_ID, {
      kind: 'linear', startX: 0, startY: 0, dx: 5, dy: 7, count: 3,
    });
    expect(out.map((q) => [q.x, q.y])).toEqual([[0, 0], [5, 7], [10, 14]]);
  });

  it('handles negative dx (backwards direction)', () => {
    const out = expandLinearPattern(ARRAY_ID, {
      kind: 'linear', startX: 100, startY: 0, dx: -20, dy: 0, count: 4,
    });
    expect(out.map((q) => q.x)).toEqual([100, 80, 60, 40]);
  });

  it('handles count=1 → single position at start', () => {
    const out = expandLinearPattern(ARRAY_ID, {
      kind: 'linear', startX: 3, startY: 4, dx: 5, dy: 0, count: 1,
    });
    expect(out).toEqual([{ id: 'arr-x#lin-0', x: 3, y: 4, source: 'linear' }]);
  });

  it('returns [] for count=0', () => {
    const out = expandLinearPattern(ARRAY_ID, {
      kind: 'linear', startX: 0, startY: 0, dx: 1, dy: 0, count: 0,
    });
    expect(out).toEqual([]);
  });

  it('returns [] for negative count', () => {
    const out = expandLinearPattern(ARRAY_ID, {
      kind: 'linear', startX: 0, startY: 0, dx: 1, dy: 0, count: -3,
    });
    expect(out).toEqual([]);
  });

  it('returns [] for fractional count', () => {
    const out = expandLinearPattern(ARRAY_ID, {
      kind: 'linear', startX: 0, startY: 0, dx: 1, dy: 0, count: 2.5,
    });
    expect(out).toEqual([]);
  });

  it('returns [] for NaN count', () => {
    const out = expandLinearPattern(ARRAY_ID, {
      kind: 'linear', startX: 0, startY: 0, dx: 1, dy: 0, count: NaN,
    });
    expect(out).toEqual([]);
  });

  it('handles zero step with count=1 (degenerate but valid single point)', () => {
    const out = expandLinearPattern(ARRAY_ID, {
      kind: 'linear', startX: 0, startY: 0, dx: 0, dy: 0, count: 1,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ id: 'arr-x#lin-0', x: 0, y: 0, source: 'linear' });
  });
});

describe('expandLinear2DPattern — 2D grid', () => {
  it('emits rows × cols positions in row-major order', () => {
    const p: Linear2DPatternParams = {
      kind: 'linear2D',
      startX: 0, startY: 0,
      dxRow: 0, dyRow: 5,
      dxCol: 10, dyCol: 0,
      rows: 2, cols: 3,
    };
    const out = expandLinear2DPattern(ARRAY_ID, p);
    expect(out).toHaveLength(6);
    expect(out.map((q) => [q.x, q.y])).toEqual([
      [0, 0], [10, 0], [20, 0],
      [0, 5], [10, 5], [20, 5],
    ]);
  });

  it('honours stable id format `#lin2d-rXcY`', () => {
    const out = expandLinear2DPattern(ARRAY_ID, {
      kind: 'linear2D',
      startX: 0, startY: 0,
      dxRow: 0, dyRow: 10,
      dxCol: 10, dyCol: 0,
      rows: 2, cols: 2,
    });
    expect(out.map((q) => q.id)).toEqual([
      'arr-x#lin2d-r0c0', 'arr-x#lin2d-r0c1',
      'arr-x#lin2d-r1c0', 'arr-x#lin2d-r1c1',
    ]);
  });

  it('supports sheared grid (dxRow != 0)', () => {
    const out = expandLinear2DPattern(ARRAY_ID, {
      kind: 'linear2D',
      startX: 0, startY: 0,
      dxRow: 2, dyRow: 5,    // each row shifts +2x, +5y
      dxCol: 10, dyCol: 0,
      rows: 2, cols: 2,
    });
    expect(out.map((q) => [q.x, q.y])).toEqual([
      [0, 0], [10, 0],
      [2, 5], [12, 5],
    ]);
  });

  it('returns [] when rows=0', () => {
    const out = expandLinear2DPattern(ARRAY_ID, {
      kind: 'linear2D',
      startX: 0, startY: 0,
      dxRow: 0, dyRow: 5,
      dxCol: 5, dyCol: 0,
      rows: 0, cols: 3,
    });
    expect(out).toEqual([]);
  });

  it('returns [] when cols=0', () => {
    const out = expandLinear2DPattern(ARRAY_ID, {
      kind: 'linear2D',
      startX: 0, startY: 0,
      dxRow: 0, dyRow: 5,
      dxCol: 5, dyCol: 0,
      rows: 3, cols: 0,
    });
    expect(out).toEqual([]);
  });

  it('returns [] for fractional rows', () => {
    const out = expandLinear2DPattern(ARRAY_ID, {
      kind: 'linear2D',
      startX: 0, startY: 0,
      dxRow: 0, dyRow: 5,
      dxCol: 5, dyCol: 0,
      rows: 2.5, cols: 3,
    });
    expect(out).toEqual([]);
  });

  it('emits a 1×N (single row) correctly', () => {
    const out = expandLinear2DPattern(ARRAY_ID, {
      kind: 'linear2D',
      startX: 5, startY: 5,
      dxRow: 0, dyRow: 0,
      dxCol: 10, dyCol: 0,
      rows: 1, cols: 4,
    });
    expect(out).toHaveLength(4);
    expect(out.map((q) => q.x)).toEqual([5, 15, 25, 35]);
    expect(out.every((q) => q.y === 5)).toBe(true);
  });
});

describe('expandPattern — dispatcher', () => {
  it('routes linear', () => {
    const out = expandPattern(ARRAY_ID, {
      kind: 'linear', startX: 0, startY: 0, dx: 1, dy: 0, count: 2,
    });
    expect(out).toHaveLength(2);
  });

  it('routes linear2D', () => {
    const out = expandPattern(ARRAY_ID, {
      kind: 'linear2D',
      startX: 0, startY: 0,
      dxRow: 0, dyRow: 1,
      dxCol: 1, dyCol: 0,
      rows: 2, cols: 2,
    });
    expect(out).toHaveLength(4);
  });
});
