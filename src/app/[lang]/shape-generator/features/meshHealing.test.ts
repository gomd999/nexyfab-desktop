import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { healMesh } from './meshHealing';

function mkGeom(positions: number[], indices?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (indices) g.setIndex(indices);
  return g;
}

describe('healMesh · degenerate triangle removal', () => {
  it('drops collinear (zero-area) triangles', () => {
    const g = mkGeom([
      0, 0, 0,
      1, 0, 0,
      2, 0, 0,        // collinear → degenerate triangle
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,        // valid triangle
    ]);
    const r = healMesh(g);
    expect(r.report.removedTriangles).toBeGreaterThanOrEqual(1);
    expect(r.report.finalTriangleCount).toBe(1);
  });

  it('keeps all triangles in a clean box', () => {
    const box = new THREE.BoxGeometry(10, 10, 10);
    box.deleteAttribute('uv');
    const r = healMesh(box);
    expect(r.report.removedTriangles).toBe(0);
  });

  it('opt-out preserves degenerate triangles', () => {
    const g = mkGeom([0, 0, 0,  1, 0, 0,  2, 0, 0]);
    const r = healMesh(g, { removeDegenerateTriangles: false });
    expect(r.report.removedTriangles).toBe(0);
  });
});

describe('healMesh · vertex welding', () => {
  it('merges duplicate vertices within tolerance', () => {
    const g = mkGeom([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0.0000005, 0, 0,    // duplicate of vertex 0 within tolerance 1e-4
      1, 0, 0,            // duplicate of vertex 1
      0, 0, 1,
    ], [0, 1, 2,  3, 4, 5]);
    const r = healMesh(g);
    expect(r.report.mergedVertices).toBeGreaterThanOrEqual(2);
  });

  it('respects custom vertexMergeTolerance', () => {
    const g = mkGeom([
      0, 0, 0,
      0.5, 0, 0,        // 0.5mm apart — within 1mm but not 0.1mm tol
      0, 1, 0,
      0, 0, 1,
    ], [0, 1, 2,  0, 1, 3]);
    const tight = healMesh(g, { vertexMergeTolerance: 0.1 });
    expect(tight.report.mergedVertices).toBe(0);
    const loose = healMesh(g, { vertexMergeTolerance: 1.0 });
    expect(loose.report.mergedVertices).toBeGreaterThan(0);
  });

  it('does not merge anything when tolerance is 0', () => {
    const g = mkGeom([
      0, 0, 0,  1, 0, 0,  0, 1, 0,
      0, 0, 0,  1, 0, 0,  0, 0, 1,
    ], [0, 1, 2,  3, 4, 5]);
    const r = healMesh(g, { vertexMergeTolerance: 0 });
    expect(r.report.mergedVertices).toBe(0);
  });
});

describe('healMesh · isolated vertex removal', () => {
  it('compacts unreferenced vertices out of the position buffer', () => {
    const g = mkGeom([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      999, 999, 999,    // never referenced
    ], [0, 1, 2]);
    const r = healMesh(g);
    expect(r.report.removedIsolatedVertices).toBe(1);
    expect(r.report.finalVertexCount).toBe(3);
  });

  it('opt-out keeps isolated vertices', () => {
    const g = mkGeom([
      0, 0, 0,  1, 0, 0,  0, 1, 0,  99, 99, 99,
    ], [0, 1, 2]);
    const r = healMesh(g, { removeIsolatedVertices: false });
    expect(r.report.finalVertexCount).toBe(4);
  });
});

describe('healMesh · combined pipeline', () => {
  it('handles degenerate + duplicate + isolated in one pass', () => {
    const g = mkGeom([
      // Valid triangle:
      0, 0, 0,        // 0
      10, 0, 0,       // 1
      0, 10, 0,       // 2
      // Duplicate of vertex 0:
      0.00001, 0, 0,  // 3 (welds to 0)
      // Degenerate triangle vertices (collinear):
      0, 0, 5,        // 4
      0, 0, 6,        // 5
      0, 0, 7,        // 6
      // Isolated:
      999, 999, 999,  // 7
    ], [
      0, 1, 2,        // valid
      3, 1, 2,        // becomes (0,1,2) after welding — duplicate of first
      4, 5, 6,        // degenerate (collinear)
    ]);
    const r = healMesh(g);
    expect(r.report.removedTriangles).toBeGreaterThan(0);
    expect(r.report.mergedVertices).toBeGreaterThan(0);
    expect(r.report.removedIsolatedVertices).toBeGreaterThan(0);
  });

  it('produces a geometry the caller can use immediately (valid normals)', () => {
    const box = new THREE.BoxGeometry(10, 10, 10);
    box.deleteAttribute('uv');
    const r = healMesh(box);
    expect(r.geometry.getAttribute('normal')).toBeDefined();
    expect(r.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('does not mutate the input geometry', () => {
    const box = new THREE.BoxGeometry(10, 10, 10);
    box.deleteAttribute('uv');
    const originalVerts = box.getAttribute('position').count;
    healMesh(box);
    expect(box.getAttribute('position').count).toBe(originalVerts);
  });
});

describe('healMesh · empty / null', () => {
  it('survives geometry with no position attribute', () => {
    const r = healMesh(new THREE.BufferGeometry());
    expect(r.report.finalTriangleCount).toBe(0);
    expect(r.report.finalVertexCount).toBe(0);
  });
});
