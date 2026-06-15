/**
 * sketchBoolean — 2D polygon boolean operation tests.
 *
 * Phase 1.B coverage:
 *   - helpers (isLoopClosed, loopOrientation, toCcw)
 *   - union / subtract / intersect on convex polygons
 *   - disjoint / containment / partial-overlap topologies
 *   - eps tolerance + edge cases
 */
import { describe, it, expect } from 'vitest';
import {
  isLoopClosed,
  loopOrientation,
  toCcw,
  unionLoops,
  subtractLoops,
  intersectLoops,
  type SketchLoop,
  type Point2,
} from './sketchBoolean';

// ─── fixtures ─────────────────────────────────────────────────────────────

/** CCW unit square at origin, edge length `size`. */
function ccwSquare(size = 10, ox = 0, oy = 0): SketchLoop {
  return [
    { x: ox, y: oy },
    { x: ox + size, y: oy },
    { x: ox + size, y: oy + size },
    { x: ox, y: oy + size },
  ];
}

/** Square with closing vertex appended. */
function ccwSquareClosed(size = 10, ox = 0, oy = 0): SketchLoop {
  const s = ccwSquare(size, ox, oy) as Point2[];
  return [...s, s[0]!];
}

/** Same square but traversed CW. */
function cwSquare(size = 10, ox = 0, oy = 0): SketchLoop {
  return [...ccwSquare(size, ox, oy)].reverse();
}

/** Polygon vertex count (after stripping closing vertex). */
function uniqueCount(loop: SketchLoop): number {
  if (loop.length === 0) return 0;
  let n = loop.length;
  const first = loop[0]!;
  const last = loop[loop.length - 1]!;
  if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) n--;
  return n;
}

/** Signed area (shoelace) of an open vertex list (no closing vertex). */
function area(loop: SketchLoop): number {
  let n = loop.length;
  const first = loop[0]!;
  const last = loop[loop.length - 1]!;
  if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) n--;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % n]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

// ─── isLoopClosed ─────────────────────────────────────────────────────────

describe('isLoopClosed', () => {
  it('returns true for a closed loop (last vertex == first)', () => {
    expect(isLoopClosed(ccwSquareClosed())).toBe(true);
  });
  it('returns false for an open loop', () => {
    expect(isLoopClosed(ccwSquare())).toBe(false);
  });
  it('returns false for empty / single-vertex loop', () => {
    expect(isLoopClosed([])).toBe(false);
    expect(isLoopClosed([{ x: 1, y: 2 }])).toBe(false);
  });
  it('respects eps tolerance', () => {
    const loop: SketchLoop = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0.0001, y: 0.0001 },
    ];
    expect(isLoopClosed(loop, 1e-6)).toBe(false);
    expect(isLoopClosed(loop, 1e-3)).toBe(true);
  });
});

// ─── loopOrientation ──────────────────────────────────────────────────────

