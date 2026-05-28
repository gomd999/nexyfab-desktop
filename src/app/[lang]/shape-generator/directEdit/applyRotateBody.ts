/**
 * applyRotateBody.ts — Wave 2 Phase 3 Track E3.
 *
 * Mesh-level body-rotate implementation. Takes a `BufferGeometry` and
 * a `rotateBody` op, returns a NEW geometry with EVERY position-
 * attribute vertex rotated about `op.rotation.axis` through
 * `op.rotation.pivot` by `op.rotation.angleRad`.
 *
 * Strategy:
 *   1. Validate the op via `validateRotateBody`. Reject + warn on bad
 *      axis/pivot/angle.
 *   2. (Optional) verify body matches geometry's `lastFeatureId`.
 *      Warn-only — see applyMoveBody for rationale.
 *   3. Pre-compute the 3×3 rotation matrix once. Then loop:
 *        v' = R · (v - pivot) + pivot
 *      O(N) matrix multiply per vertex.
 *   4. Recompute normals (rotation changes them) + bounding box.
 *
 * Performance budget (ADR-012 §8): p95 ≤ 30ms per drag-end apply.
 * Rotation is O(N) — same vertex count as a move but with a 9-
 * multiplication kernel. Single-digit ms for typical CAD parts; the
 * perf test budgets 60ms allowing for CI cold-start jitter.
 *
 * Does NOT mutate `geometry`. Position attribute is cloned.
 */

import * as THREE from 'three';
import {
  FACE_FEATURE_ID_ATTR,
} from '../features/faceProvenance';
import {
  validateRotateBody,
  type DirectEditOp,
} from './directEditTypes';
import {
  buildRotationMatrix3,
  ROTATE_BODY_EPSILON_RAD,
} from './bodyTransformMath';

export interface ApplyRotateBodyContext {
  /** Optional console-warn target (overridable for tests). */
  warn?: (msg: string) => void;
}

export interface ApplyRotateBodyResult {
  /** New geometry. Identical-by-reference to the input only when the
   *  op was rejected (validation failure / sub-epsilon angle / missing
   *  position attribute). */
  geometry: THREE.BufferGeometry;
  applied: boolean;
  movedVertexCount: number;
  elapsedMs: number;
}

export function applyRotateBody(
  geometry: THREE.BufferGeometry,
  op: Extract<DirectEditOp, { kind: 'rotateBody' }>,
  ctx: ApplyRotateBodyContext = {},
): ApplyRotateBodyResult {
  const t0 = performance.now();
  const warn = ctx.warn ?? ((m: string) => console.warn(`[directEdit] ${m}`));

  // ─── Step 1: validate the op ────────────────────────────────────────────
  const validation = validateRotateBody(op);
  if (!validation.ok) {
    warn(`applyRotateBody: invalid op (${validation.reason}) — no-op`);
    return {
      geometry,
      applied: false,
      movedVertexCount: 0,
      elapsedMs: performance.now() - t0,
    };
  }

  const posAttr = geometry.getAttribute('position') as
    | THREE.BufferAttribute
    | undefined;
  if (!posAttr) {
    warn('applyRotateBody: geometry has no position attribute — no-op');
    return {
      geometry,
      applied: false,
      movedVertexCount: 0,
      elapsedMs: performance.now() - t0,
    };
  }

  // ─── Step 2: sub-epsilon angle guard ────────────────────────────────────
  if (Math.abs(op.rotation.angleRad) < ROTATE_BODY_EPSILON_RAD) {
    return {
      geometry,
      applied: false,
      movedVertexCount: 0,
      elapsedMs: performance.now() - t0,
    };
  }

  // ─── Step 3: bodyId / lastFeatureId sanity ──────────────────────────────
  const coarseId =
    typeof geometry.userData?.lastFeatureId === 'string'
      ? (geometry.userData.lastFeatureId as string)
      : null;
  if (coarseId && coarseId !== op.bodyId) {
    warn(
      `applyRotateBody: bodyId="${op.bodyId}" does not match geometry.lastFeatureId="${coarseId}" — applying anyway (multi-body support pending).`,
    );
  }

  // ─── Step 4: pre-compute rotation matrix once ───────────────────────────
  const R = buildRotationMatrix3(op.rotation.axis, op.rotation.angleRad);
  const px = op.rotation.pivot[0];
  const py = op.rotation.pivot[1];
  const pz = op.rotation.pivot[2];

  // ─── Step 5: clone + transform every vertex ─────────────────────────────
  const positions = posAttr.array as Float32Array;
  const newPositions = new Float32Array(positions.length);
  // Hoist the matrix entries into locals so the inner loop stays tight.
  const r00 = R[0]!, r01 = R[1]!, r02 = R[2]!;
  const r10 = R[3]!, r11 = R[4]!, r12 = R[5]!;
  const r20 = R[6]!, r21 = R[7]!, r22 = R[8]!;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]! - px;
    const y = positions[i + 1]! - py;
    const z = positions[i + 2]! - pz;
    newPositions[i] = r00 * x + r01 * y + r02 * z + px;
    newPositions[i + 1] = r10 * x + r11 * y + r12 * z + py;
    newPositions[i + 2] = r20 * x + r21 * y + r22 * z + pz;
  }

  // ─── Step 6: assemble output geometry ───────────────────────────────────
  const out = geometry.clone();
  out.setAttribute(
    'position',
    new THREE.BufferAttribute(newPositions, 3),
  );
  // Preserve face-feature-id attribute explicitly.
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
  // Normals must be recomputed — rotation changes them.
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();

  return {
    geometry: out,
    applied: true,
    movedVertexCount: positions.length / 3,
    elapsedMs: performance.now() - t0,
  };
}
