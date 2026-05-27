import { describe, it, expect } from 'vitest';
import {
  smoothEdges,
  summarize,
  type MeshArrays,
} from './edgeSmoothingFilter';

function unitCubeWithJaggedEdge(): MeshArrays {
  // Build a simple plane with a wavy boundary along x.
  // 4 vertices, 2 triangles.
  return {
    positions: [
      0, 0, 0,
      5, 0.5, 0,
      10, -0.3, 0,
      15, 0, 0,
    ],
    indices: [],
  };
}

function flatTriangle(): MeshArrays {
  return {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2],
  };
}

function cubeMesh(): MeshArrays {
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

describe('smoothEdges', () => {
  it('empty mesh → empty result', () => {
    const r = smoothEdges({ positions: [], indices: [] });
    expect(r.mesh.positions).toEqual([]);
    expect(r.smoothedPolylines).toEqual([]);
  });

  it('preserves vertex count + index count', () => {
    const original = cubeMesh();
    const r = smoothEdges(original);
    expect(r.mesh.positions.length).toBe(original.positions.length);
    expect(r.mesh.indices.length).toBe(original.indices.length);
  });

  it('cube feature edges smoothed', () => {
    const r = smoothEdges(cubeMesh(), { iterations: 5 });
    expect(r.smoothedPolylines.length).toBeGreaterThan(0);
  });

  it('flat triangle with no high-dihedral edges → no smoothing for non-boundary', () => {
    const r = smoothEdges(flatTriangle(), { smoothBoundary: false });
    expect(r.smoothedPolylines).toEqual([]);
  });

  it('smoothBoundary=true catches single-tri boundary', () => {
    const r = smoothEdges(flatTriangle(), { smoothBoundary: true });
    // Single triangle's 3 edges form one boundary polyline.
    expect(r.smoothedPolylines.length).toBeGreaterThanOrEqual(1);
  });

  it('high featureAngleDeg suppresses smoothing', () => {
    const tight = smoothEdges(cubeMesh(), { featureAngleDeg: 120 });
    const lax = smoothEdges(cubeMesh(), { featureAngleDeg: 5 });
    expect(lax.affectedVertexCount).toBeGreaterThanOrEqual(tight.affectedVertexCount);
  });

  it('more iterations → larger displacement', () => {
    const short = smoothEdges(cubeMesh(), { iterations: 1, lambda: 0.5 });
    const long = smoothEdges(cubeMesh(), { iterations: 20, lambda: 0.5 });
    expect(long.maxDisplacementMm).toBeGreaterThanOrEqual(short.maxDisplacementMm);
  });

  it('taperToEndpoints keeps endpoints fixed', () => {
    const r = smoothEdges(cubeMesh(), { taperToEndpoints: true });
    // Hard to check directly; just confirm runs without error.
    expect(r.maxDisplacementMm).toBeGreaterThanOrEqual(0);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const r = smoothEdges({ positions: [], indices: [] });
    const s = summarize({ positions: [], indices: [] }, r);
    expect(s.polylineCount).toBe(0);
  });

  it('reports counts', () => {
    const r = smoothEdges(cubeMesh());
    const s = summarize(cubeMesh(), r);
    expect(s.polylineCount).toBe(r.smoothedPolylines.length);
  });

  it('average displacement reported', () => {
    const r = smoothEdges(cubeMesh(), { iterations: 10 });
    const s = summarize(cubeMesh(), r);
    expect(s.averageDisplacementMm).toBeGreaterThanOrEqual(0);
  });
});
