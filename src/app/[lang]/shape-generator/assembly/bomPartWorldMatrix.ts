import * as THREE from 'three';
import type { BomPartResult } from '../ShapePreview';

/**
 * World matrix for a `BomPartResult` row, matching the assembly interference path.
 *
 * **M3:** `rotation` is **degrees** (× π/180), matching `ShapeMesh` and
 * `placedPartsToBomResults` (library placement). Chat/cart BOM rows use the same convention.
 */
export function bomPartWorldMatrixFromBom(p: BomPartResult): THREE.Matrix4 {
  const mat = new THREE.Matrix4();
  if (p.rotation) {
    const rot = p.rotation.map(d => (d * Math.PI) / 180) as [number, number, number];
    mat.makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  }
  if (p.position) {
    const tr = new THREE.Matrix4().makeTranslation(...p.position);
    mat.premultiply(tr);
  }
  return mat;
}
