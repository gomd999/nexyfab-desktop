/**
 * sketchConstraintGeometry — verifies the 2D constraint solver produces the correct GEOMETRY
 * for the richer geometric constraints. The existing solver tests only pin horizontal /
 * vertical / a driving dimension; perpendicular, parallel, equal, midpoint, angle and
 * symmetric had no known-geometry check. Each here fixes enough of the sketch to make the
 * outcome unique and asserts the solved coordinates against the analytic result.
 */
import { describe, it, expect } from 'vitest';
import { solveConstraints } from './constraintSolver';
import type { SketchConstraint, SketchSegment } from './types';

const line = (id: string, a: string, ax: number, ay: number, b: string, bx: number, by: number): SketchSegment =>
  ({ type: 'line', id, points: [{ id: a, x: ax, y: ay }, { id: b, x: bx, y: by }] });
const con = (type: string, entityIds: string[], value?: number): SketchConstraint =>
  ({ id: `${type}_${entityIds.join('')}`, type, entityIds, value, satisfied: false } as unknown as SketchConstraint);
const dir = (p: Map<string, { x: number; y: number }>, a: string, b: string): [number, number] => {
  const A = p.get(a)!, B = p.get(b)!; return [B.x - A.x, B.y - A.y];
};
const len = (d: [number, number]) => Math.hypot(d[0], d[1]);

describe('sketch constraints — solved geometry (verified)', () => {
  it('perpendicular makes the line directions orthogonal (dot = 0)', () => {
    const segs = [line('s1', 'p0', 0, 0, 'p1', 10, 0), line('s2', 'q0', 0, 0, 'q1', 8, 3)];
    const r = solveConstraints(segs, [con('fixed', ['p0']), con('fixed', ['p1']), con('fixed', ['q0']), con('perpendicular', ['s1', 's2'])], [], 200, 1e-9);
    expect(r.satisfied).toBe(true);
    const d1 = dir(r.points, 'p0', 'p1'), d2 = dir(r.points, 'q0', 'q1');
    expect(d1[0] * d2[0] + d1[1] * d2[1]).toBeCloseTo(0, 5);   // ⊥
  });

  it('parallel makes the line directions collinear (cross = 0)', () => {
    const segs = [line('s1', 'p0', 0, 0, 'p1', 10, 3), line('s2', 'q0', 0, 5, 'q1', 8, 1)];
    const r = solveConstraints(segs, [con('fixed', ['p0']), con('fixed', ['p1']), con('fixed', ['q0']), con('parallel', ['s1', 's2'])], [], 200, 1e-9);
    expect(r.satisfied).toBe(true);
    const d1 = dir(r.points, 'p0', 'p1'), d2 = dir(r.points, 'q0', 'q1');
    expect(d1[0] * d2[1] - d1[1] * d2[0]).toBeCloseTo(0, 5);   // ∥
  });

  it('equal makes two segments the same length', () => {
    const segs = [line('s1', 'p0', 0, 0, 'p1', 10, 0), line('s2', 'q0', 0, 5, 'q1', 3, 5)];
    const r = solveConstraints(segs, [con('fixed', ['p0']), con('fixed', ['p1']), con('fixed', ['q0']), con('equal', ['s1', 's2'])], [], 200, 1e-9);
    expect(r.satisfied).toBe(true);
    expect(len(dir(r.points, 'q0', 'q1'))).toBeCloseTo(10, 3);
  });

  it('midpoint places a point at the centre of a line', () => {
    const segs = [line('s1', 'p0', 0, 0, 'p1', 10, 0), line('s2', 'm', 2, 2, 'z', 9, 9)];
    const r = solveConstraints(segs, [con('fixed', ['p0']), con('fixed', ['p1']), con('midpoint', ['m', 's1'])], [], 200, 1e-9);
    expect(r.satisfied).toBe(true);
    const m = r.points.get('m')!;
    expect(m.x).toBeCloseTo(5, 3);
    expect(m.y).toBeCloseTo(0, 3);
  });

  it('angle holds the prescribed angle between two lines', () => {
    const segs = [line('s1', 'p0', 0, 0, 'p1', 10, 0), line('s2', 'q0', 0, 0, 'q1', 8, 1)];
    const r = solveConstraints(segs, [con('fixed', ['p0']), con('fixed', ['p1']), con('fixed', ['q0']), con('angle', ['s1', 's2'], 60)], [], 300, 1e-9);
    expect(r.satisfied).toBe(true);
    const d1 = dir(r.points, 'p0', 'p1'), d2 = dir(r.points, 'q0', 'q1');
    const deg = Math.acos((d1[0] * d2[0] + d1[1] * d2[1]) / (len(d1) * len(d2))) * 180 / Math.PI;
    expect(deg).toBeCloseTo(60, 1);
  });

  it('symmetric mirrors a point about a coordinate axis (value 0 = X, 1 = Y)', () => {
    const make = (axis: number) =>
      solveConstraints([line('s', 'a', 3, 2, 'b', -2, 3)], [con('fixed', ['a']), con('symmetric', ['a', 'b'], axis)], [], 200, 1e-9);
    const rX = make(0).points.get('b')!;   // mirror (3,2) about the X-axis ⇒ (3,−2)
    expect(rX.x).toBeCloseTo(3, 3); expect(rX.y).toBeCloseTo(-2, 3);
    const rY = make(1).points.get('b')!;   // mirror about the Y-axis ⇒ (−3,2)
    expect(rY.x).toBeCloseTo(-3, 3); expect(rY.y).toBeCloseTo(2, 3);
  });

  it('composes: a right-angle corner with two equal legs (a square corner)', () => {
    // s1 fixed horizontal length 10; s2 shares the corner, perpendicular to s1 and equal length
    const segs = [line('s1', 'p0', 0, 0, 'p1', 10, 0), line('s2', 'p0b', 0, 0, 'q1', 4, 7)];
    const r = solveConstraints(segs, [
      con('fixed', ['p0']), con('fixed', ['p1']), con('fixed', ['p0b']),
      con('perpendicular', ['s1', 's2']), con('equal', ['s1', 's2']),
    ], [], 300, 1e-9);
    expect(r.satisfied).toBe(true);
    const d1 = dir(r.points, 'p0', 'p1'), d2 = dir(r.points, 'p0b', 'q1');
    expect(d1[0] * d2[0] + d1[1] * d2[1]).toBeCloseTo(0, 4);  // ⊥ corner
    expect(len(d2)).toBeCloseTo(10, 3);                       // equal legs
  });
});
