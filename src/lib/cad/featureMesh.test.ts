/**
 * featureMesh — extrude → polyhedron tests (Phase 4.1.2).
 */
import { describe, it, expect } from 'vitest';
import {
  extrudePolyhedron,
  revolvePolyhedron,
  sweepPolyhedron,
  loftPolyhedron,
  featureToPolyhedron,
  polyhedronEdges,
} from './featureMesh';
import type { ExtrudeFeature } from './extrudeProfile';
import type { RevolveFeature } from './revolveProfile';
import type { SweepFeature, LoftFeature } from './sweepLoft';
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

// A rectangular profile offset from the axis → revolves into a hollow-ish
// ring / tube cross-section (a closed loop in the X≥0 half-plane).
function revolveFeat(angle = 360): RevolveFeature {
  return {
    kind: 'revolve',
    loop: [{ x: 4, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 3 }, { x: 4, y: 3 }],
    angleDegrees: angle,
    mode: 'add',
  };
}

describe('revolvePolyhedron', () => {
  it('full 360° wraps into a closed manifold (every edge shared by 2 faces)', () => {
    const poly = revolvePolyhedron(revolveFeat(360), 16);
    // 16 rings × 4 profile pts; 16 segments × 4 side quads, no caps.
    expect(poly.vertices).toHaveLength(16 * 4);
    expect(poly.faces).toHaveLength(16 * 4);
    const edges = polyhedronEdges(poly);
    expect(edges.every((e) => e.faces.length === 2)).toBe(true);
  });

  it('partial sweep adds two end caps and is open at the seam', () => {
    const poly = revolvePolyhedron(revolveFeat(90), 8);
    // 9 rings × 4 pts; 8×4 side quads + 2 caps.
    expect(poly.vertices).toHaveLength(9 * 4);
    expect(poly.faces).toHaveLength(8 * 4 + 2);
  });

  it('all face normals point outward', () => {
    const poly = revolvePolyhedron(revolveFeat(360), 12);
    const c = poly.vertices.reduce(
      (a, v) => ({ x: a.x + v.x / poly.vertices.length, y: a.y + v.y / poly.vertices.length, z: a.z + v.z / poly.vertices.length }),
      { x: 0, y: 0, z: 0 },
    );
    for (const f of poly.faces) {
      const p0 = poly.vertices[f.vertices[0]];
      expect(dot(f.normal, sub(c, p0))).toBeLessThan(1e-6);
    }
  });

  it('rejects too few segments', () => {
    expect(() => revolvePolyhedron(revolveFeat(360), 2)).toThrow(/≥ 3/);
  });
});

function sweepFeat(path: Array<{ x: number; y: number; z: number }>): SweepFeature {
  return {
    kind: 'sweep',
    profile: { points: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }] },
    path,
    mode: 'add',
  };
}

describe('sweepPolyhedron', () => {
  it('a square swept along a straight path is a closed prism', () => {
    const poly = sweepPolyhedron(sweepFeat([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }]));
    expect(poly.vertices).toHaveLength(4 * 2);
    expect(poly.faces).toHaveLength(4 + 2); // 4 sides + 2 caps
    expect(polyhedronEdges(poly).every((e) => e.faces.length === 2)).toBe(true);
  });

  it('an L-shaped path stays a closed manifold (parallel-transport frames)', () => {
    const poly = sweepPolyhedron(
      sweepFeat([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }, { x: 8, y: 0, z: 10 }]),
    );
    expect(poly.vertices).toHaveLength(4 * 3);
    expect(polyhedronEdges(poly).every((e) => e.faces.length === 2)).toBe(true);
  });

  it('rejects a too-short profile or path', () => {
    expect(() => sweepPolyhedron(sweepFeat([{ x: 0, y: 0, z: 0 }]))).toThrow(/≥ 2/);
  });
});

function sq(half: number): Array<{ x: number; y: number }> {
  return [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }];
}
function loftFeat(): LoftFeature {
  return {
    kind: 'loft',
    sections: [
      { profile: { points: sq(5) }, z: 0 },
      { profile: { points: sq(3) }, z: 10 }, // tapers inward
    ],
    mode: 'add',
  };
}

describe('loftPolyhedron', () => {
  it('two stacked square sections form a closed tapered prism', () => {
    const poly = loftPolyhedron(loftFeat());
    expect(poly.vertices).toHaveLength(4 * 2);
    expect(poly.faces).toHaveLength(4 + 2); // 4 sides + 2 caps
    expect(polyhedronEdges(poly).every((e) => e.faces.length === 2)).toBe(true);
  });

  it('sections sit at their declared z planes', () => {
    const poly = loftPolyhedron(loftFeat());
    const zs = new Set(poly.vertices.map((v) => v.z));
    expect(zs).toEqual(new Set([0, 10]));
  });

  it('rejects <2 sections or mismatched point counts', () => {
    expect(() => loftPolyhedron({ kind: 'loft', sections: [{ profile: { points: sq(5) }, z: 0 }], mode: 'add' })).toThrow(/≥ 2/);
    expect(() =>
      loftPolyhedron({
        kind: 'loft',
        sections: [
          { profile: { points: sq(5) }, z: 0 },
          { profile: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 0 }] }, z: 5 },
        ],
        mode: 'add',
      }),
    ).toThrow(/same point count/);
  });
});

describe('featureToPolyhedron dispatcher', () => {
  it('meshes extrude', () => {
    expect(featureToPolyhedron(extrude())).not.toBeNull();
  });
  it('meshes revolve', () => {
    expect(featureToPolyhedron(revolveFeat())).not.toBeNull();
  });
  it('meshes sweep', () => {
    expect(featureToPolyhedron(sweepFeat([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 }]))).not.toBeNull();
  });
  it('meshes loft', () => {
    expect(featureToPolyhedron(loftFeat())).not.toBeNull();
  });
  it('returns null for non-meshable kinds (fillet)', () => {
    expect(featureToPolyhedron({ kind: 'fillet' })).toBeNull();
  });
});
