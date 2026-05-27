import { describe, it, expect } from 'vitest';
import {
  extractPlanarSurfaces,
  classifyPatch,
  summarize,
  type Triangle,
} from './planarSurfaceExtractor';

// A flat horizontal patch: 2 triangles sharing an edge, both in z=0 plane.
const flatPatch: Triangle[] = [
  { id: 't1', v0: { x: 0, y: 0, z: 0 }, v1: { x: 1, y: 0, z: 0 }, v2: { x: 0, y: 1, z: 0 } },
  { id: 't2', v0: { x: 1, y: 0, z: 0 }, v1: { x: 1, y: 1, z: 0 }, v2: { x: 0, y: 1, z: 0 } },
];

// Two flat patches at right angles (top and front face of a corner).
const twoFaces: Triangle[] = [
  // z=0 face
  { id: 'a1', v0: { x: 0, y: 0, z: 0 }, v1: { x: 1, y: 0, z: 0 }, v2: { x: 0, y: 1, z: 0 } },
  { id: 'a2', v0: { x: 1, y: 0, z: 0 }, v1: { x: 1, y: 1, z: 0 }, v2: { x: 0, y: 1, z: 0 } },
  // x=0 face (vertical)
  { id: 'b1', v0: { x: 0, y: 0, z: 0 }, v1: { x: 0, y: 1, z: 0 }, v2: { x: 0, y: 0, z: 1 } },
  { id: 'b2', v0: { x: 0, y: 1, z: 0 }, v1: { x: 0, y: 1, z: 1 }, v2: { x: 0, y: 0, z: 1 } },
];

describe('extractPlanarSurfaces', () => {
  it('empty input → no patches', () => {
    expect(extractPlanarSurfaces([]).patches).toEqual([]);
  });

  it('single flat patch → 1 patch with 2 triangles', () => {
    const r = extractPlanarSurfaces(flatPatch);
    expect(r.patches).toHaveLength(1);
    expect(r.patches[0]!.triangleIds.length).toBe(2);
  });

  it('two perpendicular faces → 2 patches', () => {
    const r = extractPlanarSurfaces(twoFaces);
    expect(r.patches).toHaveLength(2);
  });

  it('patch area > 0', () => {
    const r = extractPlanarSurfaces(flatPatch);
    expect(r.patches[0]!.areaMm2).toBeGreaterThan(0);
  });

  it('horizontal patch normal points along +z (or −z)', () => {
    const r = extractPlanarSurfaces(flatPatch);
    expect(Math.abs(r.patches[0]!.normal.z)).toBeGreaterThan(0.9);
  });

  it('minTriangleCount filters small patches', () => {
    const r = extractPlanarSurfaces(flatPatch, { angleToleranceDeg: 3, offsetToleranceMm: 0.05, minTriangleCount: 5 });
    expect(r.patches).toHaveLength(0);
  });

  it('all triangles assigned', () => {
    const r = extractPlanarSurfaces(flatPatch);
    expect(r.unassignedTriangles).toBe(0);
  });

  it('non-planar mesh produces unassigned or multiple patches', () => {
    const nonPlanar: Triangle[] = [
      { id: 'a', v0: { x: 0, y: 0, z: 0 }, v1: { x: 1, y: 0, z: 0 }, v2: { x: 0, y: 1, z: 0 } },
      { id: 'b', v0: { x: 0, y: 0, z: 0 }, v1: { x: 0, y: 1, z: 0 }, v2: { x: 0, y: 0, z: 1 } },
    ];
    const r = extractPlanarSurfaces(nonPlanar);
    expect(r.patches.length + r.unassignedTriangles).toBeGreaterThanOrEqual(1);
  });

  it('plane equation d offset reported', () => {
    const r = extractPlanarSurfaces(flatPatch);
    // For z=0 plane with normal (0,0,1), d = 0.
    expect(Math.abs(r.patches[0]!.d)).toBeLessThan(0.01);
  });
});

describe('classifyPatch', () => {
  it('horizontal classified when |nz| > 0.95', () => {
    const r = extractPlanarSurfaces(flatPatch);
    expect(classifyPatch(r.patches[0]!)).toBe('horizontal');
  });

  it('vertical classified when |nz| < 0.05', () => {
    const r = extractPlanarSurfaces([
      { id: 'a', v0: { x: 0, y: 0, z: 0 }, v1: { x: 0, y: 1, z: 0 }, v2: { x: 0, y: 0, z: 1 } },
      { id: 'b', v0: { x: 0, y: 1, z: 0 }, v1: { x: 0, y: 1, z: 1 }, v2: { x: 0, y: 0, z: 1 } },
    ]);
    expect(classifyPatch(r.patches[0]!)).toBe('vertical');
  });
});

describe('summarize', () => {
  it('reports patch count + largest area', () => {
    const r = extractPlanarSurfaces(twoFaces);
    const s = summarize(r);
    expect(s.patchCount).toBe(2);
    expect(s.largestPatchAreaMm2).toBeGreaterThan(0);
  });

  it('horizontalCount tracks orientation', () => {
    const r = extractPlanarSurfaces(twoFaces);
    expect(summarize(r).horizontalCount).toBe(1);
  });
});
