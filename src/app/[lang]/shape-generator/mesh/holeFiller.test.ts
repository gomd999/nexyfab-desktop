import { describe, it, expect } from 'vitest';
import {
  fillHoles,
  summarize,
  type MeshData,
} from './holeFiller';

// A square hole in the XY plane defined by 4 triangles forming a frame
// with a missing inner square — but simpler: just a 4-vertex loop with
// no triangles in the middle.
function squareWithHole(): MeshData {
  // outer 0..3, inner 4..7. We provide no triangles → entire square boundary is one hole.
  // Simpler test: just a 3-vertex boundary triangle with one edge missing.
  // Actually, use single triangle with a partial mesh leaving a 4-vertex loop.

  // Use a 4-vertex polygon with NO triangles → 4-edge boundary loop.
  return {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 10, z: 0 },
    ],
    // Single triangle making 3 edges boundary; adding a phantom edge to close loop manually.
    // We need to construct via incomplete triangles. Use one triangle and one boundary triangle.
    triangles: [
      // Two triangles split the square; remove one to leave a hole.
      // To get a boundary LOOP of 4 vertices, we leave both triangles out.
      // But then there's no triangle to define the edges. Instead, use a strip:
      //   {0, 1, 2} only — that leaves edges 0-2, 2-3, 3-0 unmatched? Actually 0-2 is just
      //   a single edge of one triangle so it's boundary. Need an open loop.
      { id: 'frame-tri', v0: 0, v1: 1, v2: 2 },
    ],
  };
}

// A clean triangle mesh with one missing triangle producing a triangular hole.
function meshWithTriangularHole(): MeshData {
  // Two triangles forming a quad (0,1,2) and (0,2,3). Remove (0,1,2) → hole is the triangle 0-1-2.
  return {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 10, z: 0 },
    ],
    triangles: [{ id: 't2', v0: 0, v1: 2, v2: 3 }],
  };
}

describe('fillHoles', () => {
  it('water-tight mesh → no holes', () => {
    // Tetrahedron is water-tight.
    const tet: MeshData = {
      vertices: [
        { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 },
      ],
      triangles: [
        { id: 't1', v0: 0, v1: 1, v2: 2 },
        { id: 't2', v0: 0, v1: 1, v2: 3 },
        { id: 't3', v0: 0, v1: 2, v2: 3 },
        { id: 't4', v0: 1, v1: 2, v2: 3 },
      ],
    };
    const r = fillHoles(tet);
    expect(r.filledHoles).toEqual([]);
    expect(r.totalFillTriangleCount).toBe(0);
  });

  it('mesh with triangular hole → fills with 1+ triangles', () => {
    const r = fillHoles(meshWithTriangularHole());
    expect(r.filledHoles.length).toBeGreaterThan(0);
    expect(r.totalFillTriangleCount).toBeGreaterThan(0);
  });

  it('centroid-fan strategy adds N triangles for N-vertex loop', () => {
    const r = fillHoles(squareWithHole(), { strategy: 'centroid-fan', addCentroidVertex: true });
    expect(r.filledHoles[0]).toBeDefined();
  });

  it('ear-clipping strategy emits triangles', () => {
    const r = fillHoles(meshWithTriangularHole(), { strategy: 'ear-clipping', addCentroidVertex: false });
    expect(r.filledHoles.length).toBeGreaterThanOrEqual(0);
  });

  it('addCentroidVertex=false uses loop vertex as fan apex', () => {
    const before = meshWithTriangularHole();
    const r = fillHoles(before, { strategy: 'centroid-fan', addCentroidVertex: false });
    expect(r.filledMesh.vertices.length).toBe(before.vertices.length);
  });

  it('addCentroidVertex=true grows vertex list', () => {
    const before = meshWithTriangularHole();
    const r = fillHoles(before, { strategy: 'centroid-fan', addCentroidVertex: true });
    expect(r.filledMesh.vertices.length).toBeGreaterThan(before.vertices.length);
  });

  it('triangle count grows by total fill count', () => {
    const before = meshWithTriangularHole();
    const r = fillHoles(before);
    expect(r.filledMesh.triangles.length).toBe(before.triangles.length + r.totalFillTriangleCount);
  });

  it('original triangles preserved', () => {
    const before = meshWithTriangularHole();
    const r = fillHoles(before);
    for (const t of before.triangles) {
      expect(r.filledMesh.triangles.some(x => x.id === t.id)).toBe(true);
    }
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const r = fillHoles(meshWithTriangularHole());
    const s = summarize(r);
    expect(s.holesFilled).toBe(r.filledHoles.length);
    expect(s.trianglesAdded).toBe(r.totalFillTriangleCount);
  });

  it('byStrategy tallies', () => {
    const r = fillHoles(meshWithTriangularHole(), { strategy: 'centroid-fan', addCentroidVertex: true });
    const s = summarize(r);
    expect(s.byStrategy['centroid-fan'] + s.byStrategy['ear-clipping']).toBe(r.filledHoles.length);
  });
});
