/**
 * applyPushPull.ts — Wave 2 Phase 3 Track E1.
 *
 * Mesh-level push-pull implementation. Takes a `BufferGeometry` and a
 * `pushPull` op, returns a NEW geometry with the picked face's
 * vertices translated along the face normal.
 *
 * Strategy:
 *   1. Resolve the picked face via `getFaceFeatureId` from
 *      `faceProvenance.ts`. We collect every triangle whose first-
 *      vertex feature id matches `op.faceId`.
 *   2. Compute the averaged face normal from the collected triangles
 *      (numerically stable — area-weighted via the cross product).
 *   3. Verify the face is approximately planar. Non-planar faces fall
 *      back to "no-op + console warning"; production push-pull on
 *      cylindrical / NURBS faces needs B-Rep, scheduled for Phase 4.
 *   4. Find the set of unique vertices touched by the face triangles
 *      and translate each by `offsetMm * normal`.
 *   5. Recompute normals on the output. Side-face vertices that share
 *      an index with face vertices follow automatically — that's the
 *      "re-stitch" that the mesh approximation gives us for free
 *      when the mesh is indexed; for non-indexed (BVH-CSG output)
 *      we skip stitching and the connected triangles are translated
 *      too iff they share the same `lastFeatureId`.
 *
 * Performance budget (ADR-012 §8): p95 ≤ 30ms per drag-end apply.
 * Live-drag preview is a separate translucent overlay that doesn't
 * touch the underlying geometry — see `DirectEditOverlay`.
 *
 * Phase 4: B-Rep push-pull via worker — see `TODO: B-Rep push-pull
 * via worker — Phase 4` below.
 */

import * as THREE from 'three';
import {
  getFaceFeatureId,
  FACE_FEATURE_ID_ATTR,
} from '../features/faceProvenance';
import type { DirectEditOp } from './directEditTypes';

/** Maximum acceptable deviation (radians) between any triangle normal
 *  on the face and the face's averaged normal before we declare the
 *  face "non-planar" and refuse the op. */
const PLANARITY_THRESHOLD_RAD = 0.05; // ~2.86 degrees

/** Context passed to `applyPushPull` by the overlay. */
export interface ApplyContext {
  /** Optional console-warn target (overridable for tests). */
  warn?: (msg: string) => void;
}

export interface ApplyPushPullResult {
  /** New geometry. Identical-by-reference to the input only when the
   *  op was rejected (non-planar / no-matching-face / degenerate). */
  geometry: THREE.BufferGeometry;
  /** Whether the op mutated the mesh. False on rejection. */
  applied: boolean;
  /** Number of vertices that moved (0 when applied=false). */
  movedVertexCount: number;
  /** Wall-clock duration in ms. Used by the perf-budget test. */
  elapsedMs: number;
}

/**
 * Apply a `pushPull` op to `geometry`. Returns a new geometry on
 * success; returns the input geometry unchanged on rejection (with a
 * console warn) so the overlay can degrade gracefully.
 *
 * Does NOT mutate `geometry`. Position attribute is cloned.
 */
