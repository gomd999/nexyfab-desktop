import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { analyzeTopology } from './meshTopology';

function mkGeom(positions: number[], indices?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (indices) g.setIndex(indices);
  return g;
}

describe('analyzeTopology · closed manifold', () => {
  it('classifies a clean box as closed manifold', () => {
    const box = new THREE.BoxGeometry(10, 10, 10);
    box.deleteAttribute('uv');
    const r = analyzeTopology(box);
    expect(r.boundaryEdgeCount).toBe(0);
    expect(r.nonManifoldEdgeCount).toBe(0);
    expect(r.isClosedManifold).toBe(true);
  });

  it('every edge in a manifold is shared by exactly 2 faces', () => {
    const box = new THREE.BoxGeometry(10, 10, 10);
    box.deleteAttribute('uv');
    const r = analyzeTopology(box);
    // A box has 6 quad faces → 2 tris each = 12 tris. Each quad has 4
    // edges shared with neighbours, plus 2 diagonal edges from the tri
    // split that are shared between the quad's own two tris. So:
    //   18 manifold edges total (12 perimeter + 6 diagonals).
    expect(r.manifoldEdgeCount).toBe(18);
  });
});

describe('analyzeTopology · boundary edges (open mesh)', () => {
  it('flags a single triangle as having 3 boundary edges', () => {
    const g = mkGeom([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ], [0, 1, 2]);
    const r = analyzeTopology(g);
    expect(r.boundaryEdgeCount).toBe(3);
    expect(r.boundaryEdges).toHaveLength(3);
    expect(r.isClosedManifold).toBe(false);
  });

  it('correctly classifies the shared internal edge as manifold', () => {
    // Two triangles sharing edge (0,1) → 1 manifold edge + 4 boundary.
    const g = mkGeom([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      1, 1, 0,
    ], [0, 1, 2,  1, 3, 2]);
    const r = analyzeTopology(g);
    expect(r.boundaryEdgeCount).toBe(4);
    expect(r.manifoldEdgeCount).toBe(1);
  });
});

describe('analyzeTopology · non-manifold edges', () => {
  it('flags 3+ faces sharing one edge as non-manifold', () => {
    // Y shape: 3 tris share the edge (0,1).
    const g = mkGeom([
      0, 0, 0,    // 0
      1, 0, 0,    // 1
      0, 1, 0,    // 2
      0, -1, 0,   // 3
      0, 0, 1,    // 4
    ], [0, 1, 2,  0, 1, 3,  0, 1, 4]);
    const r = analyzeTopology(g);
    expect(r.nonManifoldEdgeCount).toBeGreaterThan(0);
    expect(r.nonManifoldEdges[0].faceCount).toBe(3);
    expect(r.isClosedManifold).toBe(false);
  });
});

describe('analyzeTopology · winding consistency', () => {
  it('flags reversed winding on shared edges as windingFlip', () => {
    // Two adjacent triangles with REVERSED winding on the shared edge.
    const g = mkGeom([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      1, 1, 0,
    ], [
      0, 1, 2,  // edge (0,1) traversed 0→1
      0, 1, 3,  // edge (0,1) traversed 0→1 AGAIN — same direction = flip
    ]);
    const r = analyzeTopology(g);
    expect(r.windingFlipEdges.length).toBeGreaterThan(0);
    expect(r.isClosedManifold).toBe(false);
  });

  it('does NOT flag the box (consistent winding) as flipped', () => {
    const box = new THREE.BoxGeometry(10, 10, 10);
    box.deleteAttribute('uv');
    const r = analyzeTopology(box);
    expect(r.windingFlipEdges).toHaveLength(0);
  });
});

describe('analyzeTopology · isolated vertices', () => {
  it('reports unreferenced vertices with their coordinates', () => {
    const g = mkGeom([
      0, 0, 0,    // 0
      1, 0, 0,    // 1
      0, 1, 0,    // 2
      999, 998, 997, // 3 — never referenced
    ], [0, 1, 2]);
    const r = analyzeTopology(g);
    expect(r.isolatedVertices).toHaveLength(1);
    expect(r.isolatedVertices[0].index).toBe(3);
    expect(r.isolatedVertices[0].position).toEqual([999, 998, 997]);
  });
});

describe('analyzeTopology · sampleLimit', () => {
  it('caps the boundary edge list at sampleLimit', () => {
    // 3 isolated triangles = 9 boundary edges total.
    const g = mkGeom([
      0, 0, 0,  1, 0, 0,  0, 1, 0,
      5, 0, 0,  6, 0, 0,  5, 1, 0,
      10, 0, 0, 11, 0, 0, 10, 1, 0,
    ], [0, 1, 2,  3, 4, 5,  6, 7, 8]);
    const r = analyzeTopology(g, { sampleLimit: 5 });
    expect(r.boundaryEdgeCount).toBe(9);          // full count preserved
    expect(r.boundaryEdges).toHaveLength(5);      // sample capped
  });
});

describe('analyzeTopology · empty input', () => {
  it('returns zero counts when geometry has no positions', () => {
    const r = analyzeTopology(new THREE.BufferGeometry());
    expect(r.triangleCount).toBe(0);
    expect(r.isClosedManifold).toBe(false);
  });
});
