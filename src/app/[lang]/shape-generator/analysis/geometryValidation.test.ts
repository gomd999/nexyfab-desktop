/**
 * geometryValidation — verification of the production mesh-validity gatekeeper that
 * decides whether a part is watertight/manifold before it is meshed or analysed. This is
 * the real geometry-coupled path (a THREE.BufferGeometry → edge-adjacency topology), not a
 * standalone formula, so it is checked against meshes with KNOWN topology:
 *
 *   closed box:   isClosed, isManifold, consistent normals, every edge shared by 2 faces,
 *                 Euler characteristic V − E + F = 2, exact divergence-theorem volume
 *   open mesh:    a removed face leaves boundary (open) edges ⇒ not watertight
 *   degenerate:   a triangle with coincident vertices is flagged
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { validateGeometry } from './geometryValidation';

describe('geometryValidation — mesh validity (verified vs known topology)', () => {
  it('passes a closed box: watertight, two-manifold, Euler V−E+F=2, exact volume', () => {
    const w = 40, h = 30, d = 20;
    const r = validateGeometry(new THREE.BoxGeometry(w, h, d));
    expect(r.isClosed).toBe(true);
    expect(r.isManifold).toBe(true);
    expect(r.hasConsistentNormals).toBe(true);
    expect(r.openEdges).toBe(0);
    expect(r.nonManifoldEdges).toBe(0);
    expect(r.degenerateTriangles).toBe(0);
    expect(r.totalTriangles).toBe(12);
    expect(r.totalVertices).toBe(8);                       // duplicates merged by position
    // closed two-manifold ⇒ E = 3F/2, Euler characteristic of a sphere = 2
    const E = (3 * r.totalTriangles) / 2;
    expect(r.totalVertices - E + r.totalTriangles).toBe(2);
    expect(r.volume).toBeCloseTo(w * h * d, 3);            // divergence-theorem volume
    expect(r.surfaceArea).toBeCloseTo(2 * (w * h + w * d + h * d), 3);
  });

  it('flags an open mesh (a removed face) as not watertight', () => {
    const box = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    const p = box.attributes.position.array as Float32Array;
    const cut = new THREE.BufferGeometry();
    cut.setAttribute('position', new THREE.BufferAttribute(p.slice(0, p.length - 6 * 3), 3)); // drop one face (2 tris)
    const r = validateGeometry(cut);
    expect(r.isClosed).toBe(false);
    expect(r.openEdges).toBeGreaterThan(0);               // the hole boundary
    expect(r.totalTriangles).toBe(10);
    expect(r.issues.some(s => /watertight/.test(s))).toBe(true);
  });

  it('passes a closed sphere as watertight and two-manifold', () => {
    const r = validateGeometry(new THREE.SphereGeometry(20, 24, 16));
    expect(r.isClosed).toBe(true);
    expect(r.isManifold).toBe(true);
    expect(r.openEdges).toBe(0);
  });

  it('flags a degenerate triangle and its coincident vertex', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0]), 3));
    const r = validateGeometry(g);
    expect(r.degenerateTriangles).toBe(1);
    expect(r.duplicateVertices).toBeGreaterThan(0);
  });
});
