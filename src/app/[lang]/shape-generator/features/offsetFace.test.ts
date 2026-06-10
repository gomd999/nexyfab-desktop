/**
 * offsetFace — mesh-path closed-form tests (no WASM).
 *
 * The mesh fallback translates every vertex on the selected planar face's
 * plane, so for a box the volume identity is exact:
 *     V' = V ± (face area × |distance|)
 * The OCCT prism path has its own closed-form suite in
 * __tests__/occtEngine.directEdit.test.ts (gated on RUN_OCCT_FEASIBILITY=1).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { offsetFaceFeature, applyOffsetFaceMesh } from './offsetFace';
import { FEATURE_MAP } from './index';

function meshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position;
  const idx = geo.index;
  let vol = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  for (let i = 0; i < triCount; i++) {
    a.fromBufferAttribute(pos, idx ? idx.getX(i * 3) : i * 3);
    b.fromBufferAttribute(pos, idx ? idx.getX(i * 3 + 1) : i * 3 + 1);
    c.fromBufferAttribute(pos, idx ? idx.getX(i * 3 + 2) : i * 3 + 2);
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(vol);
}

const TOP_SEL = { position: [0, 10, 0] as [number, number, number], normal: [0, 1, 0] as [number, number, number] };

describe('offsetFace — registration', () => {
  it('is registered with a single distance param (±, planar-only note in labelKey)', () => {
    const def = FEATURE_MAP.offsetFace;
    expect(def).toBeTruthy();
    expect(def.params).toHaveLength(1);
    expect(def.params[0]!.key).toBe('distance');
    expect(def.params[0]!.min).toBeLessThan(0); // inward offsets allowed
    expect(typeof def.applyAsync).toBe('function');
  });
});

describe('applyOffsetFaceMesh — closed-form volume identities on a box', () => {
  it('outward +5 on the top face of a 20³ box → V = 20×20×25', () => {
    const box = new THREE.BoxGeometry(20, 20, 20);
    expect(meshVolume(box)).toBeCloseTo(8000, 6);
    const out = applyOffsetFaceMesh(box, TOP_SEL, 5);
    expect(meshVolume(out)).toBeCloseTo(10000, 6);
    // Watertight: adjacent wall vertices followed (bbox confirms a clean stretch).
    out.computeBoundingBox();
    expect(out.boundingBox!.max.y).toBeCloseTo(15, 6);
    expect(out.boundingBox!.min.y).toBeCloseTo(-10, 6);
  });

  it('inward −5 on the top face → V = 20×20×15', () => {
    const box = new THREE.BoxGeometry(20, 20, 20);
    const out = applyOffsetFaceMesh(box, TOP_SEL, -5);
    expect(meshVolume(out)).toBeCloseTo(6000, 6);
  });

  it('offset along a side face (−X) also obeys area×d', () => {
    const box = new THREE.BoxGeometry(20, 20, 20);
    const out = applyOffsetFaceMesh(
      box,
      { position: [-10, 0, 0], normal: [-1, 0, 0] },
      3,
    );
    expect(meshVolume(out)).toBeCloseTo(8000 + 400 * 3, 6);
  });

  it('refuses an inward offset that would invert the body', () => {
    const box = new THREE.BoxGeometry(20, 20, 20);
    expect(() => applyOffsetFaceMesh(box, TOP_SEL, -25)).toThrow(/exceeds the body extent/);
  });

  it('refuses when the stored face is not on the current body', () => {
    const box = new THREE.BoxGeometry(20, 20, 20);
    expect(() => applyOffsetFaceMesh(box, { position: [0, 42, 0], normal: [0, 1, 0] }, 2))
      .toThrow(/not found/);
  });

  it('refuses curved faces (sphere has no matching planar face)', () => {
    const sphere = new THREE.SphereGeometry(10, 24, 16);
    expect(() => applyOffsetFaceMesh(sphere, { position: [0, 10, 0], normal: [0, 1, 0] }, 2))
      .toThrow(/not found/);
  });

  it('zero distance is an identity (clone)', () => {
    const box = new THREE.BoxGeometry(20, 20, 20);
    const out = applyOffsetFaceMesh(box, TOP_SEL, 0);
    expect(meshVolume(out)).toBeCloseTo(8000, 6);
  });
});

describe('offsetFaceFeature.apply — structured behaviour', () => {
  it('throws a structured error without a face selection', () => {
    const box = new THREE.BoxGeometry(20, 20, 20);
    expect(() => offsetFaceFeature.apply(box, { distance: 5 })).toThrow(/no face selected/i);
  });

  it('applies the mesh path through the feature ctx (faceSelections)', () => {
    const box = new THREE.BoxGeometry(20, 20, 20);
    const out = offsetFaceFeature.apply(box, { distance: 5 }, {
      featureId: 'f1',
      faceSelections: [{
        type: 'face',
        position: TOP_SEL.position,
        normal: TOP_SEL.normal,
        area: 400,
        triangleCount: 2,
        normalLabel: '+Y',
        triangleIndices: [],
      }],
    });
    expect(meshVolume(out)).toBeCloseTo(10000, 6);
  });

  it('applyAsync falls back to the mesh path when OCCT is not loaded', async () => {
    const box = new THREE.BoxGeometry(20, 20, 20);
    const out = await offsetFaceFeature.applyAsync!(box, { distance: -5 }, {
      featureId: 'f1',
      faceSelections: [{
        type: 'face',
        position: TOP_SEL.position,
        normal: TOP_SEL.normal,
        area: 400,
        triangleCount: 2,
        normalLabel: '+Y',
        triangleIndices: [],
      }],
    });
    expect(meshVolume(out)).toBeCloseTo(6000, 6);
  });
});
