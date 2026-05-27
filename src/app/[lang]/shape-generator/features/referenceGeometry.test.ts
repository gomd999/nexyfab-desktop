import { describe, it, expect } from 'vitest';
import {
  planeFromThreePoints,
  planeOffset,
  planeParallelThroughPoint,
  planeMidBetween,
  planeNormalToCurve,
  planeLineAndPoint,
  axisFromTwoPoints,
  axisFromTwoPlanes,
  axisFromPointDirection,
  axisFromCircularFace,
  csysFromOriginAndAxes,
  csysOnPlane,
  WORLD_CSYS,
  pointMid,
  pointCentroid,
  pointThreePlaneIntersect,
  pointProjectToPlane,
  pointLinePlaneIntersect,
  FRONT_PLANE,
  TOP_PLANE,
  RIGHT_PLANE,
  STANDARD_PLANES,
} from './referenceGeometry';

describe('plane construction', () => {
  it('through 3 points: XY plane normal = +Z', () => {
    const p = planeFromThreePoints([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    expect(p.normal[2]).toBeCloseTo(1, 5);
  });

  it('offset plane shifts origin along normal', () => {
    const p = planeOffset(FRONT_PLANE, 5);
    expect(p.origin[2]).toBe(5);
  });

  it('parallel through point preserves normal', () => {
    const p = planeParallelThroughPoint(FRONT_PLANE, [10, 5, 3]);
    expect(p.normal).toEqual(FRONT_PLANE.normal);
    expect(p.origin).toEqual([10, 5, 3]);
  });

  it('mid plane requires parallel inputs', () => {
    const p = planeMidBetween(FRONT_PLANE, TOP_PLANE);
    expect(p).toBeNull();
  });

  it('mid plane between two parallel planes', () => {
    const offset = planeOffset(FRONT_PLANE, 10);
    const mid = planeMidBetween(FRONT_PLANE, offset);
    expect(mid?.origin[2]).toBeCloseTo(5, 5);
  });

  it('normal to curve uses tangent as normal', () => {
    const p = planeNormalToCurve([1, 2, 3], [0, 1, 0]);
    expect(p.normal).toEqual([0, 1, 0]);
  });

  it('plane through line + external point', () => {
    const p = planeLineAndPoint([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    expect(p?.normal[2]).toBeCloseTo(1, 5);
  });

  it('plane line+point null when point on line', () => {
    const p = planeLineAndPoint([0, 0, 0], [1, 0, 0], [5, 0, 0]);
    expect(p).toBeNull();
  });
});

describe('axis construction', () => {
  it('axis from two points', () => {
    const a = axisFromTwoPoints([0, 0, 0], [10, 0, 0]);
    expect(a?.direction).toEqual([1, 0, 0]);
  });

  it('axis from two points: zero distance → null', () => {
    expect(axisFromTwoPoints([1, 1, 1], [1, 1, 1])).toBeNull();
  });

  it('axis from plane intersection (XY ∩ XZ = X-axis)', () => {
    const a = axisFromTwoPlanes(FRONT_PLANE, TOP_PLANE);
    expect(Math.abs(a!.direction[0])).toBeCloseTo(1, 5);
  });

  it('parallel planes → no axis', () => {
    const offset = planeOffset(FRONT_PLANE, 10);
    expect(axisFromTwoPlanes(FRONT_PLANE, offset)).toBeNull();
  });

  it('axis from point + direction normalizes', () => {
    const a = axisFromPointDirection([1, 0, 0], [5, 0, 0]);
    expect(Math.hypot(a.direction[0], a.direction[1], a.direction[2])).toBeCloseTo(1, 5);
  });

  it('axis from circular face normalizes normal', () => {
    const a = axisFromCircularFace([0, 0, 0], [0, 0, 10]);
    expect(a.direction[2]).toBeCloseTo(1, 5);
  });
});

describe('coordinate system construction', () => {
  it('from origin + 2 axes produces orthonormal basis', () => {
    const cs = csysFromOriginAndAxes([0, 0, 0], [1, 0, 0], [0.5, 1, 0]);
    expect(cs.xAxis[0]).toBeCloseTo(1, 5);
    expect(Math.abs(cs.xAxis[0] * cs.yAxis[0] + cs.xAxis[1] * cs.yAxis[1] + cs.xAxis[2] * cs.yAxis[2])).toBeLessThan(1e-6);
  });

  it('csys on plane sets z = plane normal', () => {
    const cs = csysOnPlane(FRONT_PLANE, [1, 0, 0]);
    expect(cs.zAxis).toEqual([0, 0, 1]);
  });

  it('WORLD_CSYS is identity', () => {
    expect(WORLD_CSYS.xAxis).toEqual([1, 0, 0]);
    expect(WORLD_CSYS.yAxis).toEqual([0, 1, 0]);
    expect(WORLD_CSYS.zAxis).toEqual([0, 0, 1]);
  });
});

describe('point construction', () => {
  it('midpoint averages coords', () => {
    expect(pointMid([0, 0, 0], [4, 6, 8]).position).toEqual([2, 3, 4]);
  });

  it('centroid of N points', () => {
    const c = pointCentroid([[0, 0, 0], [4, 0, 0], [0, 4, 0]]);
    expect(c?.position[0]).toBeCloseTo(4 / 3, 4);
  });

  it('centroid of empty → null', () => {
    expect(pointCentroid([])).toBeNull();
  });

  it('3-plane intersection at origin', () => {
    const p = pointThreePlaneIntersect(FRONT_PLANE, TOP_PLANE, RIGHT_PLANE);
    expect(p?.position[0]).toBeCloseTo(0, 9);
    expect(p?.position[1]).toBeCloseTo(0, 9);
    expect(p?.position[2]).toBeCloseTo(0, 9);
  });

  it('project point to plane drops the normal component', () => {
    const p = pointProjectToPlane([3, 4, 7], FRONT_PLANE);
    expect(p.position[2]).toBeCloseTo(0, 5);
  });

  it('line-plane intersect: vertical line hits XY plane at origin', () => {
    const p = pointLinePlaneIntersect([0, 0, 5], [0, 0, -1], FRONT_PLANE);
    expect(p?.position).toEqual([0, 0, 0]);
  });

  it('line parallel to plane → null', () => {
    const p = pointLinePlaneIntersect([0, 0, 5], [1, 0, 0], FRONT_PLANE);
    expect(p).toBeNull();
  });
});

describe('standard planes', () => {
  it('exports Front / Top / Right', () => {
    expect(STANDARD_PLANES).toHaveLength(3);
    expect(STANDARD_PLANES.map(p => p.label)).toEqual(['Front', 'Top', 'Right']);
  });
});
