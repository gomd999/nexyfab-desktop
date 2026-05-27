import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { fixInvertedNormals } from './invertedNormalFix';

function geom(positions: number[], indices: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(indices);
  return g;
}

describe('fixInvertedNormals', () => {
  it('leaves a consistent quad alone', () => {
    // Two triangles forming a quad — already consistent CCW.
    const g = geom(
      [0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0],
      [0, 1, 2,  0, 2, 3],
    );
    const r = fixInvertedNormals(g);
    expect(r.report.flipped).toBe(0);
  });

  it('flips one inverted triangle in a quad', () => {
    // Second triangle wound backwards (CW).
    const g = geom(
      [0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0],
      [0, 1, 2,  0, 3, 2], // shared edge 0-2 traversed same direction → inconsistent
    );
    const r = fixInvertedNormals(g);
    expect(r.report.flipped).toBe(1);
    // After flip, the second triangle should be 0, 2, 3 (or equivalent CCW).
    const idx = r.geometry.index!;
    expect(idx.count).toBe(6);
  });

  it('tracks separate components', () => {
    // Two disconnected quads.
    const g = geom(
      [
        0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
        10, 0, 0,  11, 0, 0,  11, 1, 0,  10, 1, 0,
      ],
      [0, 1, 2,  0, 2, 3,  4, 5, 6,  4, 6, 7],
    );
    const r = fixInvertedNormals(g);
    expect(r.report.componentsVisited).toBe(2);
  });

  it('throws on non-indexed geometry', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0,  1, 0, 0,  0, 1, 0]), 3));
    expect(() => fixInvertedNormals(g)).toThrow();
  });

  it('skips conflicts on non-manifold edges', () => {
    // Three triangles sharing edge 0-1.
    const g = geom(
      [0, 0, 0,  1, 0, 0,  0, 1, 0,  0, -1, 0,  0, 0, 1],
      [0, 1, 2,  1, 0, 3,  0, 1, 4],
    );
    const r = fixInvertedNormals(g);
    expect(r.report.conflictsSkipped).toBeGreaterThan(0);
  });
});
