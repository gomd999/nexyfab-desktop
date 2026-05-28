/**
 * math.test.ts — pure-math verification with hand-computed expecteds.
 *
 * Numerical tolerance: 1e-9 for closed-form ops, 1e-6 for chained ops.
 */

import { describe, it, expect } from 'vitest';
import {
  // Vec3 helpers
  add,
  sub,
  scale,
  dot,
  cross,
  length,
  normalize,
  approxEqualVec3,
  // Standards
  FRONT_PLANE,
  TOP_PLANE,
  RIGHT_PLANE,
  X_AXIS,
  Y_AXIS,
  Z_AXIS,
  WORLD_CSYS,
  standardPlane,
  standardAxis,
  // Plane constructors
  planeFromThreePoints,
  planeOffset,
  planeParallelThroughPoint,
  planeMidBetween,
  planeNormalToCurve,
  planeThroughLineAndPoint,
  planeAngleAboutAxis,
  planeTangentToCylinder,
  projectPointOntoLine,
  // Axis constructors
  axisFromTwoPoints,
  axisFromPointDirection,
  axisFromTwoPlanes,
  axisNormalToPlaneAtPoint,
  // Point constructors
  pointMid,
  pointCentroid,
  pointThreePlaneIntersect,
  pointProjectToPlane,
  pointLinePlaneIntersect,
  // CSys constructors
  csysFromOriginAndAxes,
  csysOnPlane,
} from '../math';
import type { Vec3 } from '../types';

