import { describe, it, expect } from 'vitest';
import {
  imprintByPlane,
  intersectTriangle,
  chainSegments,
  polylineStats,
  summarize,
  type MeshArrays,
  type Plane,
} from './imprintByPlane';

function unitCube(): MeshArrays {
  return {
    positions: [
      0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
      0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
    ],
    indices: [
      0, 2, 1,  0, 3, 2,
      4, 5, 6,  4, 6, 7,
      0, 1, 5,  0, 5, 4,
      1, 2, 6,  1, 6, 5,
      2, 3, 7,  2, 7, 6,
      3, 0, 4,  3, 4, 7,
    ],
  };
}

const PLANE_Z_HALF: Plane = { origin: [0, 0, 0.5], normal: [0, 0, 1] };
const PLANE_X_HALF: Plane = { origin: [0.5, 0, 0], normal: [1, 0, 0] };

describe('imprintByPlane', () => {
  it('returns empty for an empty mesh', () => {
    const r = imprintByPlane({ positions: [], indices: [] }, PLANE_Z_HALF);
    expect(r.segments).toEqual([]);
    expect(r.polylines).toEqual([]);
  });

  it('horizontal plane through unit cube → produces a closed polyline', () => {
    const r = imprintByPlane(unitCube(), PLANE_Z_HALF);
    expect(r.segments.length).toBeGreaterThan(0);
    expect(r.polylines.length).toBeGreaterThan(0);
  });

  it('plane far from mesh → no intersection', () => {
    const r = imprintByPlane(unitCube(), { origin: [0, 0, 100], normal: [0, 0, 1] });
    expect(r.segments).toEqual([]);
  });

  it('skipped triangle count consistent', () => {
    const r = imprintByPlane(unitCube(), PLANE_Z_HALF);
    expect(r.skippedTriangles + r.segments.length).toBe(12);
  });

  it('different plane orientations yield different segments', () => {
    const a = imprintByPlane(unitCube(), PLANE_Z_HALF);
    const b = imprintByPlane(unitCube(), PLANE_X_HALF);
    expect(a.segments.length).toBeGreaterThan(0);
    expect(b.segments.length).toBeGreaterThan(0);
  });
});

describe('intersectTriangle', () => {
  it('triangle on positive side → null', () => {
    const r = intersectTriangle([0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 0, 1], -0.5, 0);
    expect(r).toBeNull();
  });

  it('triangle on negative side → null', () => {
    const r = intersectTriangle([0, 0, -1], [1, 0, -1], [1, 1, -1], [0, 0, 1], -0.5, 0);
    expect(r).toBeNull();
  });

  it('straddling triangle → segment', () => {
    const r = intersectTriangle([0, 0, 0], [1, 0, 0], [0.5, 0, 1], [0, 0, 1], -0.5, 0);
    expect(r).not.toBeNull();
    expect(r!.a[2]).toBeCloseTo(0.5, 5);
    expect(r!.b[2]).toBeCloseTo(0.5, 5);
  });

  it('records triangle id', () => {
    const r = intersectTriangle([0, 0, 0], [1, 0, 0], [0.5, 0, 1], [0, 0, 1], -0.5, 42);
    expect(r!.triangleId).toBe(42);
  });
});

describe('chainSegments', () => {
  it('empty input → empty output', () => {
    expect(chainSegments([])).toEqual([]);
  });

  it('connects two segments sharing an endpoint', () => {
    const polys = chainSegments([
      { a: [0, 0, 0], b: [1, 0, 0], triangleId: 0 },
      { a: [1, 0, 0], b: [2, 0, 0], triangleId: 1 },
    ]);
    expect(polys).toHaveLength(1);
    expect(polys[0]!.points).toHaveLength(3);
  });

  it('detects a closed loop', () => {
    const polys = chainSegments([
      { a: [0, 0, 0], b: [1, 0, 0], triangleId: 0 },
      { a: [1, 0, 0], b: [1, 1, 0], triangleId: 1 },
      { a: [1, 1, 0], b: [0, 0, 0], triangleId: 2 },
    ]);
    expect(polys).toHaveLength(1);
    expect(polys[0]!.closed).toBe(true);
  });

  it('disjoint segments become separate polylines', () => {
    const polys = chainSegments([
      { a: [0, 0, 0], b: [1, 0, 0], triangleId: 0 },
      { a: [10, 10, 10], b: [11, 10, 10], triangleId: 1 },
    ]);
    expect(polys).toHaveLength(2);
  });
});

describe('polylineStats', () => {
  it('length of straight 0→3 polyline is 3', () => {
    const s = polylineStats({ points: [[0, 0, 0], [3, 0, 0]], closed: false });
    expect(s.totalLength).toBeCloseTo(3, 5);
    expect(s.pointCount).toBe(2);
  });

  it('zero length for single point', () => {
    const s = polylineStats({ points: [[5, 5, 5]], closed: false });
    expect(s.totalLength).toBe(0);
  });
});

describe('summarize', () => {
  it('produces sensible totals on cube + Z plane', () => {
    const r = imprintByPlane(unitCube(), PLANE_Z_HALF);
    const s = summarize(r);
    expect(s.segmentCount).toBe(r.segments.length);
    expect(s.polylineCount).toBe(r.polylines.length);
    expect(s.trianglesIntersected + s.trianglesSkipped).toBe(12);
  });
});