export function applyPushPull(
  geometry: THREE.BufferGeometry,
  op: Extract<DirectEditOp, { kind: 'pushPull' }>,
  ctx: ApplyContext = {},
): ApplyPushPullResult {
  const t0 = performance.now();
  const warn = ctx.warn ?? ((m: string) => console.warn(`[directEdit] ${m}`));

  const posAttr = geometry.getAttribute('position') as
    | THREE.BufferAttribute
    | undefined;
  if (!posAttr) {
    warn('applyPushPull: geometry has no position attribute — no-op');
    return {
      geometry,
      applied: false,
      movedVertexCount: 0,
      elapsedMs: performance.now() - t0,
    };
  }

  // ─── Step 1: collect the face's triangle set ────────────────────────────
  // Walk each triangle, read its feature id via the provenance reader,
  // and accumulate the vertex indices that belong to op.faceId.
  const indexAttr = geometry.index;
  const triangleCount = indexAttr
    ? indexAttr.count / 3
    : posAttr.count / 3;

  const matchedTriangles: number[] = [];
  for (let t = 0; t < triangleCount; t++) {
    const featureId = getFaceFeatureId(geometry, t);
    if (featureId === op.faceId) matchedTriangles.push(t);
  }

  if (matchedTriangles.length === 0) {
    warn(`applyPushPull: no triangles match faceId=${op.faceId} — no-op`);
    return {
      geometry,
      applied: false,
      movedVertexCount: 0,
      elapsedMs: performance.now() - t0,
    };
  }

  // ─── Step 2: compute averaged face normal + collect unique verts ────────
  const positions = posAttr.array as Float32Array;
  let nx = 0, ny = 0, nz = 0;
  const triangleNormals: Array<[number, number, number]> = [];
  const uniqueVerts = new Set<number>();

  for (const t of matchedTriangles) {
    const ia = indexAttr ? indexAttr.getX(t * 3) : t * 3;
    const ib = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
    const ic = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
    uniqueVerts.add(ia);
    uniqueVerts.add(ib);
    uniqueVerts.add(ic);
    const ax = positions[ia * 3]!, ay = positions[ia * 3 + 1]!, az = positions[ia * 3 + 2]!;
    const bx = positions[ib * 3]!, by = positions[ib * 3 + 1]!, bz = positions[ib * 3 + 2]!;
    const cx = positions[ic * 3]!, cy = positions[ic * 3 + 1]!, cz = positions[ic * 3 + 2]!;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    // Cross product (area-weighted normal).
    const crx = uy * vz - uz * vy;
    const cry = uz * vx - ux * vz;
    const crz = ux * vy - uy * vx;
    nx += crx;
    ny += cry;
    nz += crz;
    const triLen = Math.hypot(crx, cry, crz) || 1;
    triangleNormals.push([crx / triLen, cry / triLen, crz / triLen]);
  }

  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < 1e-9) {
    warn('applyPushPull: degenerate face normal (zero-area face) — no-op');
    return {
      geometry,
      applied: false,
      movedVertexCount: 0,
      elapsedMs: performance.now() - t0,
    };
  }
  const unitNormal: [number, number, number] = [nx / nLen, ny / nLen, nz / nLen];

  // ─── Step 3: planarity check ────────────────────────────────────────────
  // TODO: B-Rep push-pull via worker — Phase 4. Mesh-level push-pull
  // on cylindrical/NURBS faces (whose triangles have variable normals)
  // is not safe — we'd shear the surface. The B-Rep solver in OCCT
  // computes the topologically-correct face displacement; until that
  // worker endpoint lands, we refuse non-planar faces here.
  for (const triN of triangleNormals) {
    const dot = Math.max(-1, Math.min(1,
      triN[0] * unitNormal[0] + triN[1] * unitNormal[1] + triN[2] * unitNormal[2],
    ));
    const angle = Math.acos(dot);
    if (angle > PLANARITY_THRESHOLD_RAD) {
      warn(`applyPushPull: face is non-planar (max deviation ${angle.toFixed(3)} rad) — no-op. B-Rep push-pull pending (Phase 4).`);
      return {
        geometry,
        applied: false,
        movedVertexCount: 0,
        elapsedMs: performance.now() - t0,
      };
    }
  }

  // ─── Step 4: manifold-ness heuristic ────────────────────────────────────
  // For indexed geometries, vertex sharing gives us re-stitching for
  // free. For non-indexed geometries (BVH-CSG output), the side faces
  // around the picked face have their OWN copies of the boundary
  // vertices — we cannot "drag the side along" without a B-Rep solver
  // (Phase 4). We still apply the translation, but warn so the user
  // knows the side faces won't follow.
  if (!indexAttr) {
    warn('applyPushPull: non-indexed geometry — side faces will not re-stitch. B-Rep round-trip pending (Phase 4).');
    // We still proceed — the face vertices translate, the side faces
    // become a thin gap (visible but recoverable). E1 ships this as
    // a known degradation; W11 burn-in measures the user impact.
  }

  // ─── Step 5: clone position attribute + translate ───────────────────────
  const newPositions = new Float32Array(positions);
  const dx = unitNormal[0] * op.offsetMm;
  const dy = unitNormal[1] * op.offsetMm;
  const dz = unitNormal[2] * op.offsetMm;
  for (const v of uniqueVerts) {
    newPositions[v * 3]!     += dx;
    newPositions[v * 3 + 1]! += dy;
    newPositions[v * 3 + 2]! += dz;
  }

  // Build the output geometry. We clone-and-replace position; other
  // attributes (face-feature-id, normals, uvs) survive verbatim. We
  // recompute normals afterwards because the translated face still
  // has the same normal but the connected side faces (when indexed)
  // get sheared.
  const out = geometry.clone();
  out.setAttribute(
    'position',
    new THREE.BufferAttribute(newPositions, 3),
  );
  // Preserve face-feature-id attribute if it was present (clone
  // already copies, but normals recompute below uses positions, not
  // attributes — so the per-triangle id round-trips correctly).
  if (geometry.getAttribute(FACE_FEATURE_ID_ATTR)) {
    const srcAttr = geometry.getAttribute(FACE_FEATURE_ID_ATTR) as THREE.BufferAttribute;
    out.setAttribute(
      FACE_FEATURE_ID_ATTR,
      new THREE.BufferAttribute(
        new Uint32Array(srcAttr.array as Uint32Array),
        1,
      ),
    );
  }
  // Userdata (incl. nfabFeatureIdMap + lastFeatureId) is preserved
  // by `clone()` shallowly; that's what we want — the direct-edit op
  // doesn't introduce a new feature id.
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();

  return {
    geometry: out,
    applied: true,
    movedVertexCount: uniqueVerts.size,
    elapsedMs: performance.now() - t0,
  };
}
