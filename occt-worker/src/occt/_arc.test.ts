/**
 * Arc → cubic Bezier unit tests. Geometric correctness — endpoints
 * land where SVG says they should, segment counts match the 90° split
 * rule.
 */

import { describe, it, expect } from 'vitest';
import { arcToCubicBeziers, type CubicSegment } from './_arc.js';

function lastEndpoint(segs: CubicSegment[]): [number, number] {
  return segs[segs.length - 1]!.p3;
}

describe('arcToCubicBeziers — endpoints', () => {
  it('quarter circle CCW lands at correct end', () => {
    // (10, 0) → (0, 10), r=10, large=0, sweep=0 (CCW in SVG screen frame
    // which is +y down — counter-intuitive but matches the spec).
    const segs = arcToCubicBeziers([10, 0], [10, 10], 0, 0, 0, [0, 10]);
    const end = lastEndpoint(segs);
    expect(end[0]).toBeCloseTo(0, 6);
    expect(end[1]).toBeCloseTo(10, 6);
    // Quarter arc = single cubic segment (≤ 90°).
    expect(segs).toHaveLength(1);
  });

  it('half circle splits into 2 cubics', () => {
    // (10, 0) → (-10, 0) sweeping 180°.
    const segs = arcToCubicBeziers([10, 0], [10, 10], 0, 0, 1, [-10, 0]);
    const end = lastEndpoint(segs);
    expect(end[0]).toBeCloseTo(-10, 6);
    expect(end[1]).toBeCloseTo(0, 6);
    expect(segs).toHaveLength(2);
  });

  it('large-arc-flag selects the long way', () => {
    // (10,0) → (0,10) with fA=1 → 270° arc → 3 cubic segments.
    const segs = arcToCubicBeziers([10, 0], [10, 10], 0, 1, 1, [0, 10]);
    expect(segs.length).toBeGreaterThan(1);
    const end = lastEndpoint(segs);
    expect(end[0]).toBeCloseTo(0, 6);
    expect(end[1]).toBeCloseTo(10, 6);
  });
});

describe('arcToCubicBeziers — degenerate cases', () => {
  it('rx=0 collapses to a single line-equivalent cubic', () => {
    const segs = arcToCubicBeziers([0, 0], [0, 10], 0, 0, 1, [10, 5]);
    expect(segs).toHaveLength(1);
    const end = lastEndpoint(segs);
    expect(end).toEqual([10, 5]);
  });

  it('ry=0 collapses to a single line-equivalent cubic', () => {
    const segs = arcToCubicBeziers([0, 0], [10, 0], 0, 0, 1, [10, 5]);
    expect(segs).toHaveLength(1);
  });

  it('negative radii treated as absolute', () => {
    const segsNeg = arcToCubicBeziers([10, 0], [-10, -10], 0, 0, 0, [0, 10]);
    const segsPos = arcToCubicBeziers([10, 0], [10, 10], 0, 0, 0, [0, 10]);
    // Same endpoint, same segment count.
    expect(segsNeg.length).toBe(segsPos.length);
    expect(lastEndpoint(segsNeg)).toEqual(lastEndpoint(segsPos));
  });

  it('radii too small to span the chord get scaled up (no NaN)', () => {
    // Chord length = sqrt(200) ≈ 14.14, r=1 way too small. SVG spec
    // says scale radii up. We just verify no NaN escapes.
    const segs = arcToCubicBeziers([0, 0], [1, 1], 0, 0, 1, [10, 10]);
    for (const s of segs) {
      for (const p of [s.p0, s.p1, s.p2, s.p3]) {
        expect(Number.isFinite(p[0])).toBe(true);
        expect(Number.isFinite(p[1])).toBe(true);
      }
    }
  });

  it('throws on non-finite radii', () => {
    expect(() => arcToCubicBeziers([0, 0], [NaN, 5], 0, 0, 1, [10, 0]))
      .toThrow(/finite/);
  });
});
