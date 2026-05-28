import { describe, it, expect } from 'vitest';
import { expandCircularPattern, expandPattern } from '../index';

/**
 * Pattern helper — circular (W5 — Track C5).
 *
 * Covers full-circle (legacy) + partial-arc + direction edges. The 6-decimal
 * tolerance on sin/cos drift mirrors the existing holeArray.test.ts.
 */

const ARRAY_ID = 'arr-x';

describe('expandCircularPattern — full circle (legacy)', () => {
  it('emits 6 evenly spaced positions on a circle r=10', () => {
    const out = expandCircularPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 0, centerY: 0, radius: 10, count: 6, startAngle: 0,
    });
    expect(out).toHaveLength(6);
    expect(out[0].x).toBeCloseTo(10, 6);
    expect(out[0].y).toBeCloseTo(0, 6);
    // Step = 60°: position 1 at (5, 10*sin60°) = (5, ~8.66)
    expect(out[1].x).toBeCloseTo(5, 6);
    expect(out[1].y).toBeCloseTo(Math.sin(Math.PI / 3) * 10, 6);
  });

  it('respects non-zero center + startAngle', () => {
    const out = expandCircularPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 100, centerY: 50, radius: 10, count: 4, startAngle: Math.PI / 2,
    });
    // First at (100 + 0, 50 + 10) = (100, 60)
    expect(out[0].x).toBeCloseTo(100, 6);
    expect(out[0].y).toBeCloseTo(60, 6);
  });

  it('honours stable id format `#circ-<i>`', () => {
    const out = expandCircularPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 0, centerY: 0, radius: 5, count: 3, startAngle: 0,
    });
    expect(out.map((q) => q.id)).toEqual([
      'arr-x#circ-0', 'arr-x#circ-1', 'arr-x#circ-2',
    ]);
  });

  it('returns [] for count=0', () => {
    const out = expandCircularPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 0, centerY: 0, radius: 5, count: 0, startAngle: 0,
    });
    expect(out).toEqual([]);
  });

  it('returns [] for negative count', () => {
    const out = expandCircularPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 0, centerY: 0, radius: 5, count: -2, startAngle: 0,
    });
    expect(out).toEqual([]);
  });

  it('returns [] for fractional count', () => {
    const out = expandCircularPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 0, centerY: 0, radius: 5, count: 2.7, startAngle: 0,
    });
    expect(out).toEqual([]);
  });

  it('returns [] for NaN radius', () => {
    const out = expandCircularPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 0, centerY: 0, radius: NaN, count: 4, startAngle: 0,
    });
    expect(out).toEqual([]);
  });
});

describe('expandCircularPattern — partial arc', () => {
  it('270° sweep with count=4 lands first + last on arc endpoints', () => {
    const out = expandCircularPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 0, centerY: 0, radius: 10, count: 4,
      startAngle: 0, partialAngle: 270,
    });
    expect(out).toHaveLength(4);
    // First at angle 0 → (10, 0)
    expect(out[0].x).toBeCloseTo(10, 6);
    expect(out[0].y).toBeCloseTo(0, 6);
    // Last at angle 270° (CCW = 3π/2 rad) → (0, -10)
    expect(out[3].x).toBeCloseTo(0, 6);
    expect(out[3].y).toBeCloseTo(-10, 6);
  });

  it('180° sweep with count=3 has middle position at the arc midpoint', () => {
    const out = expandCircularPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 0, centerY: 0, radius: 10, count: 3,
      startAngle: 0, partialAngle: 180,
    });
    expect(out[0].x).toBeCloseTo(10, 6);
    expect(out[1].x).toBeCloseTo(0, 6);
    expect(out[1].y).toBeCloseTo(10, 6);
    expect(out[2].x).toBeCloseTo(-10, 6);
  });

  it('count=1 + partialAngle → single position at startAngle', () => {
    const out = expandCircularPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 0, centerY: 0, radius: 5, count: 1,
      startAngle: Math.PI / 4, partialAngle: 90,
    });
    expect(out).toHaveLength(1);
    expect(out[0].x).toBeCloseTo(Math.cos(Math.PI / 4) * 5, 6);
  });

  it('partialAngle=360 falls back to full-sweep gap spacing', () => {
    const out = expandCircularPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 0, centerY: 0, radius: 10, count: 4,
      startAngle: 0, partialAngle: 360,
    });
    // Full-sweep step = 2π/4 = 90° → fourth position at 270° (not 360°).
    expect(out).toHaveLength(4);
    expect(out[3].x).toBeCloseTo(0, 6);
    expect(out[3].y).toBeCloseTo(-10, 6);
  });

  it('partialAngle=0 falls back to full-sweep gap spacing', () => {
    const out = expandCircularPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 0, centerY: 0, radius: 10, count: 4,
      startAngle: 0, partialAngle: 0,
    });
    expect(out[1].x).toBeCloseTo(0, 6);
    expect(out[1].y).toBeCloseTo(10, 6);
  });
});

describe('expandCircularPattern — direction', () => {
  it('CCW (default) increments angle counter-clockwise', () => {
    const ccw = expandCircularPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 0, centerY: 0, radius: 10, count: 4, startAngle: 0,
    });
    // Position 1 at 90° → (0, 10)
    expect(ccw[1].x).toBeCloseTo(0, 6);
    expect(ccw[1].y).toBeCloseTo(10, 6);
  });

  it('CW flips the angular step sign', () => {
    const cw = expandCircularPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 0, centerY: 0, radius: 10, count: 4, startAngle: 0,
      direction: 'cw',
    });
    // Position 1 at -90° → (0, -10)
    expect(cw[1].x).toBeCloseTo(0, 6);
    expect(cw[1].y).toBeCloseTo(-10, 6);
  });

  it('CW partial-arc sweep ends at -partialAngle', () => {
    const cw = expandCircularPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 0, centerY: 0, radius: 10, count: 4, startAngle: 0,
      partialAngle: 270, direction: 'cw',
    });
    // Last position at -270° (CW) = +90° net → (0, 10)
    expect(cw[3].x).toBeCloseTo(0, 6);
    expect(cw[3].y).toBeCloseTo(10, 6);
  });

  it('partialAngle treated as magnitude (negative input → positive sweep)', () => {
    const a = expandCircularPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 0, centerY: 0, radius: 10, count: 4, startAngle: 0,
      partialAngle: -270,
    });
    const b = expandCircularPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 0, centerY: 0, radius: 10, count: 4, startAngle: 0,
      partialAngle: 270,
    });
    // -270 is treated as |partialAngle| so the result matches +270.
    expect(a.map((p) => [p.x.toFixed(6), p.y.toFixed(6)])).toEqual(
      b.map((p) => [p.x.toFixed(6), p.y.toFixed(6)]),
    );
  });
});

describe('expandPattern — circular dispatch', () => {
  it('routes circular to expandCircularPattern', () => {
    const out = expandPattern(ARRAY_ID, {
      kind: 'circular',
      centerX: 0, centerY: 0, radius: 10, count: 6, startAngle: 0,
    });
    expect(out).toHaveLength(6);
  });
});
