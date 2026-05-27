/**
 * culling.ts — Frustum + bbox-cluster culling for large assemblies.
 *
 * **Frustum culling** skips parts outside the camera's view volume.
 * Trivial wins on first-person / orbit cameras where most of the
 * assembly is off-screen.
 *
 * **Cluster culling** is a cheap occlusion approximation — when one
 * part's bbox is entirely behind another opaque part's bbox along
 * the camera-direction axis, the back one is skipped. Real GPU-level
 * occlusion (depth pyramid, hardware occlusion queries) is too
 * heavyweight for a web client; this AABB approximation captures the
 * "big enclosure in front of small interior parts" case which is the
 * 90% win for product CAD assemblies.
 *
 * Out of scope: portal culling, anti-portal, BSP-style precomputed
 * visibility — all CAD-irrelevant.
 */

import type { Aabb } from './octree';

/** Six-plane frustum. Each plane is `{nx, ny, nz, d}` with the half-
 *  space `nx·x + ny·y + nz·z + d ≥ 0` being "inside". */
export interface FrustumPlane {
  nx: number; ny: number; nz: number; d: number;
}
export type Frustum = [FrustumPlane, FrustumPlane, FrustumPlane, FrustumPlane, FrustumPlane, FrustumPlane];

/** Test whether an AABB intersects (or is contained in) the frustum.
 *  Returns false only if every corner of the box is on the negative
 *  side of at least one plane. */
export function frustumOverlapsAabb(frustum: Frustum, aabb: Aabb): boolean {
  for (const plane of frustum) {
    // Pick the "farthest corner along the plane normal".
    const px = plane.nx >= 0 ? aabb.max[0] : aabb.min[0];
    const py = plane.ny >= 0 ? aabb.max[1] : aabb.min[1];
    const pz = plane.nz >= 0 ? aabb.max[2] : aabb.min[2];
    const dist = plane.nx * px + plane.ny * py + plane.nz * pz + plane.d;
    if (dist < 0) return false; // entirely outside this plane
  }
  return true;
}

/** Build a frustum from a view × projection matrix (row-major,
 *  16-element flat array — same shape as THREE.Matrix4.elements but
 *  in row-major order). Standard Gribb-Hartmann plane extraction. */
export function frustumFromMatrix(m: number[]): Frustum {
  // m is column-major (THREE.js convention). Access pattern:
  //   m[col*4 + row]
  // We use the same letters as Gribb/Hartmann 2001 for clarity.
  const m00 = m[0],  m10 = m[1],  m20 = m[2],  m30 = m[3];
  const m01 = m[4],  m11 = m[5],  m21 = m[6],  m31 = m[7];
  const m02 = m[8],  m12 = m[9],  m22 = m[10], m32 = m[11];
  const m03 = m[12], m13 = m[13], m23 = m[14], m33 = m[15];

  const planes: FrustumPlane[] = [
    // left:   row 4 + row 1
    { nx: m30 + m00, ny: m31 + m01, nz: m32 + m02, d: m33 + m03 },
    // right:  row 4 - row 1
    { nx: m30 - m00, ny: m31 - m01, nz: m32 - m02, d: m33 - m03 },
    // bottom: row 4 + row 2
    { nx: m30 + m10, ny: m31 + m11, nz: m32 + m12, d: m33 + m13 },
    // top:    row 4 - row 2
    { nx: m30 - m10, ny: m31 - m11, nz: m32 - m12, d: m33 - m13 },
    // near:   row 4 + row 3
    { nx: m30 + m20, ny: m31 + m21, nz: m32 + m22, d: m33 + m23 },
    // far:    row 4 - row 3
    { nx: m30 - m20, ny: m31 - m21, nz: m32 - m22, d: m33 - m23 },
  ];

  // Normalise so the plane equation is unit-length (lets us measure
  // distances in world units later if we want).
  for (const p of planes) {
    const len = Math.hypot(p.nx, p.ny, p.nz);
    if (len > 0) {
      p.nx /= len; p.ny /= len; p.nz /= len; p.d /= len;
    }
  }
  return planes as Frustum;
}

/** Cluster-occlusion approximation: AABB B is hidden behind A from
 *  the camera at `eye` looking in direction `dir` when B's near face
 *  is behind A's far face AND B's silhouette fits inside A's
 *  silhouette as projected on the camera plane. */
export function aabbBehindOccluder(
  eye: [number, number, number],
  dir: [number, number, number],
  occluder: Aabb,
  candidate: Aabb,
): boolean {
  // Depth along view direction — pick the AABB faces that project
  // farthest along ±dir.
  const projectMin = (a: Aabb) => {
    let m = Infinity;
    for (const x of [a.min[0], a.max[0]]) {
      for (const y of [a.min[1], a.max[1]]) {
        for (const z of [a.min[2], a.max[2]]) {
          const d = (x - eye[0]) * dir[0] + (y - eye[1]) * dir[1] + (z - eye[2]) * dir[2];
          if (d < m) m = d;
        }
      }
    }
    return m;
  };
  const projectMax = (a: Aabb) => {
    let M = -Infinity;
    for (const x of [a.min[0], a.max[0]]) {
      for (const y of [a.min[1], a.max[1]]) {
        for (const z of [a.min[2], a.max[2]]) {
          const d = (x - eye[0]) * dir[0] + (y - eye[1]) * dir[1] + (z - eye[2]) * dir[2];
          if (d > M) M = d;
        }
      }
    }
    return M;
  };
  // Candidate must start BEHIND the occluder's far face.
  if (projectMin(candidate) < projectMax(occluder)) return false;

  // Silhouette containment — cheap version: candidate's AABB must lie
  // within occluder's AABB on the two axes most orthogonal to dir.
  // Pick the largest two non-dir components.
  const absDir: [number, number, number] = [Math.abs(dir[0]), Math.abs(dir[1]), Math.abs(dir[2])];
  const dirAxis = absDir.indexOf(Math.max(...absDir));
  const others = [0, 1, 2].filter(i => i !== dirAxis);
  for (const ax of others) {
    if (candidate.min[ax] < occluder.min[ax] || candidate.max[ax] > occluder.max[ax]) return false;
  }
  return true;
}
