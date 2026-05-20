import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  detectSelfIntersections,
  repairBySelfIntersectionDeletion,
} from './selfIntersection';

function triangleGeometry(verts: Array<[number, number, number]>): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const flat: number[] = [];
  for (const v of verts) flat.push(...v);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flat), 3));
  const idx: number[] = [];
  for (let i = 0; i < verts.length / 3; i++) idx.push(i * 3, i * 3 + 1, i * 3 + 2);
  g.setIndex(idx);
  return g;
}

describe('detectSelfIntersections', () => {
  it('returns no pairs for non-intersecting triangles', () => {
    const g = triangleGeometry([
      [0, 0, 0], [1, 0, 0], [0, 1, 0],
      [5, 5, 5], [6, 5, 5], [5, 6, 5],
    ]);
    const r = detectSelfIntersections(g);
    expect(r.pairs).toHaveLength(0);
    expect(r.scannedTriangles).toBe(2);
  });

  it('detects piercing triangles', () => {
    // Triangle 1 in XY plane at z=0, triangle 2 vertical through it.
    const g = triangleGeometry([
      [-1, -1, 0], [1, -1, 0], [0, 1, 0],
      [0, -2, -1], [0, 2, -1], [0, 0, 1],
    ]);
    const r = detectSelfIntersections(g);
    expect(r.pairs.length).toBeGreaterThanOrEqual(1);
    expect(r.pairs[0]!.triA).toBe(0);
    expect(r.pairs[0]!.triB).toBe(1);
  });

  it('aabb pruning skips obviously distant pairs', () => {
    const g = triangleGeometry([
      [0, 0, 0], [1, 0, 0], [0, 1, 0],
      [1000, 1000, 1000], [1001, 1000, 1000], [1000, 1001, 1000],
    ]);
    const r = detectSelfIntersections(g);
    expect(r.prunedByAabb).toBe(1);
  });

  it('skips triangles sharing a vertex by default', () => {
    // Two triangles sharing a vertex but otherwise coplanar in different planes.
    const g = triangleGeometry([
      [0, 0, 0], [1, 0, 0], [0, 1, 0],
      [0, 0, 0], [0, 1, 0], [0, 0, 1], // shares two vertices with first
    ]);
    const r = detectSelfIntersections(g);
    expect(r.pairs).toHaveLength(0);
  });
});

describe('repairBySelfIntersectionDeletion', () => {
  it('returns the same geometry untouched when no intersections', () => {
    const g = triangleGeometry([
      [0, 0, 0], [1, 0, 0], [0, 1, 0],
    ]);
    const r = repairBySelfIntersectionDeletion(g);
    expect(r.removed).toBe(0);
    expect(r.pairs).toBe(0);
  });

  it('removes the smaller triangle of a piercing pair', () => {
    const g = triangleGeometry([
      [-10, -10, 0], [10, -10, 0], [0, 10, 0], // big triangle
      [0, -1, -1], [0, 1, -1], [0, 0, 1],      // smaller piercing triangle
    ]);
    const r = repairBySelfIntersectionDeletion(g);
    expect(r.removed).toBe(1);
    expect(r.pairs).toBe(1);
    // 2 → 1 triangle remaining
    expect(r.geometry.index!.count / 3).toBe(1);
  });
});
