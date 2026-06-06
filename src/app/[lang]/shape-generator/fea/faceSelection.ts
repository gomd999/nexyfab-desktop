/**
 * faceSelection.ts — resolve an ARBITRARY planar face of an FEA surface mesh to
 * its triangle indices, so a boundary condition (fixed / load) can be applied to
 * any flat face, not just the six axis-aligned bounding-box faces that
 * modalSolver's namedFacesToIndices handles.
 *
 * A face is given as a plane (a point on it + outward normal). A surface triangle
 * belongs to the face when its centroid lies on that plane (within tolerance) AND
 * its own normal points the same way — so the opposite, parallel face of a slab
 * is not picked up. This is the FEA-side use of the same signed-normal + plane
 * test the drawing/topology layers use, letting a face-based load survive a
 * rebuild when the caller re-derives the plane from the current solid.
 */

import * as THREE from 'three';

export interface FacePlane {
  /** A point on the face plane (e.g. the picked face's centroid), mm. */
  point: [number, number, number];
  /** Outward face normal (need not be unit). */
  normal: [number, number, number];
}

export interface FaceSelectOptions {
  /** Max distance of a triangle centroid from the plane to count as on it.
   *  Defaults to max(1e-4, 1e-3 · mesh span). */
  planeTolMm?: number;
  /** Min normal·normal (both unit) for a triangle to be considered same-facing. */
  minNormalAlignment?: number;
}

function unit(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Triangle indices (into the NON-indexed surface triangle list — triangle t owns
 * vertices 3t, 3t+1, 3t+2) whose centroid lies on `face`'s plane and whose normal
 * aligns with the face normal.
 */
export function selectCoplanarTriangles(
  geometry: THREE.BufferGeometry,
  face: FacePlane,
  opts: FaceSelectOptions = {},
): number[] {
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = src.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) return [];
  const triCount = Math.floor(pos.count / 3);
  if (triCount === 0) return [];

  // Mesh span for a scale-relative default tolerance.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.count; i++) {
    const c = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    for (let d = 0; d < 3; d++) { if (c[d]! < lo[d]!) lo[d] = c[d]!; if (c[d]! > hi[d]!) hi[d] = c[d]!; }
  }
  const span = Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
  const tol = opts.planeTolMm ?? Math.max(1e-4, 1e-3 * span);
  const minAlign = opts.minNormalAlignment ?? 0.9;

  const n = unit(face.normal);
  // Plane offset d so that a point p is on the plane when p·n ≈ d.
  const planeD = face.point[0] * n[0] + face.point[1] * n[1] + face.point[2] * n[2];

  const out: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), fn = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    // Triangle face normal.
    ab.subVectors(b, a); ac.subVectors(c, a); fn.crossVectors(ab, ac);
    const fl = fn.length();
    if (fl < 1e-12) continue; // degenerate triangle
    fn.divideScalar(fl);
    if (fn.x * n[0] + fn.y * n[1] + fn.z * n[2] < minAlign) continue; // not same-facing
    // Centroid distance to the plane.
    const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3;
    if (Math.abs(cx * n[0] + cy * n[1] + cz * n[2] - planeD) <= tol) out.push(t);
  }
  return out;
}
