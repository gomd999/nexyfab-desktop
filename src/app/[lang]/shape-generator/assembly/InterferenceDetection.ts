// ─── Interference Detection ──────────────────────────────────────────────────
import * as THREE from 'three';

export interface InterferenceResult {
  partA: string;
  partB: string;
  volume: number; // cm³ (estimated)
  boundingBox: THREE.Box3;
}

interface PartInput {
  id: string;
  geometry: THREE.BufferGeometry;
  transform: THREE.Matrix4;
}

// ─── Broad-phase: AABB overlap ──────────────────────────────────────────────

function getWorldBoundingBox(part: PartInput): THREE.Box3 {
  part.geometry.computeBoundingBox();
  const box = part.geometry.boundingBox!.clone();
  box.applyMatrix4(part.transform);
  return box;
}

// ─── Narrow-phase: triangle–triangle intersection ───────────────────────────

/** Get triangle vertices in world space */
function getTriangle(geometry: THREE.BufferGeometry, transform: THREE.Matrix4, triIndex: number): THREE.Triangle {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.index;

  let i0: number, i1: number, i2: number;
  if (index) {
    i0 = index.getX(triIndex * 3);
    i1 = index.getX(triIndex * 3 + 1);
    i2 = index.getX(triIndex * 3 + 2);
  } else {
    i0 = triIndex * 3;
    i1 = triIndex * 3 + 1;
    i2 = triIndex * 3 + 2;
  }

  const a = new THREE.Vector3().fromBufferAttribute(posAttr, i0).applyMatrix4(transform);
  const b = new THREE.Vector3().fromBufferAttribute(posAttr, i1).applyMatrix4(transform);
  const c = new THREE.Vector3().fromBufferAttribute(posAttr, i2).applyMatrix4(transform);

  return new THREE.Triangle(a, b, c);
}

function getTriangleCount(geometry: THREE.BufferGeometry): number {
  if (geometry.index) return Math.floor(geometry.index.count / 3);
  const pos = geometry.getAttribute('position');
  return pos ? Math.floor(pos.count / 3) : 0;
}

/** Separating Axis Theorem for triangle–triangle intersection test */
function trianglesIntersect(t1: THREE.Triangle, t2: THREE.Triangle): boolean {
  // Quick AABB pre-check for each triangle
  const box1 = new THREE.Box3().setFromPoints([t1.a, t1.b, t1.c]);
  const box2 = new THREE.Box3().setFromPoints([t2.a, t2.b, t2.c]);
  if (!box1.intersectsBox(box2)) return false;

  // Moller–Trumbore-style SAT test using edge cross products + face normals
  const edges1 = [
    new THREE.Vector3().subVectors(t1.b, t1.a),
    new THREE.Vector3().subVectors(t1.c, t1.b),
    new THREE.Vector3().subVectors(t1.a, t1.c),
  ];
  const edges2 = [
    new THREE.Vector3().subVectors(t2.b, t2.a),
    new THREE.Vector3().subVectors(t2.c, t2.b),
    new THREE.Vector3().subVectors(t2.a, t2.c),
  ];

  const n1 = new THREE.Vector3().crossVectors(edges1[0], edges1[1]);
  const n2 = new THREE.Vector3().crossVectors(edges2[0], edges2[1]);

  const axes: THREE.Vector3[] = [n1, n2];
  for (const e1 of edges1) {
    for (const e2 of edges2) {
      const cross = new THREE.Vector3().crossVectors(e1, e2);
      if (cross.lengthSq() > 1e-10) axes.push(cross);
    }
  }

  const verts1 = [t1.a, t1.b, t1.c];
  const verts2 = [t2.a, t2.b, t2.c];

  for (const axis of axes) {
    if (axis.lengthSq() < 1e-10) continue;

    let min1 = Infinity, max1 = -Infinity;
    let min2 = Infinity, max2 = -Infinity;

    for (const v of verts1) {
      const d = v.dot(axis);
      if (d < min1) min1 = d;
      if (d > max1) max1 = d;
    }
    for (const v of verts2) {
      const d = v.dot(axis);
      if (d < min2) min2 = d;
      if (d > max2) max2 = d;
    }

    if (max1 < min2 || max2 < min1) return false; // separating axis found
  }

  return true; // no separating axis → intersection
}

// ─── Main Detection ─────────────────────────────────────────────────────────

/**
 * Detect interference between all pairs of parts.
 * Broad phase: bounding box overlap.
 * Narrow phase: triangle-level intersection (capped to limit performance).
 * Returns list of interfering pairs with estimated overlap volume.
 */
export function detectInterference(
  parts: PartInput[],
  maxTriPairsPerCheck: number = 50000,
): InterferenceResult[] {
  const results: InterferenceResult[] = [];

  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const boxA = getWorldBoundingBox(parts[i]);
      const boxB = getWorldBoundingBox(parts[j]);

      // Broad phase
      if (!boxA.intersectsBox(boxB)) continue;

      // Compute overlap bounding box
      const overlapBox = boxA.clone().intersect(boxB);
      if (overlapBox.isEmpty()) continue;

      // Narrow phase: sample triangle intersections
      const triCountA = getTriangleCount(parts[i].geometry);
      const triCountB = getTriangleCount(parts[j].geometry);

      let intersectionFound = false;
      let checked = 0;

      // Limit checks for performance
      const stepA = Math.max(1, Math.floor(triCountA / Math.sqrt(maxTriPairsPerCheck)));
      const stepB = Math.max(1, Math.floor(triCountB / Math.sqrt(maxTriPairsPerCheck)));

      for (let a = 0; a < triCountA && !intersectionFound; a += stepA) {
        const triA = getTriangle(parts[i].geometry, parts[i].transform, a);
        // Quick skip: triangle outside overlap region
        const triABox = new THREE.Box3().setFromPoints([triA.a, triA.b, triA.c]);
        if (!triABox.intersectsBox(overlapBox)) continue;

        for (let b = 0; b < triCountB && !intersectionFound; b += stepB) {
          checked++;
          if (checked > maxTriPairsPerCheck) {
            // Exceeded budget; assume overlapping boxes that pass broad phase are interfering
            intersectionFound = true;
            break;
          }

          const triB = getTriangle(parts[j].geometry, parts[j].transform, b);
          const triBBox = new THREE.Box3().setFromPoints([triB.a, triB.b, triB.c]);
          if (!triBBox.intersectsBox(overlapBox)) continue;

          if (trianglesIntersect(triA, triB)) {
            intersectionFound = true;
          }
        }
      }

      if (intersectionFound) {
        // Estimate volume as overlap bounding box volume (rough approximation)
        const overlapSize = overlapBox.getSize(new THREE.Vector3());
        const volumeMM3 = overlapSize.x * overlapSize.y * overlapSize.z;
        const volumeCM3 = volumeMM3 / 1000; // mm³ → cm³

        results.push({
          partA: parts[i].id,
          partB: parts[j].id,
          volume: volumeCM3,
          boundingBox: overlapBox,
        });
      }
    }
  }

  return results;
}
