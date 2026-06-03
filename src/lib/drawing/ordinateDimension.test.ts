/**
 * ordinateDimension — validation, value computation, render hints, merging.
 */
import { describe, it, expect } from 'vitest';
import {
  validateOrdinateChain,
  computeOrdinateValues,
  buildOrdinateRenderHints,
  mergeOrdinateChains,
  OrdinateError,
  STAGGER_THRESHOLD,
  LEADER_BASE_OFFSET,
  STAGGER_STEP,
  type OrdinateDimensionChain,
} from './ordinateDimension';

function mkChain(overrides: Partial<OrdinateDimensionChain> = {}): OrdinateDimensionChain {
  return {
    id: 'c1',
    origin: { x: 0, y: 0 },
    axis: 'x',
    points: [
      { id: 'p1', x: 10, y: 0 },
      { id: 'p2', x: 25, y: 0 },
    ],
    ...overrides,
  };
}

// ─── validateOrdinateChain ──────────────────────────────────────────────

describe('validateOrdinateChain', () => {
  it('accepts a well-formed chain', () => {
    const r = validateOrdinateChain(mkChain());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects duplicate point ids', () => {
    const r = validateOrdinateChain(
      mkChain({
        points: [
          { id: 'p1', x: 10, y: 0 },
          { id: 'p1', x: 20, y: 0 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("duplicate point id 'p1'"))).toBe(true);
  });

  it('rejects empty points array', () => {
    const r = validateOrdinateChain(mkChain({ points: [] }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('at least one point'))).toBe(true);
  });

  it('rejects empty chain id', () => {
    const r = validateOrdinateChain(mkChain({ id: '' }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('chain id is empty'))).toBe(true);
  });

  it('rejects non-finite origin coords', () => {
    const r = validateOrdinateChain(mkChain({ origin: { x: NaN, y: 0 } }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('origin must be finite'))).toBe(true);
  });

  it('rejects non-finite point coords', () => {
    const r = validateOrdinateChain(
      mkChain({ points: [{ id: 'p1', x: Infinity, y: 0 }] }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('non-finite coords'))).toBe(true);
  });

  it('rejects unknown axis', () => {
    const r = validateOrdinateChain(
      mkChain({ axis: 'z' as unknown as 'x' }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('invalid axis'))).toBe(true);
  });

  it('rejects out-of-range precision', () => {
    const r1 = validateOrdinateChain(mkChain({ precision: -1 }));
    const r2 = validateOrdinateChain(mkChain({ precision: 13 }));
    const r3 = validateOrdinateChain(mkChain({ precision: 2.5 }));
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(r3.ok).toBe(false);
  });

  it('rejects unknown unit', () => {
    const r = validateOrdinateChain(
      mkChain({ unit: 'cm' as unknown as 'mm' }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("unit must be 'mm' or 'in'"))).toBe(true);
  });

  it('rejects empty point id', () => {
    const r = validateOrdinateChain(
      mkChain({ points: [{ id: '', x: 1, y: 1 }] }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('empty id'))).toBe(true);
  });
});

// ─── computeOrdinateValues ──────────────────────────────────────────────

describe('computeOrdinateValues', () => {
  it('measures x-axis only when axis = "x"', () => {
    const values = computeOrdinateValues(
      mkChain({
        axis: 'x',
        points: [
          { id: 'p1', x: 12, y: 99 },
          { id: 'p2', x: 25, y: -7 },
        ],
      }),
    );
    expect(values).toHaveLength(2);
    expect(values.every((v) => v.axis === 'x')).toBe(true);
    expect(values[0].value).toBe(12);
    expect(values[1].value).toBe(25);
  });

  it('measures y-axis only when axis = "y"', () => {
    const values = computeOrdinateValues(
      mkChain({
        axis: 'y',
        points: [
          { id: 'p1', x: 99, y: 7 },
          { id: 'p2', x: -1, y: 22 },
        ],
      }),
    );
    expect(values).toHaveLength(2);
    expect(values.every((v) => v.axis === 'y')).toBe(true);
    expect(values[0].value).toBe(7);
    expect(values[1].value).toBe(22);
  });

  it('emits both axes per point when axis = "both"', () => {
    const values = computeOrdinateValues(
      mkChain({
        axis: 'both',
        points: [
          { id: 'p1', x: 3, y: 4 },
          { id: 'p2', x: 7, y: 11 },
        ],
      }),
    );
    expect(values).toHaveLength(4);
    expect(values.filter((v) => v.axis === 'x')).toHaveLength(2);
    expect(values.filter((v) => v.axis === 'y')).toHaveLength(2);
    expect(values.find((v) => v.pointId === 'p1' && v.axis === 'x')?.value).toBe(3);
    expect(values.find((v) => v.pointId === 'p1' && v.axis === 'y')?.value).toBe(4);
  });

  it('subtracts non-zero origin from each point', () => {
    const values = computeOrdinateValues(
      mkChain({
        origin: { x: 100, y: 50 },
        axis: 'both',
        points: [{ id: 'p1', x: 120, y: 60 }],
      }),
    );
    expect(values.find((v) => v.axis === 'x')?.value).toBe(20);
    expect(values.find((v) => v.axis === 'y')?.value).toBe(10);
  });

  it('emits signed (negative) values when point is below/left of origin', () => {
    const values = computeOrdinateValues(
      mkChain({
        axis: 'both',
        points: [{ id: 'p1', x: -7.5, y: -3.25 }],
      }),
    );
    expect(values.find((v) => v.axis === 'x')?.value).toBe(-7.5);
    expect(values.find((v) => v.axis === 'y')?.value).toBe(-3.25);
  });

  it('default precision is 2 decimal places', () => {
    const values = computeOrdinateValues(
      mkChain({ points: [{ id: 'p1', x: 12.5, y: 0 }] }),
    );
    expect(values[0].formatted).toBe('12.50 mm');
  });

  it('honors explicit precision of 3', () => {
    const values = computeOrdinateValues(
      mkChain({ precision: 3, points: [{ id: 'p1', x: 12.5, y: 0 }] }),
    );
    expect(values[0].formatted).toBe('12.500 mm');
  });

  it('honors precision 0 (integer rounding)', () => {
    const values = computeOrdinateValues(
      mkChain({ precision: 0, points: [{ id: 'p1', x: 12.6, y: 0 }] }),
    );
    expect(values[0].formatted).toBe('13 mm');
  });

  it('switches unit to in', () => {
    const values = computeOrdinateValues(
      mkChain({ unit: 'in', points: [{ id: 'p1', x: 1.5, y: 0 }] }),
    );
    expect(values[0].formatted).toBe('1.50 in');
  });

  it('normalizes -0 in formatted string', () => {
    const values = computeOrdinateValues(
      mkChain({ origin: { x: 5, y: 0 }, points: [{ id: 'p1', x: 5, y: 0 }] }),
    );
    expect(values[0].formatted).toBe('0.00 mm');
  });

  it('throws OrdinateError when chain is invalid', () => {
    expect(() =>
      computeOrdinateValues({ ...mkChain(), points: [] }),
    ).toThrow(OrdinateError);
  });
});

// ─── buildOrdinateRenderHints ───────────────────────────────────────────

describe('buildOrdinateRenderHints', () => {
  it('places leader start on origin axis projection (x-axis)', () => {
    const hints = buildOrdinateRenderHints(
      mkChain({
        axis: 'x',
        origin: { x: 0, y: 50 },
        points: [{ id: 'p1', x: 17, y: 200 }],
      }),
    );
    // x-axis ordinate: leader anchors at (point.x, origin.y)
    expect(hints[0].leaderStart).toEqual({ x: 17, y: 50 });
  });

  it('places leader start on origin axis projection (y-axis)', () => {
    const hints = buildOrdinateRenderHints(
      mkChain({
        axis: 'y',
        origin: { x: 100, y: 0 },
        points: [{ id: 'p1', x: 250, y: 30 }],
      }),
    );
    // y-axis ordinate: leader anchors at (origin.x, point.y)
    expect(hints[0].leaderStart).toEqual({ x: 100, y: 30 });
  });

  it('leader end is offset by base + layer*step (x-axis goes upward)', () => {
    const hints = buildOrdinateRenderHints(
      mkChain({
        axis: 'x',
        points: [{ id: 'p1', x: 17, y: 0 }],
      }),
    );
    // layer 0, x-axis: end.y = origin.y - LEADER_BASE_OFFSET
    expect(hints[0].leaderEnd).toEqual({ x: 17, y: -LEADER_BASE_OFFSET });
    expect(hints[0].leaderEnd.y).not.toBe(hints[0].leaderStart.y);
  });

  it('leader end is offset rightward for y-axis labels', () => {
    const hints = buildOrdinateRenderHints(
      mkChain({
        axis: 'y',
        origin: { x: 50, y: 0 },
        points: [{ id: 'p1', x: 0, y: 30 }],
      }),
    );
    expect(hints[0].leaderEnd).toEqual({ x: 50 + LEADER_BASE_OFFSET, y: 30 });
  });

  it('text angle is 0 for x-axis, π/2 for y-axis', () => {
    const hints = buildOrdinateRenderHints(
      mkChain({
        axis: 'both',
        points: [{ id: 'p1', x: 10, y: 20 }],
      }),
    );
    const x = hints.find((h) => h.axis === 'x')!;
    const y = hints.find((h) => h.axis === 'y')!;
    expect(x.textAngle).toBe(0);
    expect(y.textAngle).toBeCloseTo(Math.PI / 2);
  });

  it('staggers labels closer than STAGGER_THRESHOLD onto distinct layers', () => {
    const hints = buildOrdinateRenderHints(
      mkChain({
        axis: 'x',
        points: [
          { id: 'a', x: 10, y: 0 },
          // Within STAGGER_THRESHOLD of 'a' along the measured axis.
          { id: 'b', x: 10 + STAGGER_THRESHOLD / 2, y: 0 },
        ],
      }),
    );
    const layers = hints.map((h) => h.staggerLayer).sort();
    expect(layers).toEqual([0, 1]);
  });

  it('keeps well-separated labels on layer 0', () => {
    const hints = buildOrdinateRenderHints(
      mkChain({
        axis: 'x',
        points: [
          { id: 'a', x: 0, y: 0 },
          { id: 'b', x: 50, y: 0 },
          { id: 'c', x: 100, y: 0 },
        ],
      }),
    );
    expect(hints.every((h) => h.staggerLayer === 0)).toBe(true);
  });

  it('layer N+1 leader end differs from layer N by STAGGER_STEP', () => {
    const hints = buildOrdinateRenderHints(
      mkChain({
        axis: 'x',
        origin: { x: 0, y: 0 },
        points: [
          { id: 'a', x: 10, y: 0 },
          { id: 'b', x: 11, y: 0 },
        ],
      }),
    );
    const a = hints.find((h) => h.pointId === 'a')!;
    const b = hints.find((h) => h.pointId === 'b')!;
    expect(Math.abs(a.leaderEnd.y - b.leaderEnd.y)).toBe(STAGGER_STEP);
  });

  it('emits one render hint per (point, axis) when axis = both', () => {
    const hints = buildOrdinateRenderHints(
      mkChain({
        axis: 'both',
        points: [
          { id: 'p1', x: 5, y: 5 },
          { id: 'p2', x: 9, y: 12 },
        ],
      }),
    );
    expect(hints).toHaveLength(4);
  });

  it('overlapping clusters: three labels within threshold use 3 layers', () => {
    const hints = buildOrdinateRenderHints(
      mkChain({
        axis: 'x',
        points: [
          { id: 'a', x: 10, y: 0 },
          { id: 'b', x: 11, y: 0 },
          { id: 'c', x: 12, y: 0 },
        ],
      }),
    );
    const layers = new Set(hints.map((h) => h.staggerLayer));
    expect(layers.size).toBe(3);
  });

  it('preserves formatted value from computeOrdinateValues', () => {
    const hints = buildOrdinateRenderHints(
      mkChain({
        precision: 3,
        unit: 'in',
        points: [{ id: 'p1', x: 1.2346, y: 0 }],
      }),
    );
    expect(hints[0].formatted).toBe('1.235 in');
  });
});

// ─── mergeOrdinateChains ────────────────────────────────────────────────

describe('mergeOrdinateChains', () => {
  it('merges two chains sharing origin + axis', () => {
    const a = mkChain({
      id: 'a',
      origin: { x: 0, y: 0 },
      axis: 'x',
      points: [{ id: 'p1', x: 10, y: 0 }],
    });
    const b = mkChain({
      id: 'b',
      origin: { x: 0, y: 0 },
      axis: 'x',
      points: [{ id: 'p2', x: 20, y: 0 }],
    });
    const merged = mergeOrdinateChains([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('a');
    expect(merged[0].points.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('keeps chains with different origins separate', () => {
    const a = mkChain({ id: 'a', origin: { x: 0, y: 0 } });
    const b = mkChain({ id: 'b', origin: { x: 5, y: 0 } });
    const merged = mergeOrdinateChains([a, b]);
    expect(merged).toHaveLength(2);
  });

  it('keeps chains with same origin but different axis separate', () => {
    const a = mkChain({ id: 'a', axis: 'x' });
    const b = mkChain({ id: 'b', axis: 'y' });
    const merged = mergeOrdinateChains([a, b]);
    expect(merged).toHaveLength(2);
  });

  it('treats origins within ORIGIN_EPSILON as equal', () => {
    const a = mkChain({ id: 'a', origin: { x: 0, y: 0 } });
    const b = mkChain({
      id: 'b',
      origin: { x: 1e-12, y: -1e-12 },
      points: [{ id: 'p3', x: 50, y: 0 }],
    });
    const merged = mergeOrdinateChains([a, b]);
    expect(merged).toHaveLength(1);
  });

  it('throws when merging chains share a point id', () => {
    const a = mkChain({
      id: 'a',
      points: [{ id: 'shared', x: 10, y: 0 }],
    });
    const b = mkChain({
      id: 'b',
      points: [{ id: 'shared', x: 99, y: 0 }],
    });
    expect(() => mergeOrdinateChains([a, b])).toThrow(OrdinateError);
  });

  it('shallow-copies origin so caller mutations do not bleed in', () => {
    const a = mkChain({ id: 'a', origin: { x: 1, y: 2 } });
    const merged = mergeOrdinateChains([a]);
    a.origin.x = 999;
    expect(merged[0].origin.x).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(mergeOrdinateChains([])).toEqual([]);
  });

  it('preserves first chain precision + unit on merge', () => {
    const a = mkChain({
      id: 'a',
      precision: 4,
      unit: 'in',
      points: [{ id: 'p1', x: 1, y: 0 }],
    });
    const b = mkChain({
      id: 'b',
      precision: 1,
      unit: 'mm',
      points: [{ id: 'p2', x: 2, y: 0 }],
    });
    const merged = mergeOrdinateChains([a, b]);
    expect(merged[0].precision).toBe(4);
    expect(merged[0].unit).toBe('in');
  });
});
