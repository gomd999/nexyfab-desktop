/**
 * faceSelection — resolving an arbitrary planar face to FEA triangle indices,
 * the generalisation of bbox-face binding that lets a load/fixity sit on any
 * flat face (angled cuts, boolean faces) and survive a resize.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { selectCoplanarTriangles } from './faceSelection';

describe('selectCoplanarTriangles', () => {
  it('picks the two triangles of a box face and not the opposite face', () => {
    const g = new THREE.BoxGeometry(20, 30, 40);
    expect(selectCoplanarTriangles(g, { point: [10, 0, 0], normal: [1, 0, 0] })).toHaveLength(2);
    // Same plane point, opposite normal → the −X face does not face this way.
    expect(selectCoplanarTriangles(g, { point: [10, 0, 0], normal: [-1, 0, 0] })).toHaveLength(0);
  });

  it('resolves all six axis-aligned faces independently', () => {
    const g = new THREE.BoxGeometry(20, 20, 20);
    const faces: Array<{ point: [number, number, number]; normal: [number, number, number] }> = [
      { point: [10, 0, 0], normal: [1, 0, 0] }, { point: [-10, 0, 0], normal: [-1, 0, 0] },
      { point: [0, 10, 0], normal: [0, 1, 0] }, { point: [0, -10, 0], normal: [0, -1, 0] },
      { point: [0, 0, 10], normal: [0, 0, 1] }, { point: [0, 0, -10], normal: [0, 0, -1] },
    ];
    for (const f of faces) expect(selectCoplanarTriangles(g, f)).toHaveLength(2);
  });

  it('survives a resize when the plane is re-derived from the new solid', () => {
    const wide = new THREE.BoxGeometry(60, 30, 40); // widened in X
    // +X face now at x=30; the same face binding still resolves to its 2 triangles.
    expect(selectCoplanarTriangles(wide, { point: [30, 0, 0], normal: [1, 0, 0] })).toHaveLength(2);
  });

  it('handles an ARBITRARY (non-axis-aligned) face plane', () => {
    const g = new THREE.BoxGeometry(20, 20, 20).rotateZ(Math.PI / 4); // 45°
    const n = Math.SQRT1_2;
    const f = selectCoplanarTriangles(g, { point: [10 * n, 10 * n, 0], normal: [n, n, 0] });
    expect(f).toHaveLength(2); // the rotated +X face — bbox-name binding could never address this
  });

  it('returns empty for a plane that no face lies on', () => {
    const g = new THREE.BoxGeometry(20, 20, 20);
    expect(selectCoplanarTriangles(g, { point: [100, 0, 0], normal: [1, 0, 0] })).toEqual([]);
  });

  it('returns empty for geometry without a position attribute', () => {
    expect(selectCoplanarTriangles(new THREE.BufferGeometry(), { point: [0, 0, 0], normal: [1, 0, 0] })).toEqual([]);
  });
});
