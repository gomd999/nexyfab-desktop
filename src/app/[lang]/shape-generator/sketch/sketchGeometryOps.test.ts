import { describe, it, expect } from 'vitest';
import type { SketchSegment, SketchPoint } from './types';
import {
  dist,
  segmentsIntersect,
  lineLineIntersect,
  circleThrough3,
  mirrorSegments,
  offsetSegment,
  findNearestSegment,
  trimSegmentAtIntersections,
  applyFilletAtVertex,
  generateRectSegments,
  generatePolygonSegments,
  generateCircleSegments,
} from './sketchGeometryOps';

const line = (a: SketchPoint, b: SketchPoint): SketchSegment => ({ type: 'line', points: [a, b] });
const P = (x: number, y: number): SketchPoint => ({ x, y });

describe('sketchGeometryOps — primitives', () => {
  it('dist is Euclidean', () => {
    expect(dist(P(0, 0), P(3, 4))).toBe(5);
    expect(dist(P(1, 1), P(1, 1))).toBe(0);
  });

  it('lineLineIntersect returns the crossing point for true segment intersections', () => {
    const hit = lineLineIntersect(P(0, 0), P(10, 0), P(5, -5), P(5, 5));
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(5);
    expect(hit!.y).toBeCloseTo(0);
  });

  it('lineLineIntersect returns null for parallel lines', () => {
    expect(lineLineIntersect(P(0, 0), P(10, 0), P(0, 1), P(10, 1))).toBeNull();
  });

  it('lineLineIntersect returns null when segments do not reach each other', () => {
    // A stops at x=2, the vertical crosser sits at x=5 → no segment overlap.
    expect(lineLineIntersect(P(0, 0), P(2, 0), P(5, -5), P(5, 5))).toBeNull();
  });

  it('segmentsIntersect: crossing true, shared endpoint false, parallel false', () => {
    expect(segmentsIntersect(P(0, 0), P(10, 0), P(5, -5), P(5, 5))).toBe(true);
    expect(segmentsIntersect(P(0, 0), P(10, 0), P(0, 0), P(0, 10))).toBe(false); // shared endpoint
    expect(segmentsIntersect(P(0, 0), P(10, 0), P(0, 1), P(10, 1))).toBe(false); // parallel
  });

  it('circleThrough3: unit circle from 3 rim points; null when colinear', () => {
    const c = circleThrough3(P(1, 0), P(0, 1), P(-1, 0));
    expect(c).not.toBeNull();
    expect(c!.cx).toBeCloseTo(0);
    expect(c!.cy).toBeCloseTo(0);
    expect(c!.r).toBeCloseTo(1);
    expect(circleThrough3(P(0, 0), P(1, 0), P(2, 0))).toBeNull();
  });
});

describe('sketchGeometryOps — mirror', () => {
  it("axis 'y' flips X about the pivot, axis 'x' flips Y", () => {
    const segs = [line(P(1, 2), P(3, 4))];
    const my = mirrorSegments(segs, 'y', 0);
    expect(my[0].points[0]).toMatchObject({ x: -1, y: 2 });
    expect(my[0].points[1]).toMatchObject({ x: -3, y: 4 });
    const mx = mirrorSegments(segs, 'x', 0);
    expect(mx[0].points[0]).toMatchObject({ x: 1, y: -2 });
    expect(mx[0].points[1]).toMatchObject({ x: 3, y: -4 });
  });
});

describe('sketchGeometryOps — offset', () => {
  it('offsets a horizontal line perpendicularly by the distance', () => {
    const off = offsetSegment(line(P(0, 0), P(10, 0)), 5);
    expect(off).not.toBeNull();
    expect(off!.type).toBe('line');
    expect(Math.abs(off!.points[0].y)).toBeCloseTo(5);
    expect(Math.abs(off!.points[1].y)).toBeCloseTo(5);
    expect(off!.points[0].x).toBeCloseTo(0);
    expect(off!.points[1].x).toBeCloseTo(10);
  });

  it('returns null for a degenerate (zero-length) line', () => {
    expect(offsetSegment(line(P(2, 2), P(2, 2)), 5)).toBeNull();
  });
});

