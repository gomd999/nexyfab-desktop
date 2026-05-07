import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merges multiple BufferGeometries into one.
 * Each geometry is converted to non-indexed before merging.
 */
export function mergeBodyGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geometries.length === 0) return new THREE.BufferGeometry();
  if (geometries.length === 1) return geometries[0].clone();

  const nonIndexed = geometries.map(g => g.toNonIndexed());
  const merged = mergeGeometries(nonIndexed, false);
  nonIndexed.forEach(g => g.dispose());
  merged.computeVertexNormals();
  return merged;
}
