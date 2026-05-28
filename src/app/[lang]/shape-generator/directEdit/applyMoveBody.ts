/**
 * applyMoveBody.ts — Wave 2 Phase 3 Track E3.
 *
 * Mesh-level body-move implementation. Takes a `BufferGeometry` and a
 * `moveBody` op, returns a NEW geometry with EVERY position-attribute
 * vertex translated by `op.translation`.
 *
 * Strategy:
 *   1. Validate the op via `validateMoveBody`. Reject + warn on bad
 *      bodyId / non-finite translation / out-of-range magnitude.
 *   2. (Optional) verify the body matches the geometry's
 *      `lastFeatureId`. If it doesn't, we still apply — the host owns
 *      body picking and may have used a synthetic id during the
 *      single-body shape-generator era. We emit a warn so multi-body
 *      regressions in W7 surface clearly.
 *   3. Clone the position attribute and add the translation to every
 *      vertex (trivial O(N) write).
 *   4. Recompute normals + bounding box / sphere. Normals are
 *      translation-invariant in theory; we recompute to keep the
 *      flow symmetric with `applyPushPull` + so any host-side
 *      attribute-merge stays consistent.
 *
 * Performance budget (ADR-012 §8): p95 ≤ 30ms per drag-end apply.
 * Trivial O(N) — the only sub-budget risk is geometries with >100k
 * vertices, which lives in Phase 4 LOD territory.
 *
 * Does NOT mutate `geometry`. Position attribute is cloned.
 */

import * as THREE from 'three';
import {
  FACE_FEATURE_ID_ATTR,
} from '../features/faceProvenance';
import {
  validateMoveBody,
  type DirectEditOp,
} from './directEditTypes';
import { MOVE_BODY_EPSILON_MM } from './bodyTransformMath';

export interface ApplyMoveBodyContext {
  /** Optional console-warn target (overridable for tests). */
  warn?: (msg: string) => void;
}

export interface ApplyMoveBodyResult {
  /** New geometry. Identical-by-reference to the input only when the
   *  op was rejected (validation failure / sub-epsilon translation /
   *  missing position attribute). */
  geometry: THREE.BufferGeometry;
  /** Whether the op mutated the mesh. False on rejection. */
  applied: boolean;
  /** Number of vertices that moved (0 when applied=false). */
  movedVertexCount: number;
  /** Wall-clock duration in ms. Used by the perf-budget test. */
  elapsedMs: number;
}

/**
 * Apply a `moveBody` op to `geometry`. Returns a new geometry on
 * success; returns the input geometry unchanged on rejection (with a
 * console warn) so the overlay can degrade gracefully.
 */
export function applyMoveBody(
  geometry: THREE.BufferGeometry,
  op: Extract<DirectEditOp, { kind: 'moveBody' }>,
  ctx: ApplyMoveBodyContext = {},
): ApplyMoveBodyResult {
  const t0 = performance.now();
  const warn = ctx.warn ?? ((m: string) => console.warn(`[directEdit] ${m}`));

  // ─── Step 1: validate the op ────────────────────────────────────────────
  const validation = validateMoveBody(op);
  if (!validation.ok) {
    warn(`applyMoveBody: invalid op (${validation.reason}) — no-op`);
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
    warn('applyMoveBody: geometry has no position attribute — no-op');
    return {
      geometry,
      applied: false,
      movedVertexCount: 0,
      elapsedMs: performance.now() - t0,
    };
  }

  // ─── Step 2: sub-epsilon guard ──────────────────────────────────────────
  const [tx, ty, tz] = op.translation;
  const mag = Math.hypot(tx, ty, tz);
  if (mag < MOVE_BODY_EPSILON_MM) {
    // Treat as no-op rather than recording a zero translation.
    return {
      geometry,
      applied: false,
      movedVertexCount: 0,
      elapsedMs: performance.now() - t0,
    };
  }

  // ─── Step 3: optional bodyId / lastFeatureId sanity check ───────────────
  // We don't refuse on mismatch (single-body scenes may pass synthetic
  // ids) but we warn so multi-body regressions in W7 surface.
  const coarseId =
    typeof geometry.userData?.lastFeatureId === 'string'
      ? (geometry.userData.lastFeatureId as string)
      : null;
  if (coarseId && coarseId !== op.bodyId) {
    warn(
      `applyMoveBody: bodyId="${op.bodyId}" does not match geometry.lastFeatureId="${coarseId}" — applying anyway (multi-body support pending).`,
    );
  }

  // ─── Step 4: clone position attribute + translate ───────────────────────
  const positions = posAttr.array as Float32Array;
  const newPositions = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    newPositions[i] = positions[i]! + tx;
    newPositions[i + 1] = positions[i + 1]! + ty;
    newPositions[i + 2] = positions[i + 2]! + tz;
  }

  // ─── Step 5: assemble output geometry ───────────────────────────────────
  const out = geometry.clone();
  out.setAttribute(
    'position',
    new THREE.BufferAttribute(newPositions, 3),
  );
  // Preserve face-feature-id attribute explicitly — clone() copies it
  // shallowly but we want a typed-array copy so downstream mutations
  // don't propagate to the input.
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
  // Normals are translation-invariant — but recompute for parity with
  // applyPushPull (and to defend against any input mesh whose normals
  // were left stale by an upstream op).
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
