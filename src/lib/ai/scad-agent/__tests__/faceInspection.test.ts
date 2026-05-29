/**
 * faceInspection.test.ts — Phase X2 topology + genus.
 *
 * Validates the Euler-characteristic-based through-hole counter against
 * synthetic geometries built directly via three.js so the test isn't
 * tied to OpenSCAD output. Counterexamples (open meshes, multi-body)
 * verify that genus comes back null when undefined.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  computeMeshTopology,
  countThroughHoles,
  compareHoleCount,
} from '../faceInspection';

/** Build a degenerate-stripped non-indexed BufferGeometry from a list
 *  of triangles (each triangle = 9 floats, x0,y0,z0,x1,y1,z1,x2,y2,z2). */
function geomFromTris(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
  return g;
}

describe('computeMeshTopology — closed manifolds (genus 0)', () => {
  it('a single cube has χ=2, genus=0, manifoldClosed=true', () => {
    const cube = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    const t = computeMeshTopology(cube);
    expect(t.vertexCount).toBe(8);
    expect(t.faceCount).toBe(12);
    expect(t.eulerChar).toBe(2);
    expect(t.manifoldClosed).toBe(true);
    expect(t.genus).toBe(0);
    expect(t.boundaryEdgeCount).toBe(0);
    expect(t.nonManifoldEdgeCount).toBe(0);
  });

  it('a tetrahedron has χ=2, genus=0', () => {
    // Equilateral tetrahedron — 4 vertices, 4 triangles.
    const a: [number, number, number] = [1, 1, 1];
    const b: [number, number, number] = [-1, -1, 1];
    const c: [number, number, number] = [-1, 1, -1];
    const d: [number, number, number] = [1, -1, -1];
    const tris = [
      ...a, ...b, ...c,
      ...a, ...d, ...b,
      ...a, ...c, ...d,
      ...b, ...d, ...c,
    ];
    const t = computeMeshTopology(geomFromTris(tris));
    expect(t.vertexCount).toBe(4);
    expect(t.faceCount).toBe(4);
    expect(t.edgeCount).toBe(6);
    expect(t.eulerChar).toBe(2);
    expect(t.genus).toBe(0);
    expect(t.manifoldClosed).toBe(true);
  });

  it('handles indexed BufferGeometry the same as non-indexed', () => {
    const indexed = new THREE.BoxGeometry(10, 10, 10); // indexed by default
    const nonIndexed = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    const tI = computeMeshTopology(indexed);
    const tN = computeMeshTopology(nonIndexed);
    expect(tI.vertexCount).toBe(tN.vertexCount);
    expect(tI.faceCount).toBe(tN.faceCount);
    expect(tI.edgeCount).toBe(tN.edgeCount);
    expect(tI.eulerChar).toBe(tN.eulerChar);
    expect(tI.genus).toBe(tN.genus);
  });
});

describe('computeMeshTopology — torus / genus ≥ 1', () => {
  /** Synthetic torus from three.js. THREE.TorusGeometry produces a closed
   *  watertight surface with genus = 1. */
  it('a torus has χ=0, genus=1', () => {
    const torus = new THREE.TorusGeometry(10, 3, 16, 32).toNonIndexed();
    const t = computeMeshTopology(torus);
    expect(t.manifoldClosed).toBe(true);
    expect(t.eulerChar).toBe(0);
    expect(t.genus).toBe(1);
  });

  it('two disjoint tori → componentCount=2, genus=null (multi-body undefined in v1)', () => {
    const torusA = new THREE.TorusGeometry(10, 3, 16, 32).toNonIndexed();
    const torusB = new THREE.TorusGeometry(5, 1, 16, 32).toNonIndexed();

    // Translate B so it's disjoint from A.
    const m = new THREE.Matrix4().makeTranslation(50, 0, 0);
    torusB.applyMatrix4(m);

    const merged = new THREE.BufferGeometry();
    const a = torusA.attributes.position.array as Float32Array;
    const b = torusB.attributes.position.array as Float32Array;
    const combined = new Float32Array(a.length + b.length);
    combined.set(a, 0);
    combined.set(b, a.length);
    merged.setAttribute('position', new THREE.Float32BufferAttribute(combined, 3));

    const t = computeMeshTopology(merged);
    expect(t.manifoldClosed).toBe(true);
    expect(t.componentCount).toBe(2);
    // χ is additive across components: 0 + 0 = 0 for two tori.
    expect(t.eulerChar).toBe(0);
    // Per-body genus is 1 each, but the single-body assumption fails
    // → helper returns null rather than reporting a nonsense number.
    expect(t.genus).toBeNull();
  });

  it('cube + cube (two disjoint) → componentCount=2, genus=null', () => {
    const a = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    const b = new THREE.BoxGeometry(5, 5, 5).toNonIndexed();
    b.applyMatrix4(new THREE.Matrix4().makeTranslation(50, 0, 0));

    const merged = new THREE.BufferGeometry();
    const pa = a.attributes.position.array as Float32Array;
    const pb = b.attributes.position.array as Float32Array;
    const combined = new Float32Array(pa.length + pb.length);
    combined.set(pa, 0);
    combined.set(pb, pa.length);
    merged.setAttribute('position', new THREE.Float32BufferAttribute(combined, 3));

    const t = computeMeshTopology(merged);
    expect(t.componentCount).toBe(2);
    expect(t.genus).toBeNull();
  });
});

