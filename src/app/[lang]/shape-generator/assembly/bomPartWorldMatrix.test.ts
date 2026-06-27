/** bomPartWorldMatrixFromBom — BOM placement → world Matrix4. Coverage-gap closure. */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { bomPartWorldMatrixFromBom } from './bomPartWorldMatrix';
describe('bomPartWorldMatrixFromBom', () => {
  it('encodes the part position as the matrix translation', () => {
     
    const m = bomPartWorldMatrixFromBom({ name: 'p', result: { geometry: new THREE.BoxGeometry(1, 1, 1) }, position: [10, -4, 7] } as any);
    const t = new THREE.Vector3().setFromMatrixPosition(m);
    expect(t.x).toBeCloseTo(10); expect(t.y).toBeCloseTo(-4); expect(t.z).toBeCloseTo(7);
  });
  it('defaults to identity translation with no position', () => {
     
    const m = bomPartWorldMatrixFromBom({ name: 'p', result: { geometry: new THREE.BoxGeometry(1, 1, 1) } } as any);
    const t = new THREE.Vector3().setFromMatrixPosition(m);
    expect(t.length()).toBeCloseTo(0);
  });
});
