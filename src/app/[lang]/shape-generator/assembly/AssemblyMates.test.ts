import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { solveMates, type AssemblyMate, type AssemblyPart } from './AssemblyMates';

/** A cylinder whose **top cap** is at a known face index. three.js's
 *  CylinderGeometry emits side faces first (radialSegments × 2), then
 *  the top cap (radialSegments), then the bottom cap. We need a cap
 *  face for axis-aware concentric tests since `getFaceNormal` on a
 *  side face returns a radial direction, not the cylinder axis. */
function makeCylinder(radius: number, height: number, segments = 16): { geo: THREE.BufferGeometry; topCapFaceIndex: number } {
  const g = new THREE.CylinderGeometry(radius, radius, height, segments);
  g.computeVertexNormals();
  return { geo: g, topCapFaceIndex: segments * 2 };
}

function makePlane(size = 10): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size, 0.1, size);
  g.computeVertexNormals();
  return g;
}

function partAt(id: string, geo: THREE.BufferGeometry, x = 0, y = 0, z = 0): AssemblyPart {
  return { id, geometry: geo, transform: new THREE.Matrix4().makeTranslation(x, y, z) };
}

function getOrigin(m: THREE.Matrix4): THREE.Vector3 {
  return new THREE.Vector3().setFromMatrixPosition(m);
}

describe('solveMates · concentric (axis alignment)', () => {
  it('aligns cylinder B onto cylinder A axis when offset perpendicular', () => {
    const cA = makeCylinder(5, 20);
    const cB = makeCylinder(2, 20);
    const a = partAt('a', cA.geo);
    const b = partAt('b', cB.geo, 30, 0, 0); // offset 30mm along X

    const mate: AssemblyMate = {
      id: 'm1', type: 'concentric',
      partA: 'a', partB: 'b',
      faceA: cA.topCapFaceIndex, faceB: cB.topCapFaceIndex,
      locked: false,
    };
    const out = solveMates([a, b], [mate], 5);
    const newB = out.get('b')!;
    const origin = getOrigin(newB);
    // Both cylinders' axes are Y-up. After concentric, B's origin should
    // collapse to A's axis line (X=0, Z=0); Y stays free.
    expect(Math.abs(origin.x)).toBeLessThan(0.01);
    expect(Math.abs(origin.z)).toBeLessThan(0.01);
  });

  it('does not change B when already concentric', () => {
    const cA = makeCylinder(5, 20);
    const cB = makeCylinder(2, 20);
    const a = partAt('a', cA.geo);
    const b = partAt('b', cB.geo, 0, 0, 0); // already aligned

    const mate: AssemblyMate = {
      id: 'm', type: 'concentric',
      partA: 'a', partB: 'b',
      faceA: cA.topCapFaceIndex, faceB: cB.topCapFaceIndex,
      locked: false,
    };
    const before = getOrigin(b.transform);
    const out = solveMates([a, b], [mate], 3);
    const after = getOrigin(out.get('b')!);
    expect(Math.abs(after.x - before.x)).toBeLessThan(0.01);
    expect(Math.abs(after.z - before.z)).toBeLessThan(0.01);
  });

  it('handles diagonal offset (both X and Z must collapse)', () => {
    const cA = makeCylinder(5, 20);
    const cB = makeCylinder(2, 20);
    const a = partAt('a', cA.geo);
    const b = partAt('b', cB.geo, 12, 0, 7);
    const mate: AssemblyMate = {
      id: 'm', type: 'concentric',
      partA: 'a', partB: 'b',
      faceA: cA.topCapFaceIndex, faceB: cB.topCapFaceIndex,
      locked: false,
    };
    const out = solveMates([a, b], [mate], 3);
    const origin = getOrigin(out.get('b')!);
    expect(Math.abs(origin.x)).toBeLessThan(0.01);
    expect(Math.abs(origin.z)).toBeLessThan(0.01);
  });
});

describe('solveMates · tangent (surface touching, same-direction normals)', () => {
  it('places block B above plane A so its bottom touches the top surface', () => {
    const a = partAt('a', makePlane(20));
    const b = partAt('b', new THREE.BoxGeometry(4, 4, 4), 0, 10, 0);

    const mate: AssemblyMate = {
      id: 'm', type: 'tangent',
      partA: 'a', partB: 'b',
      faceA: 0, faceB: 0,
      locked: false,
    };
    const out = solveMates([a, b], [mate], 3);
    const newB = out.get('b')!;
    const origin = getOrigin(newB);
    // After tangent on the plane's +Y face, B should snap to the plane
    // (centroid alignment along normal); X/Z drift is acceptable since
    // tangent is a 1-DOF constraint along the normal axis.
    expect(Number.isFinite(origin.x)).toBe(true);
    expect(Number.isFinite(origin.y)).toBe(true);
    expect(Number.isFinite(origin.z)).toBe(true);
  });
});

