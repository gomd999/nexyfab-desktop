import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { simplifyMesh } from './meshSimplify';

function makeDenseBox(): THREE.BufferGeometry {
  // BoxGeometry(_, _, _, widthSegments, heightSegments, depthSegments)
  // 8 subdivisions per face → 6 faces × 8 × 8 × 2 tri = 768 triangles.
  const g = new THREE.BoxGeometry(20, 20, 20, 8, 8, 8);
  g.deleteAttribute('uv');
  return g;
}

function makeSphere(seg = 32): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(10, seg, seg);
  g.deleteAttribute('uv');
  return g;
}

describe('simplifyMesh · triangle reduction', () => {
  it('reduces triangle count toward the target', () => {
    const dense = makeSphere(64);
    const before = dense.index ? dense.index.count / 3 : dense.attributes.position.count / 3;
    const r = simplifyMesh(dense, { targetTriangleCount: 200 });
    expect(r.report.triangleCountBefore).toBe(before);
    // Result should be smaller than the input.
    expect(r.report.triangleCountAfter).toBeLessThan(before);
    // …and reasonably close to the target (within an order of magnitude).
    expect(r.report.triangleCountAfter).toBeLessThan(before / 2);
  });

  it('reports the grid resolution chosen', () => {
    const dense = makeSphere(64);
    const r = simplifyMesh(dense, { targetTriangleCount: 100 });
    expect(r.report.gridDivisions).toBeGreaterThanOrEqual(4);
    expect(r.report.gridDivisions).toBeLessThanOrEqual(256);
  });

  it('preserves the bbox extent (decimation does not shrink the model)', () => {
    const dense = makeDenseBox();
    dense.computeBoundingBox();
    const bbBefore = dense.boundingBox!;
    const r = simplifyMesh(dense, { targetTriangleCount: 100 });
    r.geometry.computeBoundingBox();
    const bbAfter = r.geometry.boundingBox!;
    // bbox should match within one grid cell.
    expect(Math.abs(bbAfter.max.x - bbBefore.max.x)).toBeLessThan(5);
    expect(Math.abs(bbAfter.min.x - bbBefore.min.x)).toBeLessThan(5);
  });

  it('reports collapsed triangles separately from those kept', () => {
    const dense = makeSphere(32);
    const r = simplifyMesh(dense, { targetTriangleCount: 20 });
    // Aggressive simplification should collapse plenty of tris.
    expect(r.report.collapsedTriangles).toBeGreaterThan(0);
  });
});

describe('simplifyMesh · large target = pass-through', () => {
  it('keeps the geometry roughly intact when target >= current count', () => {
    const small = makeSphere(8); // very few triangles
    const before = small.index ? small.index.count / 3 : small.attributes.position.count / 3;
    const r = simplifyMesh(small, { targetTriangleCount: before * 10 });
    expect(r.report.triangleCountAfter).toBe(before);
  });
});

describe('simplifyMesh · invariants', () => {
  it('does not mutate the input geometry', () => {
    const dense = makeSphere(32);
    const beforeVerts = dense.attributes.position.count;
    simplifyMesh(dense, { targetTriangleCount: 50 });
    expect(dense.attributes.position.count).toBe(beforeVerts);
  });

  it('output has a valid (non-empty) position attribute and indices', () => {
    const dense = makeSphere(32);
    const r = simplifyMesh(dense, { targetTriangleCount: 100 });
    expect(r.geometry.attributes.position.count).toBeGreaterThan(0);
    expect(r.geometry.index).not.toBeNull();
    expect(r.geometry.getAttribute('normal')).toBeDefined();
  });

  it('respects minGridDivisions floor', () => {
    const dense = makeSphere(64);
    const r = simplifyMesh(dense, {
      targetTriangleCount: 5,
      minGridDivisions: 8,
    });
    expect(r.report.gridDivisions).toBeGreaterThanOrEqual(8);
  });

  it('respects maxGridDivisions cap', () => {
    const dense = makeSphere(64);
    const r = simplifyMesh(dense, {
      targetTriangleCount: 10_000_000,
      maxGridDivisions: 16,
    });
    expect(r.report.gridDivisions).toBeLessThanOrEqual(16);
  });
});

describe('simplifyMesh · empty / null', () => {
  it('returns zero-count report on geometry without positions', () => {
    const r = simplifyMesh(new THREE.BufferGeometry(), { targetTriangleCount: 100 });
    expect(r.report.triangleCountBefore).toBe(0);
    expect(r.report.triangleCountAfter).toBe(0);
  });
});
