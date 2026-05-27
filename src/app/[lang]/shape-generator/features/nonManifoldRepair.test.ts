import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { detectNonManifoldEdges, repairNonManifoldEdges } from './nonManifoldRepair';

function geom(positions: number[], indices: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(indices);
  return g;
}

describe('detectNonManifoldEdges', () => {
  it('single triangle has 3 boundary edges', () => {
    const g = geom([0, 0, 0,  1, 0, 0,  0, 1, 0], [0, 1, 2]);
    const r = detectNonManifoldEdges(g);
    expect(r.boundaryEdges).toHaveLength(3);
    expect(r.nonManifoldEdges).toHaveLength(0);
    expect(r.isClosedManifold).toBe(false);
  });

  it('closed tetrahedron is a manifold', () => {
    // Tetrahedron: 4 vertices, 4 triangles, every edge shared by 2.
    const g = geom(
      [0, 0, 0,  1, 0, 0,  0, 1, 0,  0, 0, 1],
      [
        0, 1, 2,
        0, 1, 3,
        1, 2, 3,
        0, 2, 3,
      ],
    );
    const r = detectNonManifoldEdges(g);
    expect(r.boundaryEdges).toHaveLength(0);
    expect(r.nonManifoldEdges).toHaveLength(0);
    expect(r.isClosedManifold).toBe(true);
  });

  it('detects a 3-triangle T-junction', () => {
    // Three triangles sharing the edge (0,1).
    const g = geom(
      [0, 0, 0,  1, 0, 0,  0, 1, 0,  0, -1, 0,  0, 0, 1],
      [
        0, 1, 2,
        0, 1, 3,
        0, 1, 4,
      ],
    );
    const r = detectNonManifoldEdges(g);
    const nm = r.nonManifoldEdges.find(e => e.key === '0|1');
    expect(nm).toBeDefined();
    expect(nm!.triangles).toHaveLength(3);
  });
});

describe('repairNonManifoldEdges', () => {
  it('leaves manifold mesh untouched', () => {
    const g = geom(
      [0, 0, 0,  1, 0, 0,  0, 1, 0,  0, 0, 1],
      [0, 1, 2,  0, 1, 3,  1, 2, 3,  0, 2, 3],
    );
    const r = repairNonManifoldEdges(g);
    expect(r.removed).toBe(0);
  });

  it('removes the extra triangle around a T-junction, keeping smoothest pair', () => {
    const g = geom(
      [
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        0, -1, 0,
        0, 0, 5,  // far above — produces a near-vertical normal
      ],
      [
        0, 1, 2,
        0, 1, 3,
        0, 1, 4,
      ],
    );
    const r = repairNonManifoldEdges(g);
    expect(r.removed).toBe(1);
    expect(r.remaining.nonManifoldEdges).toHaveLength(0);
  });

  it('throws on non-indexed geometry', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0,  1, 0, 0,  0, 1, 0]), 3));
    expect(() => repairNonManifoldEdges(g)).toThrow();
  });
});
