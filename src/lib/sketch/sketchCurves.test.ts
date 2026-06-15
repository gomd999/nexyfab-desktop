/**
 * Tests for sketchCurves — Phase 2.1.2 of NexyFab Pro own-CAD (ADR-013).
 */
import { describe, it, expect } from 'vitest';
import {
  quadraticBezier,
  cubicBezier,
  tessellateBezier,
  ellipsePoint,
  tessellateEllipse,
  polylineLength,
  polylineBbox,
  type Vec2,
} from './sketchCurves';

const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

describe('Bézier evaluation', () => {
  const p0: Vec2 = { x: 0, y: 0 };
  const p1: Vec2 = { x: 1, y: 2 };
  const p2: Vec2 = { x: 2, y: 0 };
  const p3: Vec2 = { x: 3, y: 1 };

  it('quadratic endpoints match control endpoints at t=0 and t=1', () => {
    expect(quadraticBezier(p0, p1, p2, 0)).toEqual({ x: 0, y: 0 });
    expect(quadraticBezier(p0, p1, p2, 1)).toEqual({ x: 2, y: 0 });
  });

  it('cubic endpoints match control endpoints at t=0 and t=1', () => {
    expect(cubicBezier(p0, p1, p2, p3, 0)).toEqual({ x: 0, y: 0 });
    expect(cubicBezier(p0, p1, p2, p3, 1)).toEqual({ x: 3, y: 1 });
  });

  it('midpoint of a symmetric quadratic is the arch apex', () => {
    // Symmetric arch: ends on x-axis, control lifted at x=1.
    const mid = quadraticBezier({ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 0 }, 0.5);
    // x is the average of the ends; y = 0.25*y0 + 0.5*y1 + 0.25*y2 = 1.
    expect(close(mid.x, 1)).toBe(true);
    expect(close(mid.y, 1)).toBe(true);
  });

  it('throws on non-finite parameter / point', () => {
    expect(() => quadraticBezier(p0, p1, p2, NaN)).toThrow();
    expect(() => cubicBezier(p0, { x: Infinity, y: 0 }, p2, p3, 0.5)).toThrow();
  });
});

describe('tessellateBezier', () => {
  it('returns segments + 1 points including both endpoints', () => {
    const pts = tessellateBezier([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], 8);
    expect(pts).toHaveLength(9);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[8]).toEqual({ x: 2, y: 0 });
  });

  it('supports cubic (4 control points)', () => {
    const pts = tessellateBezier(
      [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }],
      4,
    );
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[4]).toEqual({ x: 1, y: 0 });
  });

  it('rejects wrong control-point count and bad segment count', () => {
    expect(() => tessellateBezier([{ x: 0, y: 0 }, { x: 1, y: 1 }], 4)).toThrow();
    expect(() =>
      tessellateBezier(
        [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }],
        4,
      ),
    ).toThrow();
    expect(() => tessellateBezier([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], 0)).toThrow();
    expect(() => tessellateBezier([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], 1.5)).toThrow();
  });
});

describe('ellipsePoint', () => {
  const center: Vec2 = { x: 10, y: 5 };

  it('axis points at angle 0 and π/2 match rx and ry', () => {
    const a0 = ellipsePoint(center, 4, 2, 0);
    expect(close(a0.x, 14)).toBe(true);
    expect(close(a0.y, 5)).toBe(true);
    const a90 = ellipsePoint(center, 4, 2, Math.PI / 2);
    expect(close(a90.x, 10)).toBe(true);
    expect(close(a90.y, 7)).toBe(true);
  });

  it('rotation rotates the points about the centre', () => {
    // angle 0 normally → +rx along x; rotate by π/2 → +rx along +y.
    const p = ellipsePoint(center, 4, 2, 0, Math.PI / 2);
    expect(close(p.x, 10)).toBe(true);
    expect(close(p.y, 9)).toBe(true);
  });

  it('rejects non-positive radii', () => {
    expect(() => ellipsePoint(center, 0, 2, 0)).toThrow();
    expect(() => ellipsePoint(center, 4, -1, 0)).toThrow();
  });
});

describe('tessellateEllipse', () => {
  it('produces exactly `segments` points (closed-loop convention)', () => {
    const pts = tessellateEllipse({ x: 0, y: 0 }, 3, 3, 12);
    expect(pts).toHaveLength(12);
    // First sample is at angle 0 → (rx, 0).
    expect(close(pts[0]!.x, 3)).toBe(true);
    expect(close(pts[0]!.y, 0)).toBe(true);
  });

  it('rejects segments < 3 and non-positive radii', () => {
    expect(() => tessellateEllipse({ x: 0, y: 0 }, 3, 3, 2)).toThrow();
    expect(() => tessellateEllipse({ x: 0, y: 0 }, -3, 3, 8)).toThrow();
  });

  it('is deterministic across calls', () => {
    const a = tessellateEllipse({ x: 1, y: 2 }, 5, 3, 16, 0.4);
    const b = tessellateEllipse({ x: 1, y: 2 }, 5, 3, 16, 0.4);
    expect(a).toEqual(b);
  });
});

describe('polyline measures', () => {
  it('length of a known polyline (3-4-5 right angle = 7)', () => {
    const pts: Vec2[] = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }];
    expect(close(polylineLength(pts), 7)).toBe(true);
  });

  it('length is 0 for <2 points', () => {
    expect(polylineLength([])).toBe(0);
    expect(polylineLength([{ x: 5, y: 5 }])).toBe(0);
  });

  it('bbox of a known polyline', () => {
    const pts: Vec2[] = [
      { x: -1, y: 2 },
      { x: 3, y: -4 },
      { x: 0, y: 5 },
    ];
    expect(polylineBbox(pts)).toEqual({ minX: -1, minY: -4, maxX: 3, maxY: 5 });
  });

  it('bbox throws on empty polyline', () => {
    expect(() => polylineBbox([])).toThrow();
  });
});