describe('loopOrientation', () => {
  it('classifies CCW square as ccw', () => {
    expect(loopOrientation(ccwSquare())).toBe('ccw');
  });
  it('classifies CW square as cw', () => {
    expect(loopOrientation(cwSquare())).toBe('cw');
  });
  it('classifies < 3 vertices as degenerate', () => {
    expect(loopOrientation([])).toBe('degenerate');
    expect(loopOrientation([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe('degenerate');
  });
  it('classifies collinear points as degenerate', () => {
    expect(loopOrientation([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ])).toBe('degenerate');
  });
  it('ignores closing vertex when present', () => {
    expect(loopOrientation(ccwSquareClosed())).toBe('ccw');
  });
});

// ─── toCcw ────────────────────────────────────────────────────────────────

describe('toCcw', () => {
  it('returns a CCW copy of a CW loop', () => {
    const out = toCcw(cwSquare());
    expect(loopOrientation(out)).toBe('ccw');
  });
  it('passes through an already-CCW loop unchanged in orientation', () => {
    const out = toCcw(ccwSquare());
    expect(loopOrientation(out)).toBe('ccw');
    expect(out.length).toBe(4);
  });
  it('preserves the closed-ness of a closed loop', () => {
    const closed = ccwSquareClosed();
    const out = toCcw(closed);
    expect(isLoopClosed(out)).toBe(true);
  });
});

// ─── unionLoops ───────────────────────────────────────────────────────────

describe('unionLoops', () => {
  it('disjoint inputs → 2 loops returned untouched', () => {
    const A = ccwSquare(5, 0, 0);
    const B = ccwSquare(5, 100, 100);
    const out = unionLoops(A, B);
    expect(out).toHaveLength(2);
  });

  it('overlapping squares → 1 combined loop with bigger area', () => {
    const A = ccwSquare(10, 0, 0);   // area 100
    const B = ccwSquare(10, 5, 5);   // area 100, overlap 25
    const out = unionLoops(A, B);
    expect(out).toHaveLength(1);
    // Union area ≈ 100 + 100 - 25 = 175
    expect(area(out[0]!)).toBeGreaterThan(150);
    expect(area(out[0]!)).toBeLessThan(180);
  });

  it('A fully inside B → returns just B', () => {
    const A = ccwSquare(2, 4, 4);   // inside
    const B = ccwSquare(10, 0, 0);
    const out = unionLoops(A, B);
    expect(out).toHaveLength(1);
    expect(area(out[0]!)).toBeCloseTo(100, 1);
  });

  it('B fully inside A → returns just A', () => {
    const A = ccwSquare(10, 0, 0);
    const B = ccwSquare(2, 4, 4);
    const out = unionLoops(A, B);
    expect(out).toHaveLength(1);
    expect(area(out[0]!)).toBeCloseTo(100, 1);
  });

  it('handles CW input by normalizing to CCW first', () => {
    const A = cwSquare(10, 0, 0);
    const B = ccwSquare(10, 5, 5);
    const out = unionLoops(A, B);
    expect(out).toHaveLength(1);
    expect(loopOrientation(out[0]!)).toBe('ccw');
  });
});

// ─── subtractLoops ────────────────────────────────────────────────────────

describe('subtractLoops', () => {
  it('disjoint inputs → returns A unchanged', () => {
    const A = ccwSquare(5, 0, 0);
    const B = ccwSquare(5, 100, 100);
    const out = subtractLoops(A, B);
    expect(out).toHaveLength(1);
    expect(area(out[0]!)).toBeCloseTo(25, 4);
  });

  it('B fully covers A → empty result', () => {
    const A = ccwSquare(2, 4, 4);
    const B = ccwSquare(10, 0, 0);
    const out = subtractLoops(A, B);
    expect(out).toHaveLength(0);
  });

  it('B fully inside A → outer A + CW inner hole', () => {
    const A = ccwSquare(10, 0, 0);
    const B = ccwSquare(2, 4, 4);
    const out = subtractLoops(A, B);
    expect(out).toHaveLength(2);
    // Outer loop should be CCW.
    expect(loopOrientation(out[0]!)).toBe('ccw');
    // Inner loop (hole) should be CW.
    expect(loopOrientation(out[1]!)).toBe('cw');
  });

  it('partial overlap → loop with reduced area', () => {
    const A = ccwSquare(10, 0, 0);   // area 100
    // B offset diagonally so no edges are collinear with A's (collinear
    // edge overlap is a Phase 1 limitation — see module preamble).
    const B = ccwSquare(10, 5, 5);   // overlap = 5×5 = 25
    const out = subtractLoops(A, B);
    expect(out.length).toBeGreaterThanOrEqual(1);
    const totalArea = out.reduce((acc, l) => acc + Math.abs(area(l)), 0);
    expect(totalArea).toBeCloseTo(75, 0);
  });

  it('B clips a corner notch out of A', () => {
    const A = ccwSquare(10, 0, 0);
    const B = ccwSquare(4, -2, -2);  // overlaps SW corner by 2×2 = 4
    const out = subtractLoops(A, B);
    expect(out.length).toBeGreaterThanOrEqual(1);
    const totalArea = out.reduce((acc, l) => acc + Math.abs(area(l)), 0);
    expect(totalArea).toBeCloseTo(96, 0);
  });

  it('subtracting empty/degenerate B is a no-op', () => {
    const A = ccwSquare(10, 0, 0);
    const out = subtractLoops(A, []);
    expect(out).toHaveLength(1);
    expect(area(out[0]!)).toBeCloseTo(100, 4);
  });
});

// ─── intersectLoops ───────────────────────────────────────────────────────

describe('intersectLoops', () => {
  it('disjoint inputs → empty', () => {
    const A = ccwSquare(5, 0, 0);
    const B = ccwSquare(5, 100, 100);
    expect(intersectLoops(A, B)).toEqual([]);
  });

  it('overlapping squares → small overlap rectangle', () => {
    const A = ccwSquare(10, 0, 0);
    const B = ccwSquare(10, 5, 5);
    const out = intersectLoops(A, B);
    expect(out).toHaveLength(1);
    expect(area(out[0]!)).toBeCloseTo(25, 1);
  });

  it('B fully inside A → returns B', () => {
    const A = ccwSquare(10, 0, 0);
    const B = ccwSquare(2, 4, 4);
    const out = intersectLoops(A, B);
    expect(out).toHaveLength(1);
    expect(area(out[0]!)).toBeCloseTo(4, 4);
  });

  it('A fully inside B → returns A', () => {
    const A = ccwSquare(2, 4, 4);
    const B = ccwSquare(10, 0, 0);
    const out = intersectLoops(A, B);
    expect(out).toHaveLength(1);
    expect(area(out[0]!)).toBeCloseTo(4, 4);
  });

  it('identical squares → returns same area', () => {
    const A = ccwSquare(10, 0, 0);
    const B = ccwSquare(10, 0, 0);
    const out = intersectLoops(A, B);
    expect(out).toHaveLength(1);
    expect(area(out[0]!)).toBeCloseTo(100, 1);
  });

  it('triangle clipping rectangle yields convex piece', () => {
    const A = ccwSquare(10, 0, 0);
    const B: SketchLoop = [
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 5, y: 15 },
    ];
    const out = intersectLoops(A, B);
    expect(out).toHaveLength(1);
    expect(uniqueCount(out[0]!)).toBeGreaterThanOrEqual(3);
    expect(area(out[0]!)).toBeGreaterThan(0);
  });

  it('result is CCW oriented', () => {
    const A = ccwSquare(10, 0, 0);
    const B = ccwSquare(10, 5, 5);
    const out = intersectLoops(A, B);
    expect(loopOrientation(out[0]!)).toBe('ccw');
  });
});

// ─── tolerance / robustness ───────────────────────────────────────────────

describe('eps tolerance', () => {
  it('respects custom eps for intersection vertex coincidence', () => {
    const A = ccwSquare(10, 0, 0);
    const B = ccwSquare(10, 5, 5);
    const out1 = intersectLoops(A, B, { eps: 1e-6 });
    const out2 = intersectLoops(A, B, { eps: 1e-3 });
    expect(out1.length).toBe(1);
    expect(out2.length).toBe(1);
    expect(area(out1[0]!)).toBeCloseTo(25, 1);
    expect(area(out2[0]!)).toBeCloseTo(25, 1);
  });

  it('touching-but-not-crossing inputs treated as disjoint by union', () => {
    // Two squares meeting along the x=10 edge, no overlap.
    const A = ccwSquare(10, 0, 0);
    const B = ccwSquare(10, 10, 0);
    const out = unionLoops(A, B);
    // Either 2 loops (treated as disjoint) or 1 merged loop — both valid for
    // edge-touch. Just ensure no garbage.
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.length).toBeLessThanOrEqual(2);
    const totalArea = out.reduce((acc, l) => acc + Math.abs(area(l)), 0);
    expect(totalArea).toBeCloseTo(200, 0);
  });
});

// ─── edge cases ───────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('intersect of degenerate input → empty', () => {
    expect(intersectLoops([], ccwSquare())).toEqual([]);
    expect(intersectLoops(ccwSquare(), [])).toEqual([]);
  });

  it('union of empty inputs → empty array', () => {
    expect(unionLoops([], [])).toEqual([]);
  });

  it('subtract from empty A → empty', () => {
    expect(subtractLoops([], ccwSquare())).toEqual([]);
  });

  it('union of identical squares → single square (no doubling)', () => {
    const A = ccwSquare(10, 0, 0);
    const B = ccwSquare(10, 0, 0);
    const out = unionLoops(A, B);
    expect(out).toHaveLength(1);
    expect(area(out[0]!)).toBeCloseTo(100, 0);
  });

  it('CW input survives subtractLoops orientation normalization', () => {
    const A = cwSquare(10, 0, 0);
    const B = ccwSquare(4, 3, 3);
    const out = subtractLoops(A, B);
    // Outer loop CCW; either 1 or 2 loops depending on whether B is fully inside.
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(loopOrientation(out[0]!)).toBe('ccw');
  });
});
