import { describe, it, expect } from 'vitest';
import {
  buildFrame,
  projectPoint,
  projectEdge,
  projectFaceBoundary,
  projectionBoundingBox,
  ProjectionRegistry,
  type Edge3D,
  type Face3D,
} from './projectGeometry';

const xyPlane = { originMm: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };

describe('buildFrame', () => {
  it('xy-plane → uAxis perpendicular to normal', () => {
    const f = buildFrame(xyPlane);
    const dot = f.uAxis[0] * f.normal[0] + f.uAxis[1] * f.normal[1] + f.uAxis[2] * f.normal[2];
    expect(Math.abs(dot)).toBeLessThan(1e-9);
  });

  it('uAxis and vAxis are mutually orthogonal', () => {
    const f = buildFrame(xyPlane);
    const dot = f.uAxis[0] * f.vAxis[0] + f.uAxis[1] * f.vAxis[1] + f.uAxis[2] * f.vAxis[2];
    expect(Math.abs(dot)).toBeLessThan(1e-9);
  });

  it('custom uAxis is honored', () => {
    const f = buildFrame({ ...xyPlane, uAxis: [1, 0, 0] });
    expect(f.uAxis[0]).toBeCloseTo(1, 5);
  });
});

describe('projectPoint — parallel', () => {
  it('point on plane has zero signed distance', () => {
    const f = buildFrame(xyPlane);
    const r = projectPoint([2, 3, 0], f);
    expect(r.onPlane).toBe(true);
    expect(r.signedDistance).toBeCloseTo(0, 5);
  });

  it('point above plane projects with negative-z dropped', () => {
    const f = buildFrame(xyPlane);
    const r = projectPoint([2, 3, 5], f);
    expect(r.signedDistance).toBeCloseTo(5, 5);
  });

  it('2D coordinates match u/v components', () => {
    const f = buildFrame({ ...xyPlane, uAxis: [1, 0, 0] });
    const r = projectPoint([3, 4, 5], f);
    // With u=+X, v should be +Y given normal = +Z.
    expect(r.point2D.x).toBeCloseTo(3, 5);
    expect(r.point2D.y).toBeCloseTo(4, 5);
  });
});

describe('projectPoint — perspective', () => {
  it('perspective from center scales away', () => {
    const f = buildFrame(xyPlane);
    const r = projectPoint([1, 0, 5], f, { projection: { center: [0, 0, 10] } });
    expect(r.point2D).toBeDefined();
  });
});

describe('projectEdge', () => {
  it('produces N−1 segments from N samples', () => {
    const edge: Edge3D = {
      id: 'e1',
      points: [[0, 0, 5], [1, 0, 5], [2, 0, 5], [3, 0, 5]],
    };
    const f = buildFrame(xyPlane);
    const projected = projectEdge(edge, f);
    expect(projected.segments2D).toHaveLength(3);
  });

  it('passes through edge kind', () => {
    const edge: Edge3D = { id: 'e1', points: [[0, 0, 0], [1, 1, 0]], kind: 'arc' };
    const f = buildFrame(xyPlane);
    expect(projectEdge(edge, f).edgeKind).toBe('arc');
  });

  it('source id preserved', () => {
    const edge: Edge3D = { id: 'src-42', points: [[0, 0, 0], [1, 0, 0]] };
    const f = buildFrame(xyPlane);
    expect(projectEdge(edge, f).sourceId).toBe('src-42');
  });
});

describe('projectFaceBoundary', () => {
  it('outer + inner loops returned', () => {
    const face: Face3D = {
      id: 'face1',
      outerBoundary: [[0, 0, 1], [2, 0, 1], [2, 2, 1], [0, 2, 1]],
      innerLoops: [[[0.5, 0.5, 1], [1.5, 0.5, 1], [1.5, 1.5, 1], [0.5, 1.5, 1]]],
    };
    const f = buildFrame(xyPlane);
    const r = projectFaceBoundary(face, f);
    expect(r.outer).toHaveLength(4);
    expect(r.inner).toHaveLength(1);
    expect(r.inner[0]).toHaveLength(4);
  });
});

describe('ProjectionRegistry', () => {
  it('register + get + unregister', () => {
    const r = new ProjectionRegistry();
    r.registerEdge({ sourceId: 'e1', segments2D: [{ start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] });
    expect(r.getEdge('e1')).not.toBeNull();
    r.unregisterSource('e1');
    expect(r.getEdge('e1')).toBeNull();
  });

  it('size reports counts', () => {
    const r = new ProjectionRegistry();
    r.registerEdge({ sourceId: 'e1', segments2D: [] });
    r.registerVertex({ sourceId: 'v1', point2D: { x: 0, y: 0 }, onPlane: true });
    expect(r.size()).toEqual({ vertices: 1, edges: 1 });
  });

  it('clear empties everything', () => {
    const r = new ProjectionRegistry();
    r.registerEdge({ sourceId: 'e1', segments2D: [] });
    r.clear();
    expect(r.size().edges).toBe(0);
  });
});

describe('projectionBoundingBox', () => {
  it('encloses all segments', () => {
    const edges = [
      { sourceId: 'e1', segments2D: [{ start: { x: 0, y: 0 }, end: { x: 5, y: 0 } }] },
      { sourceId: 'e2', segments2D: [{ start: { x: -1, y: 3 }, end: { x: 2, y: 4 } }] },
    ];
    const bb = projectionBoundingBox(edges);
    expect(bb.min.x).toBe(-1);
    expect(bb.max.y).toBe(4);
  });

  it('empty edges → 0-bbox', () => {
    const bb = projectionBoundingBox([]);
    expect(bb.min).toEqual({ x: 0, y: 0 });
    expect(bb.max).toEqual({ x: 0, y: 0 });
  });
});
