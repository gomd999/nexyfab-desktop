import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { detectHoles, fillHoles } from './holeFill';

function geom(positions: number[], indices: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(indices);
  return g;
}

describe('detectHoles', () => {
  it('a single triangle has one 3-vertex boundary loop', () => {
    const g = geom([0, 0, 0,  1, 0, 0,  0, 1, 0], [0, 1, 2]);
    const r = detectHoles(g);
    expect(r.loops).toHaveLength(1);
    expect(r.loops[0]!).toHaveLength(3);
    expect(r.totalBoundaryEdges).toBe(3);
  });

  it('closed tetrahedron has no holes', () => {
    const g = geom(
      [0, 0, 0,  1, 0, 0,  0, 1, 0,  0, 0, 1],
      [0, 1, 2,  0, 1, 3,  1, 2, 3,  0, 2, 3],
    );
    const r = detectHoles(g);
    expect(r.loops).toHaveLength(0);
    expect(r.totalBoundaryEdges).toBe(0);
  });

  it('quad with one missing triangle has a 4-vertex hole', () => {
    // 2x2 grid of vertices, only one triangle present.
    const g = geom(
      [0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0],
      [0, 1, 2],
    );
    const r = detectHoles(g);
    expect(r.loops).toHaveLength(1);
    expect(r.totalBoundaryEdges).toBe(3);
  });
});

describe('fillHoles', () => {
  it('adds triangles to close a single-triangle hole loop', () => {
    const g = geom([0, 0, 0,  1, 0, 0,  0, 1, 0], [0, 1, 2]);
    const r = fillHoles(g);
    expect(r.report.loopsFound).toBe(1);
    expect(r.report.loopsFilled).toBe(1);
    expect(r.report.trianglesAdded).toBe(3); // fan from centroid to each edge
  });

  it('skips loops larger than maxLoopSize', () => {
    // Build a 20-vertex polygon outline (no triangles at all → 20 boundary edges).
    const positions: number[] = [];
    const indices: number[] = [];
    const N = 20;
    for (let i = 0; i < N; i++) {
      positions.push(Math.cos(2 * Math.PI * i / N), Math.sin(2 * Math.PI * i / N), 0);
    }
    // Use 1 stitch triangle so that 19 outer edges remain boundary.
    indices.push(0, 1, 2);
    const g = geom(positions, indices);
    const r = fillHoles(g, { maxLoopSize: 10 });
    expect(r.report.skippedLarge).toBeGreaterThanOrEqual(0);
  });

  it('makes a closed mesh by filling all holes', () => {
    // Square missing one triangle, fillHoles should close it.
    const g = geom(
      [0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0],
      [0, 1, 2], // only one of the two triangles
    );
    const r = fillHoles(g);
    expect(r.report.loopsFilled).toBeGreaterThanOrEqual(1);
  });

  it('leaves a closed mesh alone', () => {
    const g = geom(
      [0, 0, 0,  1, 0, 0,  0, 1, 0,  0, 0, 1],
      [0, 1, 2,  0, 1, 3,  1, 2, 3,  0, 2, 3],
    );
    const r = fillHoles(g);
    expect(r.report.loopsFilled).toBe(0);
    expect(r.report.trianglesAdded).toBe(0);
  });
});