describe('vec3 helpers', () => {
  it('add', () => {
    expect(add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
  });

  it('sub', () => {
    expect(sub([5, 7, 9], [1, 2, 3])).toEqual([4, 5, 6]);
  });

  it('scale', () => {
    expect(scale([1, 2, 3], 2)).toEqual([2, 4, 6]);
  });

  it('dot — orthogonal vectors give 0', () => {
    expect(dot([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it('dot — same vector gives squared length', () => {
    expect(dot([3, 4, 0], [3, 4, 0])).toBe(25);
  });

  it('cross — right-hand rule x × y = z', () => {
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
  });

  it('cross — anti-symmetric y × x = -z', () => {
    expect(cross([0, 1, 0], [1, 0, 0])).toEqual([0, 0, -1]);
  });

  it('length — 3-4-5 triangle', () => {
    expect(length([3, 4, 0])).toBe(5);
  });

  it('normalize — vector → unit length', () => {
    const n = normalize([3, 4, 0])!;
    expect(length(n)).toBeCloseTo(1, 12);
  });

  it('normalize — zero vector returns null', () => {
    expect(normalize([0, 0, 0])).toBeNull();
  });

  it('approxEqualVec3', () => {
    expect(approxEqualVec3([1, 2, 3], [1.0000001, 2, 3])).toBe(true);
    expect(approxEqualVec3([1, 2, 3], [1.1, 2, 3])).toBe(false);
  });
});

describe('standard planes / axes / csys', () => {
  it('FRONT_PLANE normal = +Z', () => {
    expect(FRONT_PLANE.normal).toEqual([0, 0, 1]);
  });

  it('TOP_PLANE normal = +Y', () => {
    expect(TOP_PLANE.normal).toEqual([0, 1, 0]);
  });

  it('RIGHT_PLANE normal = +X', () => {
    expect(RIGHT_PLANE.normal).toEqual([1, 0, 0]);
  });

  it('standardPlane front == xy alias', () => {
    expect(standardPlane('front')).toBe(standardPlane('xy'));
  });

  it('standardPlane top == xz alias', () => {
    expect(standardPlane('top')).toBe(standardPlane('xz'));
  });

  it('standardPlane right == yz alias', () => {
    expect(standardPlane('right')).toBe(standardPlane('yz'));
  });

  it('X/Y/Z axes are unit', () => {
    expect(X_AXIS.direction).toEqual([1, 0, 0]);
    expect(Y_AXIS.direction).toEqual([0, 1, 0]);
    expect(Z_AXIS.direction).toEqual([0, 0, 1]);
  });

  it('standardAxis returns expected', () => {
    expect(standardAxis('x')).toBe(X_AXIS);
    expect(standardAxis('y')).toBe(Y_AXIS);
    expect(standardAxis('z')).toBe(Z_AXIS);
  });

  it('WORLD_CSYS is identity', () => {
    expect(WORLD_CSYS.origin).toEqual([0, 0, 0]);
    expect(WORLD_CSYS.xAxis).toEqual([1, 0, 0]);
    expect(WORLD_CSYS.yAxis).toEqual([0, 1, 0]);
    expect(WORLD_CSYS.zAxis).toEqual([0, 0, 1]);
  });
});

describe('planeFromThreePoints', () => {
  it('XY plane: normal = +Z', () => {
    const p = planeFromThreePoints([0, 0, 0], [1, 0, 0], [0, 1, 0])!;
    expect(p.normal[2]).toBeCloseTo(1, 9);
    expect(p.normal[0]).toBeCloseTo(0, 9);
    expect(p.normal[1]).toBeCloseTo(0, 9);
  });

  it('reverses sign when winding flips', () => {
    const p = planeFromThreePoints([0, 0, 0], [0, 1, 0], [1, 0, 0])!;
    expect(p.normal[2]).toBeCloseTo(-1, 9);
  });

  it('returns null for collinear points', () => {
    expect(planeFromThreePoints([0, 0, 0], [1, 0, 0], [2, 0, 0])).toBeNull();
  });

  it('arbitrary plane: normal is unit', () => {
    const p = planeFromThreePoints([1, 0, 0], [0, 1, 0], [0, 0, 1])!;
    expect(length(p.normal)).toBeCloseTo(1, 9);
  });
});

describe('planeOffset', () => {
  it('offsets FRONT 5mm along +Z', () => {
    const p = planeOffset(FRONT_PLANE, 5);
    expect(p.origin).toEqual([0, 0, 5]);
    expect(p.normal).toEqual([0, 0, 1]);
  });

  it('negative direction flips sign', () => {
    const p = planeOffset(FRONT_PLANE, 5, -1);
    expect(p.origin).toEqual([0, 0, -5]);
  });
});

describe('planeParallelThroughPoint', () => {
  it('preserves normal, moves origin', () => {
    const p = planeParallelThroughPoint(FRONT_PLANE, [10, 5, 3]);
    expect(p.normal).toEqual(FRONT_PLANE.normal);
    expect(p.origin).toEqual([10, 5, 3]);
  });
});

describe('planeMidBetween', () => {
  it('null when not parallel', () => {
    expect(planeMidBetween(FRONT_PLANE, TOP_PLANE)).toBeNull();
  });

  it('midpoint of two parallel planes', () => {
    const p2 = planeOffset(FRONT_PLANE, 10);
    const mid = planeMidBetween(FRONT_PLANE, p2)!;
    expect(mid.origin[2]).toBeCloseTo(5, 9);
    expect(mid.normal).toEqual([0, 0, 1]);
  });

  it('anti-parallel planes still treated as parallel', () => {
    const flipped = { origin: [0, 0, 10] as Vec3, normal: [0, 0, -1] as Vec3 };
    const mid = planeMidBetween(FRONT_PLANE, flipped)!;
    expect(mid.origin[2]).toBeCloseTo(5, 9);
  });
});

describe('planeNormalToCurve', () => {
  it('normal aligns with tangent', () => {
    const p = planeNormalToCurve([1, 2, 3], [0, 5, 0])!;
    expect(p.normal).toEqual([0, 1, 0]);
    expect(p.origin).toEqual([1, 2, 3]);
  });

  it('null on zero tangent', () => {
    expect(planeNormalToCurve([0, 0, 0], [0, 0, 0])).toBeNull();
  });
});

describe('planeThroughLineAndPoint', () => {
  it('XY plane from X-axis + Y unit point', () => {
    const p = planeThroughLineAndPoint([0, 0, 0], [1, 0, 0], [0, 1, 0])!;
    expect(Math.abs(p.normal[2])).toBeCloseTo(1, 9);
  });

  it('null when point lies on line', () => {
    expect(planeThroughLineAndPoint([0, 0, 0], [1, 0, 0], [5, 0, 0])).toBeNull();
  });

  it('null on zero line direction', () => {
    expect(planeThroughLineAndPoint([0, 0, 0], [0, 0, 0], [1, 0, 0])).toBeNull();
  });
});

describe('planeAngleAboutAxis (Rodrigues §11.1)', () => {
  it('90° rotation: FRONT (+Z normal) about X-axis → +Y normal', () => {
    const p = planeAngleAboutAxis(FRONT_PLANE, X_AXIS, 90)!;
    // Rotating +Z by 90° about +X → -Y in right-hand rule.
    // R_x(90)·[0,0,1] = [0, -sin 90, cos 90] = [0, -1, 0].
    expect(approxEqualVec3(p.normal, [0, -1, 0])).toBe(true);
  });

  it('180° rotation reverses normal', () => {
    const p = planeAngleAboutAxis(FRONT_PLANE, X_AXIS, 180)!;
    expect(approxEqualVec3(p.normal, [0, 0, -1])).toBe(true);
  });

  it('0° rotation is identity', () => {
    const p = planeAngleAboutAxis(FRONT_PLANE, X_AXIS, 0)!;
    expect(approxEqualVec3(p.normal, FRONT_PLANE.normal)).toBe(true);
  });

  it('flip=true reverses normal sign', () => {
    const p = planeAngleAboutAxis(FRONT_PLANE, X_AXIS, 0, true)!;
    expect(approxEqualVec3(p.normal, [0, 0, -1])).toBe(true);
  });

  it('null on zero axis direction', () => {
    const zeroAxis = { origin: [0, 0, 0] as Vec3, direction: [0, 0, 0] as Vec3 };
    expect(planeAngleAboutAxis(FRONT_PLANE, zeroAxis, 90)).toBeNull();
  });

  it('projects parent origin onto axis line', () => {
    const offsetAxis = { origin: [0, 0, 0] as Vec3, direction: [1, 0, 0] as Vec3 };
    const parent = { origin: [3, 4, 5] as Vec3, normal: [0, 0, 1] as Vec3 };
    const p = planeAngleAboutAxis(parent, offsetAxis, 0)!;
    // Projection of (3,4,5) onto X-axis = (3,0,0).
    expect(approxEqualVec3(p.origin, [3, 0, 0])).toBe(true);
  });
});

describe('planeTangentToCylinder (§11.2)', () => {
  it('cylinder along +Z, radius 5, refDir +X → tangent at (5,0,0)', () => {
    const cylAxis = { origin: [0, 0, 0] as Vec3, direction: [0, 0, 1] as Vec3 };
    const p = planeTangentToCylinder(cylAxis, 5, [1, 0, 0])!;
    expect(approxEqualVec3(p.origin, [5, 0, 0])).toBe(true);
    expect(approxEqualVec3(p.normal, [1, 0, 0])).toBe(true);
  });

  it('refDir parallel to axis → null', () => {
    const cylAxis = { origin: [0, 0, 0] as Vec3, direction: [0, 0, 1] as Vec3 };
    expect(planeTangentToCylinder(cylAxis, 5, [0, 0, 1])).toBeNull();
  });

  it('zero radius → null', () => {
    const cylAxis = { origin: [0, 0, 0] as Vec3, direction: [0, 0, 1] as Vec3 };
    expect(planeTangentToCylinder(cylAxis, 0, [1, 0, 0])).toBeNull();
  });

  it('refDir with axial component is projected onto radial plane', () => {
    const cylAxis = { origin: [0, 0, 0] as Vec3, direction: [0, 0, 1] as Vec3 };
    const p = planeTangentToCylinder(cylAxis, 5, [1, 0, 1])!;
    // After axial-strip, refDir = (1,0,0) → tangent at (5,0,0).
    expect(approxEqualVec3(p.origin, [5, 0, 0])).toBe(true);
  });
});

describe('projectPointOntoLine', () => {
  it('projects onto X-axis', () => {
    expect(projectPointOntoLine([3, 4, 5], X_AXIS)).toEqual([3, 0, 0]);
  });

  it('point already on line is unchanged', () => {
    expect(projectPointOntoLine([7, 0, 0], X_AXIS)).toEqual([7, 0, 0]);
  });
});

describe('axisFromTwoPoints', () => {
  it('along +X', () => {
    const a = axisFromTwoPoints([0, 0, 0], [10, 0, 0])!;
    expect(a.direction).toEqual([1, 0, 0]);
  });

  it('coincident points → null', () => {
    expect(axisFromTwoPoints([1, 1, 1], [1, 1, 1])).toBeNull();
  });

  it('direction is unit', () => {
    const a = axisFromTwoPoints([0, 0, 0], [3, 4, 0])!;
    expect(length(a.direction)).toBeCloseTo(1, 12);
  });
});

describe('axisFromPointDirection', () => {
  it('normalizes direction', () => {
    const a = axisFromPointDirection([1, 2, 3], [5, 0, 0])!;
    expect(a.direction).toEqual([1, 0, 0]);
    expect(a.origin).toEqual([1, 2, 3]);
  });

  it('null on zero direction', () => {
    expect(axisFromPointDirection([0, 0, 0], [0, 0, 0])).toBeNull();
  });
});

describe('axisFromTwoPlanes', () => {
  it('XY ∩ XZ = X-axis (FRONT ∩ TOP)', () => {
    const a = axisFromTwoPlanes(FRONT_PLANE, TOP_PLANE)!;
    expect(Math.abs(a.direction[0])).toBeCloseTo(1, 9);
    // Axis passes through origin.
    expect(approxEqualVec3(a.origin, [0, 0, 0], 1e-9)).toBe(true);
  });

  it('parallel planes → null', () => {
    const p2 = planeOffset(FRONT_PLANE, 10);
    expect(axisFromTwoPlanes(FRONT_PLANE, p2)).toBeNull();
  });

  it('offset planes still produce correct line', () => {
    // FRONT shifted +5 in Z (z=5), RIGHT shifted +3 in X (x=3) → line at (3, *, 5) along Y.
    const planeA = { origin: [0, 0, 5] as Vec3, normal: [0, 0, 1] as Vec3 };
    const planeB = { origin: [3, 0, 0] as Vec3, normal: [1, 0, 0] as Vec3 };
    const a = axisFromTwoPlanes(planeA, planeB)!;
    // Direction is ±Y.
    expect(Math.abs(a.direction[1])).toBeCloseTo(1, 9);
    // Origin satisfies x = 3, z = 5.
    expect(a.origin[0]).toBeCloseTo(3, 9);
    expect(a.origin[2]).toBeCloseTo(5, 9);
  });
});

describe('axisNormalToPlaneAtPoint', () => {
  it('axis direction = plane normal', () => {
    const a = axisNormalToPlaneAtPoint(FRONT_PLANE, [10, 20, 30]);
    expect(a.direction).toEqual([0, 0, 1]);
    expect(a.origin).toEqual([10, 20, 30]);
  });
});

describe('pointMid', () => {
  it('midpoint averages coords', () => {
    expect(pointMid([0, 0, 0], [4, 6, 8]).position).toEqual([2, 3, 4]);
  });
});

describe('pointCentroid', () => {
  it('centroid of triangle vertices', () => {
    const c = pointCentroid([[0, 0, 0], [3, 0, 0], [0, 3, 0]])!;
    expect(c.position[0]).toBeCloseTo(1, 9);
    expect(c.position[1]).toBeCloseTo(1, 9);
    expect(c.position[2]).toBeCloseTo(0, 9);
  });

  it('empty → null', () => {
    expect(pointCentroid([])).toBeNull();
  });
});

describe('pointThreePlaneIntersect', () => {
  it('XY ∩ XZ ∩ YZ = origin', () => {
    const p = pointThreePlaneIntersect(FRONT_PLANE, TOP_PLANE, RIGHT_PLANE)!;
    expect(p.position[0]).toBeCloseTo(0, 9);
    expect(p.position[1]).toBeCloseTo(0, 9);
    expect(p.position[2]).toBeCloseTo(0, 9);
  });

  it('shifted planes intersect at expected point', () => {
    const a = { origin: [0, 0, 5] as Vec3, normal: [0, 0, 1] as Vec3 };
    const b = { origin: [0, 7, 0] as Vec3, normal: [0, 1, 0] as Vec3 };
    const c = { origin: [3, 0, 0] as Vec3, normal: [1, 0, 0] as Vec3 };
    const pt = pointThreePlaneIntersect(a, b, c)!;
    expect(pt.position[0]).toBeCloseTo(3, 9);
    expect(pt.position[1]).toBeCloseTo(7, 9);
    expect(pt.position[2]).toBeCloseTo(5, 9);
  });

  it('parallel planes → null', () => {
    const p2 = planeOffset(FRONT_PLANE, 10);
    expect(pointThreePlaneIntersect(FRONT_PLANE, p2, TOP_PLANE)).toBeNull();
  });
});

describe('pointProjectToPlane', () => {
  it('drops Z component for FRONT plane', () => {
    const pt = pointProjectToPlane([3, 4, 7], FRONT_PLANE);
    expect(pt.position[0]).toBeCloseTo(3, 9);
    expect(pt.position[1]).toBeCloseTo(4, 9);
    expect(pt.position[2]).toBeCloseTo(0, 9);
  });

  it('point on plane is unchanged', () => {
    const pt = pointProjectToPlane([3, 4, 0], FRONT_PLANE);
    expect(pt.position).toEqual([3, 4, 0]);
  });
});

describe('pointLinePlaneIntersect', () => {
  it('vertical line hits XY plane at origin', () => {
    const p = pointLinePlaneIntersect([0, 0, 5], [0, 0, -1], FRONT_PLANE)!;
    expect(p.position).toEqual([0, 0, 0]);
  });

  it('line parallel to plane → null', () => {
    expect(
      pointLinePlaneIntersect([0, 0, 5], [1, 0, 0], FRONT_PLANE),
    ).toBeNull();
  });

  it('line hits plane at expected parametric distance', () => {
    // Line from (0,0,10) in direction (1,0,-2) hits z=0 at t=5 → (5,0,0).
    const p = pointLinePlaneIntersect([0, 0, 10], [1, 0, -2], FRONT_PLANE)!;
    expect(p.position[0]).toBeCloseTo(5, 9);
    expect(p.position[2]).toBeCloseTo(0, 9);
  });
});

describe('csysFromOriginAndAxes', () => {
  it('right-hand orthonormal basis', () => {
    const cs = csysFromOriginAndAxes([0, 0, 0], [1, 0, 0], [0, 1, 0])!;
    expect(cs.xAxis).toEqual([1, 0, 0]);
    expect(cs.yAxis).toEqual([0, 1, 0]);
    expect(cs.zAxis).toEqual([0, 0, 1]);
  });

  it('Gram-Schmidt orthogonalizes y', () => {
    const cs = csysFromOriginAndAxes([0, 0, 0], [1, 0, 0], [0.5, 1, 0])!;
    // x · y should be 0.
    expect(dot(cs.xAxis, cs.yAxis)).toBeCloseTo(0, 9);
    // y still unit.
    expect(length(cs.yAxis)).toBeCloseTo(1, 9);
  });

  it('parallel x/y → null', () => {
    expect(csysFromOriginAndAxes([0, 0, 0], [1, 0, 0], [1, 0, 0])).toBeNull();
  });

  it('zero xDir → null', () => {
    expect(csysFromOriginAndAxes([0, 0, 0], [0, 0, 0], [0, 1, 0])).toBeNull();
  });
});

describe('csysOnPlane', () => {
  it('z = plane normal, x = inPlaneRefDir projected', () => {
    const cs = csysOnPlane(FRONT_PLANE, [1, 0, 0])!;
    expect(cs.zAxis).toEqual(FRONT_PLANE.normal);
    expect(cs.xAxis).toEqual([1, 0, 0]);
    // y derived from cross(z, x) — for FRONT plane z=+Z, x=+X → y=+Y.
    expect(approxEqualVec3(cs.yAxis, [0, 1, 0])).toBe(true);
  });

  it('inPlaneRefDir with normal component is projected', () => {
    const cs = csysOnPlane(FRONT_PLANE, [1, 0, 5])!;
    // Stripping z gives [1,0,0], normalized.
    expect(cs.xAxis).toEqual([1, 0, 0]);
  });

  it('inPlaneRefDir parallel to normal → null', () => {
    expect(csysOnPlane(FRONT_PLANE, [0, 0, 1])).toBeNull();
  });
});
