/**
 * polygonOffset — inward polygon inset, verified against closed-form geometry.
 * This is the offset solver that lets a NON-rectangular pocket generate a
 * contour-parallel toolpath.
 */
import { describe, it, expect } from 'vitest';
import {
  offsetPolygonInward, offsetPolygonInwardMulti, insetContours, insetContoursMulti,
  signedArea, ensureCcw, loopSelfIntersects, type Pt2,
} from './polygonOffset';

const P = (x: number, y: number) => ({ x, y });
const square = (s: number) => [P(0, 0), P(s, 0), P(s, s), P(0, s)];

/** Even-odd point-in-polygon (for containment assertions). */
function inside(poly: Pt2[], pt: Pt2): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > pt.y) !== (b.y > pt.y) &&
        pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
function centroid(loop: Pt2[]): Pt2 {
  let x = 0, y = 0;
  for (const p of loop) { x += p.x; y += p.y; }
  return { x: x / loop.length, y: y / loop.length };
}

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

describe('concave safety — never emit a self-intersecting (gouging) loop', () => {
  // A U-shaped pocket: a deep narrow notch cut into the top of a 40×40 block.
  const U = [
    P(0, 0), P(40, 0), P(40, 40), P(24, 40),
    P(24, 12), P(16, 12), P(16, 40), P(0, 40),
  ];

  it('a simple concave (single reflex) offset stays simple at moderate depth', () => {
    for (const d of [1, 3, 5]) {
      const r = offsetPolygonInward(U, d)!;
      expect(r).not.toBeNull();
      expect(loopSelfIntersects(r)).toBe(false);
    }
  });

  it('rejects the offset once the notch would collapse into a bowtie', () => {
    // At d=6 the 8mm notch (offset 6 each wall) over-runs → self-intersection.
    expect(offsetPolygonInward(U, 6)).toBeNull();
  });

  it('every contour from a concave pocket is a simple polygon', () => {
    const contours = insetContours(U, 2, 3);
    expect(contours.length).toBeGreaterThan(0);
    for (const c of contours) expect(loopSelfIntersects(c)).toBe(false);
  });

  it('loopSelfIntersects flags a hand-built bowtie', () => {
    const bowtie = [P(0, 0), P(10, 10), P(10, 0), P(0, 10)];
    expect(loopSelfIntersects(bowtie)).toBe(true);
    expect(loopSelfIntersects(square(10))).toBe(false);
  });
});

describe('offsetPolygonInwardMulti — topology-aware (splits + recovery)', () => {
  // Dumbbell: two 10×10 boxes joined by a 10×2 neck (y∈[4,6]). Offsetting by
  // more than half the neck height (1) pinches the neck and splits the pocket.
  const dumbbell: Pt2[] = [
    P(0, 0), P(10, 0), P(10, 4), P(20, 4), P(20, 0), P(30, 0),
    P(30, 10), P(20, 10), P(20, 6), P(10, 6), P(10, 10), P(0, 10),
  ];

  it('keeps a single loop while the neck still survives (d < half-neck)', () => {
    const loops = offsetPolygonInwardMulti(dumbbell, 0.5);
    expect(loops).toHaveLength(1);
    expect(loopSelfIntersects(loops[0]!)).toBe(false);
    expect(signedArea(loops[0]!)).toBeGreaterThan(0);
  });

  it('splits into two CCW pockets once the neck pinches off (d > half-neck)', () => {
    const loops = offsetPolygonInwardMulti(dumbbell, 1.5);
    expect(loops.length).toBe(2);
    for (const l of loops) {
      expect(signedArea(l)).toBeGreaterThan(0);     // CCW (folds filtered)
      expect(loopSelfIntersects(l)).toBe(false);    // each simple
    }
    // one pocket sits on the left, the other on the right of the pinch.
    const cx = loops.map(l => centroid(l).x).sort((a, b) => a - b);
    expect(cx[0]!).toBeLessThan(12);
    expect(cx[1]!).toBeGreaterThan(18);
    // every vertex of every loop lies inside the source pocket.
    for (const l of loops) for (const p of l) expect(inside(dumbbell, p)).toBe(true);
  });

  // A U-pocket whose 8-wide notch over-runs at d=6: the conservative single
  // solver gives null; the topology-aware one recovers the salvageable region.
  const U: Pt2[] = [
    P(0, 0), P(40, 0), P(40, 40), P(24, 40),
    P(24, 12), P(16, 12), P(16, 40), P(0, 40),
  ];

  it('recovers a valid loop where offsetPolygonInward bailed out (null)', () => {
    expect(offsetPolygonInward(U, 6)).toBeNull();
    const loops = offsetPolygonInwardMulti(U, 6);
    expect(loops.length).toBeGreaterThanOrEqual(1);
    for (const l of loops) {
      expect(loopSelfIntersects(l)).toBe(false);
      expect(signedArea(l)).toBeGreaterThan(0);
      for (const p of l) expect(inside(U, p)).toBe(true);
    }
  });

  it('agrees with the simple solver when there is no self-intersection', () => {
    const single = offsetPolygonInward(square(10), 2)!; // 6×6 = 36
    const multi = offsetPolygonInwardMulti(square(10), 2, { resolution: 0.1 });
    expect(multi).toHaveLength(1);
    // marching-squares is resolution-limited, so compare within a grid-scale band.
    const area = signedArea(multi[0]!), target = signedArea(single); // 36
    expect(area).toBeGreaterThan(target - 1.5);
    expect(area).toBeLessThan(target + 1.5);
  });

  it('empty when the offset over-runs a convex polygon entirely', () => {
    expect(offsetPolygonInwardMulti(square(10), 5)).toEqual([]); // no interior
  });
});

describe('insetContoursMulti — clears both sides of a pinch', () => {
  const dumbbell: Pt2[] = [
    P(0, 0), P(10, 0), P(10, 4), P(20, 4), P(20, 0), P(30, 0),
    P(30, 10), P(20, 10), P(20, 6), P(10, 6), P(10, 10), P(0, 10),
  ];

  it('produces loops past the pinch on BOTH sides (left and right pockets)', () => {
    const contours = insetContoursMulti(dumbbell, 1.5, 1.5);
    expect(contours.length).toBeGreaterThan(2);
    for (const c of contours) expect(loopSelfIntersects(c)).toBe(false);
    const anyLeft = contours.some(c => centroid(c).x < 12);
    const anyRight = contours.some(c => centroid(c).x > 18);
    expect(anyLeft && anyRight).toBe(true);
  });
});
