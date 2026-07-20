import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyCut, cutFeature } from './cut';

function makePlate(w = 100, t = 2.0, d = 50): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, t, d);
  g.computeBoundingBox();
  return g;
}

/** Signed mesh volume via the divergence theorem (handles the non-indexed
 *  triangle soup three-bvh-csg produces). */
function meshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let vol = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(vol);
}

describe('Cut feature (sheet-metal through-slot)', () => {
  it('removes ≈ width×thickness×length of material for an interior cut', () => {
    const plate = makePlate(100, 2, 50);
    const v0 = meshVolume(plate);
    const out = applyCut(plate, { width: 20, length: 10, posX: 0, posZ: 0 });
    const v1 = meshVolume(out);
    const removed = v0 - v1;
    // 20 (X) × 2 (thickness Y) × 10 (Z) = 400 mm³.
    expect(removed).toBeGreaterThan(360);
    expect(removed).toBeLessThan(440);
  });

  it('larger cut removes more material (monotonic)', () => {
    const v0 = meshVolume(makePlate(100, 2, 50));
    const small = v0 - meshVolume(applyCut(makePlate(100, 2, 50), { width: 10, length: 10, posX: 0, posZ: 0 }));
    const big = v0 - meshVolume(applyCut(makePlate(100, 2, 50), { width: 40, length: 10, posX: 0, posZ: 0 }));
    expect(big).toBeGreaterThan(small);
  });

  it('is registered with type "cut" and tunable params (W5-D adds end condition)', () => {
    expect(cutFeature.type).toBe('cut');
    const keys = cutFeature.params.map(p => p.key).sort();
    expect(keys).toEqual(['depth', 'endCondition', 'length', 'posX', 'posZ', 'width']);
    // Default end condition stays through_all — legacy behavior preserved.
    expect(cutFeature.params.find(p => p.key === 'endCondition')!.default).toBe(1);
  });

  it('feature.apply path produces a valid non-empty geometry', () => {
    const out = cutFeature.apply(makePlate(80, 1.5, 80), { width: 15, length: 15, posX: 10, posZ: -10 }, undefined);
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });
});