describe('computeMeshTopology — non-manifold / open meshes', () => {
  it('a single triangle is not closed → genus=null', () => {
    const tris = [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ];
    const t = computeMeshTopology(geomFromTris(tris));
    expect(t.faceCount).toBe(1);
    expect(t.boundaryEdgeCount).toBe(3);
    expect(t.manifoldClosed).toBe(false);
    expect(t.genus).toBeNull();
  });

  it('a cube with one face removed → boundary edges, genus=null', () => {
    const cube = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    const posArr = cube.attributes.position.array as Float32Array;
    // Drop the last two triangles (one face).
    const trimmed = posArr.slice(0, posArr.length - 2 * 9);
    const open = new THREE.BufferGeometry();
    open.setAttribute('position', new THREE.Float32BufferAttribute(trimmed, 3));
    const t = computeMeshTopology(open);
    expect(t.faceCount).toBe(10);
    expect(t.boundaryEdgeCount).toBeGreaterThan(0);
    expect(t.manifoldClosed).toBe(false);
    expect(t.genus).toBeNull();
  });

  it('degenerate triangles (collinear vertices) are skipped, not crashed', () => {
    const tris = [
      0, 0, 0, 1, 0, 0, 2, 0, 0, // collinear, area = 0
    ];
    const t = computeMeshTopology(geomFromTris(tris));
    // Helper still computes V/E/F based on the triangles array — but
    // degenerate triangles should not flag as non-manifold either.
    expect(t.faceCount).toBe(1);
    // The degenerate triangle has 3 colinear distinct vertices, so 3
    // boundary edges still exist. Test verifies we don't crash and
    // genus stays null (open mesh).
    expect(t.genus).toBeNull();
  });

  it('empty geometry returns zeros + null genus', () => {
    const empty = new THREE.BufferGeometry();
    const t = computeMeshTopology(empty);
    expect(t.vertexCount).toBe(0);
    expect(t.faceCount).toBe(0);
    expect(t.genus).toBeNull();
  });
});

describe('vertex dedup tolerance', () => {
  it('vertices within tolerance are merged (microns from the same corner)', () => {
    // Two triangles sharing an edge where one endpoint is "0,0,0" and the
    // other is "0.0000001, 0, 0" — should dedup at default 1µm tolerance.
    const tris = [
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      0.0000001, 0, 0, 0, 1, 0, -1, 0, 0,
    ];
    const t = computeMeshTopology(geomFromTris(tris));
    // 4 unique vertices ideally (the near-duplicates merge into one).
    expect(t.vertexCount).toBe(4);
  });

  it('vertices outside tolerance stay separate', () => {
    // 10µm apart (= 0.01 mm) with default 1µm tolerance — should stay
    // distinct: quantize(0.01, 1e-3) = 10, quantize(0, 1e-3) = 0.
    const tris = [
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      0.01, 0, 0, 0, 1, 0, -1, 0, 0,
    ];
    const t = computeMeshTopology(geomFromTris(tris));
    expect(t.vertexCount).toBe(5);
  });
});

describe('countThroughHoles + compareHoleCount', () => {
  it('cube → 0 through-holes', () => {
    const cube = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    expect(countThroughHoles(cube)).toBe(0);
  });

  it('torus → 1 through-hole', () => {
    const torus = new THREE.TorusGeometry(10, 3, 16, 32).toNonIndexed();
    expect(countThroughHoles(torus)).toBe(1);
  });

  it('open mesh → null', () => {
    const open = geomFromTris([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(countThroughHoles(open)).toBeNull();
  });

  it('compareHoleCount returns null when detected matches expected', () => {
    expect(compareHoleCount(0, 0)).toBeNull();
    expect(compareHoleCount(3, 3)).toBeNull();
  });

  it('compareHoleCount returns null when detection is null (suppresses false flag)', () => {
    expect(compareHoleCount(2, null)).toBeNull();
  });

  it('compareHoleCount reports mismatch with delta', () => {
    expect(compareHoleCount(2, 1)).toEqual({ expected: 2, detected: 1, delta: -1 });
    expect(compareHoleCount(1, 3)).toEqual({ expected: 1, detected: 3, delta: 2 });
  });
});
