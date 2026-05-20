import { describe, it, expect } from 'vitest';
import {
  detectNonManifoldEdges,
  suggestFixes,
  extractBoundaryLoops,
  summarize,
  type MeshData,
} from './nonManifoldEdgeDetector';

// A tetrahedron (water-tight): 4 vertices, 4 triangles, 6 edges, all manifold.
const tetrahedron: MeshData = {
  vertices: [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ],
  triangles: [
    { id: 't1', v0: 0, v1: 1, v2: 2 },
    { id: 't2', v0: 0, v1: 1, v2: 3 },
    { id: 't3', v0: 0, v1: 2, v2: 3 },
    { id: 't4', v0: 1, v1: 2, v2: 3 },
  ],
};

// Two triangles sharing one edge but with a third dangling triangle on the same edge → non-manifold.
const nonManifold: MeshData = {
  vertices: [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ],
  triangles: [
    { id: 't1', v0: 0, v1: 1, v2: 2 },
    { id: 't2', v0: 0, v1: 1, v2: 3 },
    { id: 't3', v0: 0, v1: 1, v2: 4 }, // 3 triangles share edge (0,1)
  ],
};

// One triangle: 3 boundary edges, 0 manifold.
const single: MeshData = {
  vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
  triangles: [{ id: 't1', v0: 0, v1: 1, v2: 2 }],
};

describe('detectNonManifoldEdges', () => {
  it('tetrahedron is fully manifold', () => {
    const r = detectNonManifoldEdges(tetrahedron);
    expect(r.manifoldCount).toBe(6);
    expect(r.boundaryCount).toBe(0);
    expect(r.nonManifoldCount).toBe(0);
    expect(r.isClosed).toBe(true);
  });

  it('single triangle has 3 boundary edges', () => {
    const r = detectNonManifoldEdges(single);
    expect(r.boundaryCount).toBe(3);
    expect(r.isClosed).toBe(false);
  });

  it('three triangles sharing edge → non-manifold detected', () => {
    const r = detectNonManifoldEdges(nonManifold);
    expect(r.nonManifoldCount).toBeGreaterThan(0);
  });

  it('isClosed false when any boundary present', () => {
    expect(detectNonManifoldEdges(single).isClosed).toBe(false);
  });

  it('edge keys reflect vertex pair', () => {
    const r = detectNonManifoldEdges(single);
    expect(r.edges).toHaveLength(3);
    for (const e of r.edges) {
      expect(e.v0).toBeLessThan(e.v1);
    }
  });

  it('empty mesh has no edges', () => {
    const r = detectNonManifoldEdges({ vertices: [], triangles: [] });
    expect(r.edges).toEqual([]);
  });
});

describe('suggestFixes', () => {
  it('non-manifold → delete-duplicate-face', () => {
    const r = detectNonManifoldEdges(nonManifold);
    const fixes = suggestFixes(r);
    expect(fixes.some(f => f.action === 'delete-duplicate-face')).toBe(true);
  });

  it('boundary → fill-boundary', () => {
    const r = detectNonManifoldEdges(single);
    const fixes = suggestFixes(r);
    expect(fixes.every(f => f.action === 'fill-boundary')).toBe(true);
  });

  it('manifold mesh → no fix needed', () => {
    expect(suggestFixes(detectNonManifoldEdges(tetrahedron))).toEqual([]);
  });
});

describe('extractBoundaryLoops', () => {
  it('single triangle has one 3-vertex loop', () => {
    const r = detectNonManifoldEdges(single);
    const loops = extractBoundaryLoops(r);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.length).toBe(3);
  });

  it('closed mesh has no boundary loop', () => {
    expect(extractBoundaryLoops(detectNonManifoldEdges(tetrahedron))).toEqual([]);
  });
});

describe('summarize', () => {
  it('reports closed flag', () => {
    expect(summarize(detectNonManifoldEdges(tetrahedron)).isClosed).toBe(true);
  });

  it('manifoldFraction = 1 for tetrahedron', () => {
    expect(summarize(detectNonManifoldEdges(tetrahedron)).manifoldFraction).toBe(1);
  });

  it('counts non-manifold edges', () => {
    const s = summarize(detectNonManifoldEdges(nonManifold));
    expect(s.nonManifoldCount).toBeGreaterThan(0);
  });
});
