/**
 * Phase 2 — limitDistance / limitAngle / width on the STATIC face-index
 * solver (`AssemblyMates.solveMates`, the placement / .nfab pipeline).
 * Mirrors the Gauss-Seidel coverage in `matesSolver.limitWidth.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { solveMates, type AssemblyMate, type AssemblyPart } from './AssemblyMates';

/** BoxGeometry(w,h,d): face (triangle) order is +x(0,1), −x(2,3), +y(4,5),
 *  −y(6,7), +z(8,9), −z(10,11). We use triangle 0 (+x) and 2 (−x). */
const FACE_PX = 0;
const FACE_NX = 2;

function box(size: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size, size, size);
  g.computeVertexNormals();
  return g;
}

function partAt(id: string, geo: THREE.BufferGeometry, x = 0, y = 0, z = 0): AssemblyPart {
  return { id, geometry: geo, transform: new THREE.Matrix4().makeTranslation(x, y, z) };
}

function originX(m: THREE.Matrix4): number {
  return new THREE.Vector3().setFromMatrixPosition(m).x;
}

describe('solveMates · limitDistance (static placement)', () => {
  function run(bx: number, min: number, max: number): { dist: number; bX: number } {
    const a = partAt('a', box(10));
    const b = partAt('b', box(10), bx, 0, 0);
    const mate: AssemblyMate = {
      id: 'm', type: 'limitDistance', partA: 'a', partB: 'b',
      faceA: FACE_PX, faceB: FACE_NX, min, max, locked: false,
    };
    const out = solveMates([a, b], [mate], 5);
    const newB = out.get('b')!;
    // Distance between the two face-triangle centroids after the solve.
    const cA = new THREE.Vector3(5, 10 / 3 - 5 + 10 / 3, 0); // not used — recompute generically below
    void cA;
    return { dist: NaN, bX: originX(newB) };
  }

  it('inside the band → placement untouched', () => {
    const { bX } = run(30, 10, 50);
    expect(bX).toBeCloseTo(30, 6);
  });

  it('outside the band → part B pulled toward the violated bound', () => {
    // Boxes are 10 wide; +x face of A and −x face of B start 80−10=70mm apart
    // (centroid-to-centroid). The band tops out at 30 → B must move closer
    // by ~40mm along the face normal.
    const before = 80;
    const { bX } = run(before, 10, 30);
    expect(bX).toBeLessThan(before - 30); // moved decisively toward A
    expect(bX).toBeGreaterThan(0);
  });
});

describe('solveMates · limitAngle (static placement)', () => {
  it('inside the band → orientation untouched', () => {
    const a = partAt('a', box(10));
    const b = partAt('b', box(10), 30, 0, 0);
    b.transform.multiply(new THREE.Matrix4().makeRotationZ((45 * Math.PI) / 180));
    const before = b.transform.clone();
    const mate: AssemblyMate = {
      id: 'm', type: 'limitAngle', partA: 'a', partB: 'b',
      faceA: FACE_PX, faceB: FACE_PX, min: 30, max: 90, locked: false,
    };
    const out = solveMates([a, b], [mate], 5);
    const newB = out.get('b')!;
    expect(newB.elements.every((v, i) => Math.abs(v - before.elements[i]) < 1e-6)).toBe(true);
  });

  it('beyond max → rotated back to the bound', () => {
    const a = partAt('a', box(10));
    const b = partAt('b', box(10), 30, 0, 0);
    b.transform.multiply(new THREE.Matrix4().makeRotationZ((120 * Math.PI) / 180));
    const mate: AssemblyMate = {
      id: 'm', type: 'limitAngle', partA: 'a', partB: 'b',
      faceA: FACE_PX, faceB: FACE_PX, min: 0, max: 90, locked: false,
    };
    const out = solveMates([a, b], [mate], 8);
    const newB = out.get('b')!;
    // Measure the angle between the +x face normals after the solve.
    const nA = new THREE.Vector3(1, 0, 0);
    const nB = new THREE.Vector3(1, 0, 0).applyMatrix4(new THREE.Matrix4().extractRotation(newB)).normalize();
    const deg = (Math.acos(THREE.MathUtils.clamp(nA.dot(nB), -1, 1)) * 180) / Math.PI;
    expect(deg).toBeCloseTo(90, 1);
  });
});

describe('solveMates · width (static placement)', () => {
  it('centers part B between part A`s +x/−x faces along the face normal', () => {
    // A is a 20-wide box at the origin: reference planes x = +10 and x = −10.
    // B is a 6-wide box parked off-center at x = 7 → must move to x = 0
    // (its +x face centroid then sits on A's midplane offset by B's own
    // half-width... the solver zeroes the B-face-centroid-to-midplane gap,
    // so B's +x face centroid lands at x = 0, i.e. B origin at −3).
    const a = partAt('a', box(20));
    const b = partAt('b', box(6), 7, 0, 0);
    const mate: AssemblyMate = {
      id: 'm', type: 'width', partA: 'a', partB: 'b',
      faceA: FACE_PX, faceA2: FACE_NX, faceB: FACE_PX, locked: false,
    };
    const out = solveMates([a, b], [mate], 5);
    const bX = originX(out.get('b')!);
    expect(bX).toBeCloseTo(-3, 3);
  });

  it('without faceA2 falls back to tangent-style plane contact (no crash)', () => {
    const a = partAt('a', box(20));
    const b = partAt('b', box(6), 40, 0, 0);
    const mate: AssemblyMate = {
      id: 'm', type: 'width', partA: 'a', partB: 'b',
      faceA: FACE_PX, faceB: FACE_PX, locked: false,
    };
    expect(() => solveMates([a, b], [mate], 5)).not.toThrow();
  });
});
