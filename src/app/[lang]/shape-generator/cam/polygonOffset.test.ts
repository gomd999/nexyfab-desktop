/**
 * polygonOffset — inward polygon inset, verified against closed-form geometry.
 * This is the offset solver that lets a NON-rectangular pocket generate a
 * contour-parallel toolpath.
 */
import { describe, it, expect } from 'vitest';
import { offsetPolygonInward, insetContours, signedArea, ensureCcw } from './polygonOffset';

const P = (x: number, y: number) => ({ x, y });
const square = (s: number) => [P(0, 0), P(s, 0), P(s, s), P(0, s)];

describe('signedArea / ensureCcw', () => {
  it('signed area is positive for CCW, negative for CW', () => {
    expect(signedArea(square(10))).toBeCloseTo(100, 6);
    expect(signedArea([...square(10)].reverse())).toBeCloseTo(-100, 6);
  });
  it('ensureCcw flips a clockwise loop', () => {
    expect(signedArea(ensureCcw([...square(10)].reverse()))).toBeGreaterThan(0);
  });
});

describe('offsetPolygonInward', () => {
  it('insets a square by exactly the offset on every side', () => {
    const r = offsetPolygonInward(square(10), 2)!;
    expect(r).not.toBeNull();
    // each vertex moves diagonally inward by the offset.
    const xs = r.map(p => p.x).sort((a, b) => a - b);
    const ys = r.map(p => p.y).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(2, 5); expect(xs[3]).toBeCloseTo(8, 5);
    expect(ys[0]).toBeCloseTo(2, 5); expect(ys[3]).toBeCloseTo(8, 5);
    expect(signedArea(r)).toBeCloseTo(36, 5); // 6×6
  });

  it('normalises a clockwise input to a CCW inset', () => {
    const cw = [...square(10)].reverse();
    const r = offsetPolygonInward(cw, 2)!;
    expect(signedArea(r)).toBeCloseTo(36, 5); // CCW, 6×6
  });

  it('returns null when the offset over-runs the polygon (it would self-collapse)', () => {
    expect(offsetPolygonInward(square(10), 5)).toBeNull();   // 5 = half-width → no interior
    expect(signedArea(offsetPolygonInward(square(10), 4)!)).toBeCloseTo(4, 5); // 2×2 survives
  });

  it('insets a triangle to the geometrically-correct similar triangle', () => {
    // (0,0)(12,0)(6,10): area 60, inradius = area/semiperimeter ≈ 3.40.
    // An inset by d gives a similar triangle scaled by (r−d)/r → area × ((r−d)/r)².
    const tri = [P(0, 0), P(12, 0), P(6, 10)];
    const r = offsetPolygonInward(tri, 1)!;
    expect(r).toHaveLength(3);
    const inradius = 60 / ((12 + Math.hypot(6, 10) * 2) / 2);
    const expectedArea = 60 * ((inradius - 1) / inradius) ** 2;
    expect(signedArea(r)).toBeCloseTo(expectedArea, 1);
  });
});

describe('insetContours', () => {
  it('produces shrinking concentric rings until the pocket closes up', () => {
    const contours = insetContours(square(40), 2, 3); // r2 tool, 3mm stepover
    expect(contours.length).toBeGreaterThan(3);
    expect(signedArea(contours[0]!)).toBeCloseTo(36 * 36, 0); // first ring 36×36
    // strictly shrinking
    for (let i = 1; i < contours.length; i++) {
      expect(signedArea(contours[i]!)).toBeLessThan(signedArea(contours[i - 1]!));
    }
    // every contour stays inside the boundary.
    for (const c of contours) for (const p of c) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(40 + 1e-6);
    }
  });

  it('degenerate input yields no contours', () => {
    expect(insetContours([P(0, 0), P(1, 0)], 2, 3)).toEqual([]); // < 3 verts
    expect(insetContours(square(40), 0, 3)).toEqual([]);          // no first offset
  });
});