describe('sketchGeometryOps — findNearestSegment', () => {
  const segs = [line(P(0, 0), P(10, 0)), line(P(0, 10), P(10, 10))];

  it('picks the closest segment within threshold', () => {
    const r = findNearestSegment(segs, P(5, 1), 5);
    expect(r).not.toBeNull();
    expect(r!.index).toBe(0);
    expect(r!.distance).toBeCloseTo(1);
  });

  it('returns null when nothing is within threshold', () => {
    expect(findNearestSegment(segs, P(5, 100), 5)).toBeNull();
  });
});

describe('sketchGeometryOps — trim', () => {
  it('keeps the clicked middle portion between two crossers', () => {
    const seg = line(P(0, 0), P(20, 0));
    const crossers = [line(P(5, -5), P(5, 5)), line(P(15, -5), P(15, 5))];
    const t = trimSegmentAtIntersections(seg, crossers, P(10, 0));
    expect(t).not.toBeNull();
    expect(t!.points[0].x).toBeCloseTo(5);
    expect(t!.points[1].x).toBeCloseTo(15);
  });

  it('trims to one side when the click is past a single crosser', () => {
    const seg = line(P(0, 0), P(20, 0));
    const crossers = [line(P(10, -5), P(10, 5))];
    const t = trimSegmentAtIntersections(seg, crossers, P(15, 0));
    expect(t).not.toBeNull();
    expect(t!.points[0].x).toBeCloseTo(10); // trimmed back to the intersection
    expect(t!.points[1].x).toBeCloseTo(20); // far end kept
  });

  it('returns null when there is no intersection', () => {
    const seg = line(P(0, 0), P(20, 0));
    expect(trimSegmentAtIntersections(seg, [line(P(0, 5), P(20, 5))], P(10, 0))).toBeNull();
  });
});

describe('sketchGeometryOps — fillet', () => {
  it('rounds a 90° corner: trims both legs by the setback and inserts an arc', () => {
    // Two lines sharing the vertex (0,0): one along +X, one along +Y.
    const segs = [line(P(0, 0), P(10, 0)), line(P(0, 0), P(0, 10))];
    const out = applyFilletAtVertex(segs, P(0, 0), 2);
    expect(out).toHaveLength(3); // 2 trimmed lines + 1 arc
    const arc = out.find((s) => s.type === 'arc');
    expect(arc).toBeDefined();
    // For a 90° corner the setback equals the radius (r/tan45 = r).
    expect(arc!.points[0].x).toBeCloseTo(2);
    expect(arc!.points[0].y).toBeCloseTo(0);
    expect(arc!.points[2].x).toBeCloseTo(0);
    expect(arc!.points[2].y).toBeCloseTo(2);
    // The +X leg now starts at the tangent point (2,0).
    expect(out[0].points[0].x).toBeCloseTo(2);
  });

  it('refuses (returns input unchanged) when the radius is too large for the legs', () => {
    const segs = [line(P(0, 0), P(10, 0)), line(P(0, 0), P(0, 10))];
    const out = applyFilletAtVertex(segs, P(0, 0), 20);
    expect(out).toBe(segs); // same reference → no change
  });

  it('is a no-op when fewer than two lines meet at the vertex', () => {
    const segs = [line(P(0, 0), P(10, 0))];
    expect(applyFilletAtVertex(segs, P(0, 0), 2)).toBe(segs);
  });
});

describe('sketchGeometryOps — shape generators', () => {
  it('rectangle is 4 line segments spanning the given corners', () => {
    const segs = generateRectSegments(P(0, 0), P(10, 20));
    expect(segs).toHaveLength(4);
    expect(segs.every((s) => s.type === 'line')).toBe(true);
    const xs = segs.flatMap((s) => s.points.map((p) => p.x));
    const ys = segs.flatMap((s) => s.points.map((p) => p.y));
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(10);
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(20);
  });

  it('polygon emits one segment per side', () => {
    expect(generatePolygonSegments(P(0, 0), P(10, 0), 6)).toHaveLength(6);
    expect(generatePolygonSegments(P(0, 0), P(10, 0), 3)).toHaveLength(3);
  });

  it('circle is approximated by `sides` segments, all on the radius', () => {
    const segs = generateCircleSegments(P(0, 0), 5, 16);
    expect(segs).toHaveLength(16);
    for (const s of segs) {
      expect(dist(P(0, 0), s.points[0])).toBeCloseTo(5);
    }
  });
});
