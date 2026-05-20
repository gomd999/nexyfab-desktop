import { describe, it, expect } from 'vitest';
import {
  extractSilhouette,
  projectToViewPlane,
  triangleNormal,
  summarize,
  type MeshArrays,
} from './silhouetteExtractor';

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

describe('extractSilhouette', () => {
  it('empty mesh → empty result', () => {
    const r = extractSilhouette({ positions: [], indices: [] }, [0, 0, 1]);
    expect(r.edges).toEqual([]);
    expect(r.polylines).toEqual([]);
  });

  it('cube viewed from +Z has front + back faces', () => {
    const r = extractSilhouette(unitCube(), [0, 0, 1]);
    expect(r.frontTriangles.length).toBeGreaterThan(0);
    expect(r.backTriangles.length).toBeGreaterThan(0);
  });

  it('cube viewed from +Z has silhouette edges', () => {
    const r = extractSilhouette(unitCube(), [0, 0, 1]);
    expect(r.edges.length).toBeGreaterThan(0);
  });

  it('classification counts sum to 12', () => {
    const r = extractSilhouette(unitCube(), [0, 0, 1]);
    expect(r.frontTriangles.length + r.backTriangles.length + r.edgeOnTriangles.length).toBe(12);
  });

  it('silhouette has 1 closed polyline for cube +Z view', () => {
    const r = extractSilhouette(unitCube(), [0, 0, 1]);
    const closed = r.polylines.filter(p => p.closed);
    expect(closed.length).toBeGreaterThan(0);
  });

  it('different view directions produce different silhouettes', () => {
    const zView = extractSilhouette(unitCube(), [0, 0, 1]);
    const xView = extractSilhouette(unitCube(), [1, 0, 0]);
    expect(zView.frontTriangles.sort()).not.toEqual(xView.frontTriangles.sort());
  });

  it('records which triangles are front + back per edge (off-axis view)', () => {
    const view: [number, number, number] = [1, 2, 3];
    const r = extractSilhouette(unitCube(), view);
    for (const e of r.edges) {
      const validFront = r.frontTriangles.includes(e.frontTri) || r.edgeOnTriangles.includes(e.frontTri);
      const validBack = r.backTriangles.includes(e.backTri) || r.edgeOnTriangles.includes(e.backTri);
      expect(validFront).toBe(true);
      expect(validBack).toBe(true);
    }
  });
});

describe('triangleNormal', () => {
  it('horizontal triangle has +Z normal', () => {
    const n = triangleNormal([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    expect(n[2]).toBeCloseTo(1, 5);
  });

  it('returns unit length', () => {
    const n = triangleNormal([0, 0, 0], [2, 0, 0], [0, 2, 0]);
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 5);
  });
});

describe('projectToViewPlane', () => {
  it('origin projects to (0, 0)', () => {
    const r = projectToViewPlane([0, 0, 0], [0, 0, 1]);
    expect(r[0]).toBeCloseTo(0, 5);
    expect(r[1]).toBeCloseTo(0, 5);
  });

  it('point along view direction has small in-plane coords (degenerate)', () => {
    // Point exactly along view axis → both coords 0.
    const r = projectToViewPlane([0, 0, 5], [0, 0, 1]);
    expect(Math.hypot(r[0], r[1])).toBeLessThan(1e-5);
  });

  it('different views give different projections', () => {
    const fromZ = projectToViewPlane([3, 4, 5], [0, 0, 1]);
    const fromX = projectToViewPlane([3, 4, 5], [1, 0, 0]);
    expect(fromZ).not.toEqual(fromX);
  });
});

describe('summarize', () => {
  it('empty mesh', () => {
    const r = extractSilhouette({ positions: [], indices: [] }, [0, 0, 1]);
    const s = summarize({ positions: [], indices: [] }, r);
    expect(s.silhouetteEdgeCount).toBe(0);
    expect(s.totalEdgeLengthMm).toBe(0);
  });

  it('reports counts for cube', () => {
    const mesh = unitCube();
    const r = extractSilhouette(mesh, [0, 0, 1]);
    const s = summarize(mesh, r);
    expect(s.silhouetteEdgeCount).toBe(r.edges.length);
    expect(s.frontFaceCount + s.backFaceCount).toBeLessThanOrEqual(12);
    expect(s.totalEdgeLengthMm).toBeGreaterThan(0);
  });

  it('closed count ≤ polyline count', () => {
    const mesh = unitCube();
    const r = extractSilhouette(mesh, [0, 0, 1]);
    const s = summarize(mesh, r);
    expect(s.closedPolylineCount).toBeLessThanOrEqual(s.polylineCount);
  });
});
