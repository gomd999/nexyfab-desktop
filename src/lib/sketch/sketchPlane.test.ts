/**
 * SketchPlane — Phase 1.4 acceptance tests.
 */
import { describe, it, expect } from 'vitest';
import {
  vec3,
  point2d,
  planeXY,
  planeYZ,
  planeXZ,
  fromAxes,
  fromThreePoints,
  fromOriginAndNormal,
  lengthOf,
  sub,
} from './sketchPlane';

describe('SketchPlane — standard planes', () => {
  it('XY plane: origin and normal correct', () => {
    const p = planeXY();
    expect(p.origin).toEqual({ x: 0, y: 0, z: 0 });
    expect(p.normal).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('YZ plane: localToWorld((u=2, v=3)) = (0, 2, 3)', () => {
    const p = planeYZ();
    const w = p.localToWorld(point2d(2, 3));
    expect(w).toEqual({ x: 0, y: 2, z: 3 });
  });

  it('XZ plane: localToWorld((u=5, v=4)) = (5, 0, 4)', () => {
    const p = planeXZ();
    const w = p.localToWorld(point2d(5, 4));
    expect(w).toEqual({ x: 5, y: 0, z: 4 });
  });
});

describe('SketchPlane — localToWorld / worldToLocal roundtrip', () => {
  it('XY: roundtrip preserves coords', () => {
    const p = planeXY();
    const pts = [point2d(0, 0), point2d(10, 5), point2d(-3, 7.2)];
    for (const pt of pts) {
      const w = p.localToWorld(pt);
      const back = p.worldToLocal(w);
      expect(back.u).toBeCloseTo(pt.u, 9);
      expect(back.v).toBeCloseTo(pt.v, 9);
      expect(back.w).toBeCloseTo(0, 9);
    }
  });

  it('rotated plane: roundtrip preserves coords', () => {
    const p = fromThreePoints(vec3(1, 2, 3), vec3(4, 2, 3), vec3(1, 5, 3));
    const w = p.localToWorld(point2d(7, -2));
    const back = p.worldToLocal(w);
    expect(back.u).toBeCloseTo(7, 6);
    expect(back.v).toBeCloseTo(-2, 6);
    expect(back.w).toBeCloseTo(0, 9);
  });
});

describe('SketchPlane — contains', () => {
  it('XY contains points with z≈0 only', () => {
    const p = planeXY();
    expect(p.contains(vec3(1, 2, 0))).toBe(true);
    expect(p.contains(vec3(0, 0, 0.001))).toBe(false);
  });
});

describe('SketchPlane — offsetAlongNormal', () => {
  it('XY offset by 5 → plane at z=5', () => {
    const p0 = planeXY();
    const p1 = p0.offsetAlongNormal(5);
    expect(p1.origin).toEqual({ x: 0, y: 0, z: 5 });
    expect(p1.normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(p1.contains(vec3(3, 4, 5))).toBe(true);
    expect(p1.contains(vec3(0, 0, 0))).toBe(false);
  });

  it('negative offset moves opposite to normal', () => {
    const p = planeXY().offsetAlongNormal(-2);
    expect(p.origin.z).toBeCloseTo(-2, 9);
  });
});

describe('SketchPlane — fromAxes validation', () => {
  it('accepts valid orthonormal axes', () => {
    expect(() => fromAxes(vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0))).not.toThrow();
  });
  it('rejects non-unit uAxis', () => {
    expect(() => fromAxes(vec3(0, 0, 0), vec3(2, 0, 0), vec3(0, 1, 0))).toThrow(/unit length/);
  });
  it('rejects non-orthogonal axes', () => {
    expect(() => fromAxes(vec3(0, 0, 0), vec3(1, 0, 0), vec3(1, 0, 0))).toThrow(/orthogonal/);
  });
});

describe('SketchPlane — fromThreePoints', () => {
  it('builds plane through 3 points; origin = p1', () => {
    const p = fromThreePoints(vec3(1, 1, 1), vec3(2, 1, 1), vec3(1, 2, 1));
    expect(p.origin).toEqual({ x: 1, y: 1, z: 1 });
    expect(p.normal.z).toBeCloseTo(1, 9);
  });
  it('throws on collinear points', () => {
    expect(() =>
      fromThreePoints(vec3(0, 0, 0), vec3(1, 0, 0), vec3(2, 0, 0)),
    ).toThrow(/collinear/);
  });
});

describe('SketchPlane — fromOriginAndNormal', () => {
  it('picks a stable basis perpendicular to the given normal', () => {
    const p = fromOriginAndNormal(vec3(0, 0, 0), vec3(0, 0, 1));
    expect(Math.abs(p.normal.z)).toBeCloseTo(1, 6);
    // u and v lie in the XY plane (z components zero).
    expect(Math.abs(p.uAxis.z)).toBeLessThan(1e-9);
    expect(Math.abs(p.vAxis.z)).toBeLessThan(1e-9);
  });

  it('handles arbitrary normal direction without degeneracy', () => {
    const n = { x: 1 / Math.sqrt(3), y: 1 / Math.sqrt(3), z: 1 / Math.sqrt(3) };
    const p = fromOriginAndNormal(vec3(5, 5, 5), n);
    // u and v should be unit length and orthogonal to n and each other.
    expect(Math.abs(lengthOf(p.uAxis) - 1)).toBeLessThan(1e-9);
    expect(Math.abs(lengthOf(p.vAxis) - 1)).toBeLessThan(1e-9);
    expect(Math.abs(p.uAxis.x * n.x + p.uAxis.y * n.y + p.uAxis.z * n.z)).toBeLessThan(1e-9);
    expect(Math.abs(p.vAxis.x * n.x + p.vAxis.y * n.y + p.vAxis.z * n.z)).toBeLessThan(1e-9);
  });
});

describe('SketchPlane — edge3D', () => {
  it('returns world coords for a 2D line endpoint pair', () => {
    const p = planeXY().offsetAlongNormal(2);
    const e = p.edge3D(point2d(0, 0), point2d(10, 0));
    expect(e.a).toEqual({ x: 0, y: 0, z: 2 });
    expect(e.b).toEqual({ x: 10, y: 0, z: 2 });
    const len = lengthOf(sub(e.b, e.a));
    expect(len).toBeCloseTo(10, 9);
  });
});
