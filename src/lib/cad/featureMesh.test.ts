/**
 * featureMesh — extrude → polyhedron tests (Phase 4.1.2).
 */
import { describe, it, expect } from 'vitest';
import {
  extrudePolyhedron,
  featureToPolyhedron,
  polyhedronEdges,
} from './featureMesh';
import type { ExtrudeFeature } from './extrudeProfile';
import { dot, sub } from '@/lib/sketch/sketchPlane';

const UNIT_SQUARE: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

function extrude(dir: ExtrudeFeature['direction'] = 'one_sided', depth = 4): ExtrudeFeature {
  return { kind: 'extrude', loop: UNIT_SQUARE, depth, direction: dir, mode: 'add' };
}

describe('extrudePolyhedron', () => {
  it('a square prism has 8 vertices, 6 faces, 12 manifold edges', () => {
    const poly = extrudePolyhedron(extrude());
    expect(poly.vertices).toHaveLength(8);
    expect(poly.faces).toHaveLength(6);
    const edges = polyhedronEdges(poly);
    expect(edges).toHaveLength(12);
    // Every edge is shared by exactly 2 faces (closed manifold).
    expect(edges.every((e) => e.faces.length === 2)).toBe(true);
  });

  it('one_sided extrudes 0..depth', () => {
    const poly = extrudePolyhedron(extrude('one_sided', 4));
    const zs = poly.vertices.map((v) => v.z).sort((a, b) => a - b);
    expect(zs[0]).toBe(0);
    expect(zs[zs.length - 1]).toBe(4);
  });

  it('midplane extrudes -depth/2..depth/2; two_sided -depth..depth', () => {
    const mid = extrudePolyhedron(extrude('midplane', 4));
    const mz = mid.vertices.map((v) => v.z);
    expect(Math.min(...mz)).toBe(-2);
    expect(Math.max(...mz)).toBe(2);
    const two = extrudePolyhedron(extrude('two_sided', 4));
    const tz = two.vertices.map((v) => v.z);
    expect(Math.min(...tz)).toBe(-4);
    expect(Math.max(...tz)).toBe(4);
  });

  it('all face normals point outward (away from the centroid)', () => {
    const poly = extrudePolyhedron(extrude());
    const c = poly.vertices.reduce(
      (acc, v) => ({ x: acc.x + v.x / 8, y: acc.y + v.y / 8, z: acc.z + v.z / 8 }),
      { x: 0, y: 0, z: 0 },
    );
    for (const f of poly.faces) {
      const p0 = poly.vertices[f.vertices[0]];
      // centroid is on the inner side → dot(normal, centroid - p0) must be < 0.
      expect(dot(f.normal, sub(c, p0))).toBeLessThan(0);
    }
  });

  it('has exactly one +Z (top) and one −Z (bottom) cap normal', () => {
    const poly = extrudePolyhedron(extrude());
    const top = poly.faces.filter((f) => f.normal.z > 0.99);
    const bottom = poly.faces.filter((f) => f.normal.z < -0.99);
    expect(top).toHaveLength(1);
    expect(bottom).toHaveLength(1);
  });

  it('rejects a degenerate loop', () => {
    expect(() =>
      extrudePolyhedron({ kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }], depth: 1, direction: 'one_sided', mode: 'add' }),
    ).toThrow(/≥ 3/);
  });
});

describe('featureToPolyhedron dispatcher', () => {
  it('meshes extrude', () => {
    expect(featureToPolyhedron(extrude())).not.toBeNull();
  });
  it('returns null for not-yet-meshable kinds', () => {
    expect(featureToPolyhedron({ kind: 'revolve' })).toBeNull();
  });
});
