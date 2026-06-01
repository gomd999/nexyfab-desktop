/**
 * datum — reference geometry tests.
 */
import { describe, it, expect } from 'vitest';
import {
  datumPoint,
  datumAxis,
  datumAxisThroughPoints,
  offsetPoint,
  projectOntoAxis,
  axisToAxisDistance,
  ORIGIN_POINT,
  X_AXIS,
  Y_AXIS,
  Z_AXIS,
} from './datum';
import { vec3 } from './sketchPlane';

describe('datum constructors', () => {
  it('datumPoint stores position verbatim', () => {
    const p = datumPoint('p1', 'My Point', vec3(1, 2, 3));
    expect(p.kind).toBe('datum_point');
    expect(p.position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('datumAxis normalizes the direction', () => {
    const a = datumAxis('a1', 'A1', vec3(0, 0, 0), vec3(3, 0, 0));
    expect(a.direction.x).toBeCloseTo(1, 9);
  });

  it('datumAxisThroughPoints rejects coincident points', () => {
    expect(() => datumAxisThroughPoints('bad', 'B', vec3(0, 0, 0), vec3(0, 0, 0))).toThrow(/coincident/);
  });

  it('datumAxisThroughPoints sets direction = b - a (normalized)', () => {
    const ax = datumAxisThroughPoints('a', 'A', vec3(0, 0, 0), vec3(10, 0, 0));
    expect(ax.direction.x).toBeCloseTo(1, 9);
  });
});

describe('standard origin datums', () => {
  it('ORIGIN_POINT is (0,0,0)', () => {
    expect(ORIGIN_POINT.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('X/Y/Z axes have unit directions along the axes', () => {
    expect(X_AXIS.direction).toEqual({ x: 1, y: 0, z: 0 });
    expect(Y_AXIS.direction).toEqual({ x: 0, y: 1, z: 0 });
    expect(Z_AXIS.direction).toEqual({ x: 0, y: 0, z: 1 });
  });
});

describe('offsetPoint', () => {
  it('offsets along a unit direction by distance', () => {
    const p = offsetPoint('p2', 'P2', ORIGIN_POINT, vec3(0, 0, 1), 7);
    expect(p.position).toEqual({ x: 0, y: 0, z: 7 });
  });

  it('normalizes the input direction', () => {
    const p = offsetPoint('p2', 'P2', ORIGIN_POINT, vec3(5, 0, 0), 3);
    expect(p.position.x).toBeCloseTo(3, 9);
  });
});

describe('projectOntoAxis', () => {
  it('point on the X axis projects to itself', () => {
    const r = projectOntoAxis(vec3(5, 0, 0), X_AXIS);
    expect(r.foot).toEqual({ x: 5, y: 0, z: 0 });
    expect(r.perpDistance).toBeCloseTo(0, 9);
  });

  it('point off the X axis: foot is closest x-axis point + perp = 3', () => {
    const r = projectOntoAxis(vec3(5, 3, 0), X_AXIS);
    expect(r.foot.x).toBeCloseTo(5, 9);
    expect(r.foot.y).toBeCloseTo(0, 9);
    expect(r.perpDistance).toBeCloseTo(3, 9);
  });
});

describe('axisToAxisDistance', () => {
  it('intersecting axes (X and Y at origin) report distance 0, parallel=false', () => {
    const r = axisToAxisDistance(X_AXIS, Y_AXIS);
    expect(r.distance).toBeCloseTo(0, 9);
    expect(r.parallel).toBe(false);
  });

  it('parallel axes report perpendicular distance', () => {
    const xAxisShifted = datumAxis('xs', 'X shifted', vec3(0, 5, 0), vec3(1, 0, 0));
    const r = axisToAxisDistance(X_AXIS, xAxisShifted);
    expect(r.parallel).toBe(true);
    expect(r.distance).toBeCloseTo(5, 9);
  });

  it('skew axes report the closest-approach distance', () => {
    // X axis at z=0; another X-parallel axis at y=0, z=10.
    const skew = datumAxis('sk', 'Skew', vec3(0, 0, 10), vec3(0, 1, 0));
    const r = axisToAxisDistance(X_AXIS, skew);
    // X axis closest point to skew is at origin; skew closest = (0,0,10);
    // perpendicular distance between the axes = 10.
    expect(r.parallel).toBe(false);
    expect(r.distance).toBeCloseTo(10, 9);
  });

  it('coincident axes report distance 0, parallel=true', () => {
    const same = datumAxis('s', 'Same', vec3(2, 0, 0), vec3(1, 0, 0));
    const r = axisToAxisDistance(X_AXIS, same);
    expect(r.parallel).toBe(true);
    expect(r.distance).toBeCloseTo(0, 9);
  });
});
