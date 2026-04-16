// ─── Exploded View ───────────────────────────────────────────────────────────
import * as THREE from 'three';

interface PartInput {
  id: string;
  geometry: THREE.BufferGeometry;
  transform: THREE.Matrix4;
}

/**
 * Compute exploded positions for each part.
 * Each part is moved away from the assembly center proportional to
 * its current distance from the center * explosionFactor.
 *
 * @param parts        Array of parts with geometry and transform
 * @param explosionFactor  0 = assembled, 1 = fully exploded (parts at 2x their original distance)
 * @param center       Optional custom explosion center; defaults to assembly centroid
 * @returns Map of part id -> offset vector to apply
 */
export function computeExplodedPositions(
  parts: PartInput[],
  explosionFactor: number,
  center?: THREE.Vector3,
): Map<string, THREE.Vector3> {
  const offsets = new Map<string, THREE.Vector3>();

  if (parts.length === 0 || explosionFactor <= 0) {
    for (const p of parts) {
      offsets.set(p.id, new THREE.Vector3(0, 0, 0));
    }
    return offsets;
  }

  // Compute centers of each part in world space
  const partCenters = new Map<string, THREE.Vector3>();
  const assemblyCenter = center?.clone() ?? new THREE.Vector3();

  if (!center) {
    // Compute assembly centroid from all part centers
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      const bb1 = part.geometry.boundingBox;
      if (!bb1) continue;
      const c = new THREE.Vector3();
      bb1.getCenter(c);
      c.applyMatrix4(part.transform);
      partCenters.set(part.id, c);
      assemblyCenter.add(c);
    }
    if (parts.length > 0) assemblyCenter.divideScalar(parts.length);
  } else {
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      const bb2 = part.geometry.boundingBox;
      if (!bb2) continue;
      const c = new THREE.Vector3();
      bb2.getCenter(c);
      c.applyMatrix4(part.transform);
      partCenters.set(part.id, c);
    }
  }

  // Compute the maximum extent for normalization
  let maxDist = 0;
  for (const [, c] of partCenters) {
    const d = c.distanceTo(assemblyCenter);
    if (d > maxDist) maxDist = d;
  }
  // Prevent division by zero; use a sensible minimum
  if (maxDist < 0.1) maxDist = 1;

  // Scale factor: at factor=1, parts move an additional 100% of the max extent
  const scaleMult = explosionFactor * maxDist * 1.5;

  for (const part of parts) {
    const c = partCenters.get(part.id)!;
    const dir = new THREE.Vector3().subVectors(c, assemblyCenter);
    const dist = dir.length();

    if (dist < 0.001) {
      // Part is at center: push outward in a deterministic direction based on index
      const idx = parts.indexOf(part);
      const angle = (idx / parts.length) * Math.PI * 2;
      dir.set(Math.cos(angle), 0, Math.sin(angle));
      offsets.set(part.id, dir.multiplyScalar(scaleMult * 0.5));
    } else {
      dir.normalize();
      offsets.set(part.id, dir.multiplyScalar((dist / maxDist) * scaleMult));
    }
  }

  return offsets;
}
