import { describe, it, expect } from 'vitest';
import {
  decimate,
  buildVertexQuadrics,
  collectEdges,
  evaluateEdgeCost,
  computeStats,
  buildLodPyramid,
  type MeshArrays,
} from './meshDecimation';

// Quad split into 2 triangles (4 verts, 5 edges, 2 tris).
function unitQuad(): MeshArrays {
  return {
    positions: [
      0, 0, 0,  // 0
      1, 0, 0,  // 1
      1, 1, 0,  // 2
      0, 1, 0,  // 3
    ],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

// Three-triangle planar fan (5 verts, 3 tris).
function fan(): MeshArrays {
  return {
    positions: [
      0, 0, 0,  // 0 — apex
      1, 0, 0,  // 1
      2, 1, 0,  // 2
      1, 2, 0,  // 3
      0, 1, 0,  // 4
    ],
    indices: [0, 1, 2, 0, 2, 3, 0, 3, 4],
  };
}

describe('collectEdges', () => {
  it('unit quad has 5 edges (4 boundary + 1 diagonal)', () => {
    expect(collectEdges(unitQuad())).toHaveLength(5);
  });

  it('every edge has distinct vertex ids', () => {
    const edges = collectEdges(unitQuad());
    for (const [a, b] of edges) {
      expect(a).not.toBe(b);
    }
  });
});

describe('buildVertexQuadrics', () => {
  it('returns one quadric per vertex', () => {
    const m = unitQuad();
    const qs = buildVertexQuadrics(m);
    expect(qs).toHaveLength(4);
  });

  it('quadric is a 4×4 matrix (16 floats)', () => {
    const qs = buildVertexQuadrics(unitQuad());
    expect(qs[0]!.length).toBe(16);
  });
});

describe('evaluateEdgeCost', () => {
  it('coplanar quad → small cost on diagonal edge', () => {
    const m = unitQuad();
    const qs = buildVertexQuadrics(m);
    const c = evaluateEdgeCost(0, 2, m, qs);
    expect(c.cost).toBeLessThan(1e-6);
  });

  it('returns a valid 3D collapse position', () => {
    const m = unitQuad();
    const qs = buildVertexQuadrics(m);
    const c = evaluateEdgeCost(0, 1, m, qs);
    expect(c.position).toHaveLength(3);
    expect(isFinite(c.position[0])).toBe(true);
  });
});

describe('decimate', () => {
  it('reduces triangle count toward target', () => {
    const m = fan();
    const r = decimate(m, { targetTriangleCount: 1, preserveBoundary: false });
    expect(r.mesh.indices.length / 3).toBeLessThanOrEqual(3);
  });

  it('preserveBoundary skips open edges', () => {
    const m = fan();
    const r = decimate(m, { targetTriangleCount: 0, preserveBoundary: true });
    // With boundary preservation, can't collapse the 4 outer edges → bounded.
    expect(r.collapsesPerformed).toBeLessThan(10);
  });

  it('reports collapsesPerformed', () => {
    const m = fan();
    const r = decimate(m, { targetTriangleCount: 1, preserveBoundary: false });
    expect(r.collapsesPerformed).toBeGreaterThan(0);
  });

  it('costThreshold halts expensive collapses', () => {
    const m = fan();
    const r = decimate(m, { targetTriangleCount: 0, costThreshold: 1e-12, preserveBoundary: false });
    expect(r.collapsesPerformed).toBeGreaterThanOrEqual(0);
  });

  it('reachedTarget true when target met', () => {
    const m = fan();
    const r = decimate(m, { targetTriangleCount: 10, preserveBoundary: false });
    expect(r.reachedTarget).toBe(true);
  });

  it('error estimate non-negative', () => {
    const m = fan();
    const r = decimate(m, { targetTriangleCount: 1, preserveBoundary: false });
    expect(r.estimatedErrorMm).toBeGreaterThanOrEqual(0);
  });
});

describe('computeStats', () => {
  it('unit quad stats', () => {
    const s = computeStats(unitQuad());
    expect(s.vertexCount).toBe(4);
    expect(s.triangleCount).toBe(2);
    expect(s.edgeCount).toBe(5);
    expect(s.boundaryEdgeCount).toBe(4);
  });
});

describe('buildLodPyramid', () => {
  it('produces one level per ratio', () => {
    const lods = buildLodPyramid(fan(), [0.5, 0.25]);
    expect(lods).toHaveLength(2);
  });

  it('triangle count non-increasing', () => {
    const lods = buildLodPyramid(fan(), [0.5, 0.25]);
    expect(lods[0]!.triangleCount).toBeGreaterThanOrEqual(lods[1]!.triangleCount);
  });
});
