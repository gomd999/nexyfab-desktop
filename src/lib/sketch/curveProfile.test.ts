/**
 * curveProfile — curve → extrudable loop bridge tests (Phase 2.1.5).
 */
import { describe, it, expect } from 'vitest';
import {
  tessellatePath,
  ellipseLoop,
  loopPerimeter,
  curveLoopToExtrude,
} from './curveProfile';
import { extrudePolyhedron } from '@/lib/cad/featureMesh';

describe('tessellatePath', () => {
  it('a polyline of line segments returns its corners (closing dup dropped)', () => {
    const loop = tessellatePath({ x: 0, y: 0 }, [
      { kind: 'line', to: { x: 10, y: 0 } },
      { kind: 'line', to: { x: 10, y: 10 } },
      { kind: 'line', to: { x: 0, y: 10 } },
      { kind: 'line', to: { x: 0, y: 0 } }, // closing → dropped
    ]);
    expect(loop).toHaveLength(4);
    expect(loop[0]).toEqual({ x: 0, y: 0 });
  });

  it('a cubic segment is tessellated into samples sub-points', () => {
    const loop = tessellatePath(
      { x: 0, y: 0 },
      [
        { kind: 'cubic', ctrl1: { x: 0, y: 10 }, ctrl2: { x: 10, y: 10 }, to: { x: 10, y: 0 } },
        { kind: 'line', to: { x: 0, y: 0 } },
      ],
      8,
    );
    // start + 8 cubic points + (line closes to start → dropped) = 9.
    expect(loop.length).toBe(9);
    expect(loop[0]).toEqual({ x: 0, y: 0 });
  });

  it('rejects a non-positive sample count', () => {
    expect(() => tessellatePath({ x: 0, y: 0 }, [{ kind: 'line', to: { x: 1, y: 1 } }], 0)).toThrow(/positive integer/);
  });
});

describe('ellipseLoop + loopPerimeter', () => {
  it('a circle (rx=ry) loop has the expected count and perimeter', () => {
    const loop = ellipseLoop({ x: 0, y: 0 }, 5, 5, 64);
    expect(loop).toHaveLength(64);
    // Perimeter of a 64-gon inscribed in r=5 ≈ 2πr.
    expect(loopPerimeter(loop)).toBeCloseTo(2 * Math.PI * 5, 0);
  });

  it('an ellipse hits its axis extents', () => {
    const loop = ellipseLoop({ x: 0, y: 0 }, 8, 3, 4);
    const xs = loop.map((p) => p.x);
    const ys = loop.map((p) => p.y);
    expect(Math.max(...xs)).toBeCloseTo(8, 6);
    expect(Math.max(...ys)).toBeCloseTo(3, 6);
  });
});

describe('curveLoopToExtrude', () => {
  it('builds a valid extrude feature from an ellipse loop (and it meshes)', () => {
    const loop = ellipseLoop({ x: 0, y: 0 }, 6, 4, 32);
    const feat = curveLoopToExtrude(loop, { depth: 10 });
    expect(feat.kind).toBe('extrude');
    expect(feat.depth).toBe(10);
    // The faceted outline is a real prism: meshes into a closed polyhedron.
    const poly = extrudePolyhedron(feat);
    expect(poly.vertices).toHaveLength(32 * 2);
    expect(poly.faces.length).toBe(32 + 2); // 32 sides + 2 caps
  });

  it('rejects a degenerate loop or non-positive depth', () => {
    expect(() => curveLoopToExtrude([{ x: 0, y: 0 }, { x: 1, y: 0 }], { depth: 5 })).toThrow(/>= 3/);
    const loop = ellipseLoop({ x: 0, y: 0 }, 6, 4, 16);
    expect(() => curveLoopToExtrude(loop, { depth: 0 })).toThrow(/depth/);
  });
});