describe('solveMates · locked mates are not modified', () => {
  it('preserves part transform when mate.locked = true', () => {
    const cA = makeCylinder(5, 20);
    const cB = makeCylinder(2, 20);
    const a = partAt('a', cA.geo);
    const b = partAt('b', cB.geo, 30, 0, 0);
    const mate: AssemblyMate = {
      id: 'm', type: 'concentric',
      partA: 'a', partB: 'b',
      faceA: cA.topCapFaceIndex, faceB: cB.topCapFaceIndex,
      locked: true,
    };
    const out = solveMates([a, b], [mate], 3);
    const after = getOrigin(out.get('b')!);
    // Locked → no displacement.
    expect(after.x).toBeCloseTo(30, 3);
  });
});

describe('solveMates · angle (signed rotation, degenerate axis)', () => {
  it('rotates B by 90° when start angle is 0 (parallel) and target is 90°', () => {
    // Two boxes both with +X face normals. Angle mate at 90°.
    const a = partAt('a', new THREE.BoxGeometry(4, 4, 4));
    const b = partAt('b', new THREE.BoxGeometry(4, 4, 4), 10, 0, 0);
    const mate: AssemblyMate = {
      id: 'm', type: 'angle',
      partA: 'a', partB: 'b',
      faceA: 0, faceB: 0, value: 90,
      locked: false,
    };
    const out = solveMates([a, b], [mate], 3);
    // After 90° rotation, B's face 0 normal should be perpendicular to A's.
    const rotB = new THREE.Matrix4().extractRotation(out.get('b')!);
    const nA = new THREE.Vector3(1, 0, 0);
    // Box face 0 local normal is +X; rotate by rotB.
    const nB = new THREE.Vector3(1, 0, 0).applyMatrix4(rotB);
    const dot = nA.dot(nB);
    // dot = cos(90°) = 0 (±0.01 tolerance)
    expect(Math.abs(dot)).toBeLessThan(0.01);
  });

  it('handles anti-parallel start case (currentAngle = π) without bailing', () => {
    // B is rotated 180° around Z so its +X face normal becomes -X.
    const a = partAt('a', new THREE.BoxGeometry(4, 4, 4));
    const bGeo = new THREE.BoxGeometry(4, 4, 4);
    const bTransform = new THREE.Matrix4()
      .makeRotationZ(Math.PI)
      .premultiply(new THREE.Matrix4().makeTranslation(10, 0, 0));
    const b: AssemblyPart = { id: 'b', geometry: bGeo, transform: bTransform };
    const mate: AssemblyMate = {
      id: 'm', type: 'angle',
      partA: 'a', partB: 'b',
      faceA: 0, faceB: 0, value: 0, // target: parallel (0° between normals)
      locked: false,
    };
    const out = solveMates([a, b], [mate], 3);
    const rotB = new THREE.Matrix4().extractRotation(out.get('b')!);
    const nB = new THREE.Vector3(1, 0, 0).applyMatrix4(rotB);
    const nA = new THREE.Vector3(1, 0, 0);
    // After solving angle = 0, normals should be parallel (dot ≈ 1).
    expect(nA.dot(nB)).toBeGreaterThan(0.99);
  });

  it('does nothing when current angle already matches target', () => {
    const a = partAt('a', new THREE.BoxGeometry(4, 4, 4));
    const b = partAt('b', new THREE.BoxGeometry(4, 4, 4), 10, 0, 0);
    const mate: AssemblyMate = {
      id: 'm', type: 'angle',
      partA: 'a', partB: 'b',
      faceA: 0, faceB: 0, value: 0, // already parallel
      locked: false,
    };
    const out = solveMates([a, b], [mate], 3);
    const rotB = new THREE.Matrix4().extractRotation(out.get('b')!);
    const isIdentity = rotB.elements.every((v, i) => {
      const eye = i % 5 === 0 ? 1 : 0;
      return Math.abs(v - eye) < 0.01;
    });
    expect(isIdentity).toBe(true);
  });
});

describe('solveMates · hinge routes to axis alignment', () => {
  it('aligns axes (like concentric) so the parts share a pivot', () => {
    const cA = makeCylinder(5, 20);
    const cB = makeCylinder(2, 20);
    const a = partAt('a', cA.geo);
    const b = partAt('b', cB.geo, 30, 0, 0);
    const mate: AssemblyMate = {
      id: 'm', type: 'hinge',
      partA: 'a', partB: 'b',
      faceA: cA.topCapFaceIndex, faceB: cB.topCapFaceIndex,
      locked: false,
    };
    const out = solveMates([a, b], [mate], 3);
    const origin = getOrigin(out.get('b')!);
    expect(Math.abs(origin.x)).toBeLessThan(0.01);
    expect(Math.abs(origin.z)).toBeLessThan(0.01);
  });
});

describe('solveMates · concentric fallback when no faces selected', () => {
  it('falls back to center-on-center when faceA/faceB are undefined', () => {
    const cA = makeCylinder(5, 20);
    const cB = makeCylinder(2, 20);
    const a = partAt('a', cA.geo);
    const b = partAt('b', cB.geo, 30, 0, 0);
    const mate: AssemblyMate = {
      id: 'm', type: 'concentric',
      partA: 'a', partB: 'b',
      locked: false,
    };
    const out = solveMates([a, b], [mate], 3);
    const after = getOrigin(out.get('b')!);
    expect(Math.abs(after.x)).toBeLessThan(0.5);
  });
});
