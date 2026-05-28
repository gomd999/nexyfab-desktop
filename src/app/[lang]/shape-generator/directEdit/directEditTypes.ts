/**
 * directEditTypes.ts — Wave 2 Phase 3 Track E1 + E2.
 *
 * Direct-edit operations live in a session-only stack (ADR-012 §6).
 *
 * Lock-ins from ADR-012 §6:
 *   - The stack is NOT persisted by `serializeProject`. Only the
 *     parametric tree is canonical on `.nfab` save / open.
 *   - The stack is bound to the resolved parametric geometry at record
 *     time. If the parametric history is re-run from earlier, the
 *     `historyVersion` mismatch invalidates the stack with a non-
 *     blocking toast.
 *   - Opt-in commit-to-history (E5 / W7) lifts stack entries into
 *     `DirectEditPushPull` / `DirectEditFillet` / ... feature nodes.
 *     That path is out of scope for E1/E2.
 *   - The stack is per-user (no CRDT broadcast in Phase 3; collab
 *     direct edit is a Wave 3 candidate, tracker §12).
 *
 * The type union grows over Phase 3 W3-W7:
 *   - E1 (W3) ships `pushPull`.
 *   - E2 (W4) ships `dynamicFillet` + `dynamicChamfer` (this file).
 *   - E3/E4 add body-level booleans.
 */

import {
  PUSH_PULL_EPSILON_MM,
  PUSH_PULL_MAX_OFFSET_MM,
} from './pushPullMath';

/** All direct-edit ops are scoped to a single picked face (E1), a
 *  picked edge (E2 — dynamic fillet/chamfer), or a whole body (E3 —
 *  move/rotate). The union grows over Phase 3 W3-W7.
 *
 *  E2 (Track E Week 4) ops: `dynamicFillet` + `dynamicChamfer`.
 *  E3 (Track E Week 5) ops: `moveBody` + `rotateBody`.
 *  Both land here additively — edge-id ops and body-id ops do not
 *  collide. */
export type DirectEditOp =
  | {
      kind: 'pushPull';
      /** Face id stamped via `faceProvenance.ts`. See `getFaceFeatureId`
       *  in `features/faceProvenance.ts` for the read entry point. */
      faceId: string;
      /** Signed offset along the face normal. Positive = outward push,
       *  negative = inward pull. Units: mm. */
      offsetMm: number;
      /** Wall-clock at op record time. Used as a tiebreaker for the
       *  session-stack subscribers; not for ordering (the array index
       *  is the authoritative order). */
      createdAt: number;
    }
  | {
      /** Wave 2 Phase 3 Track E2 — dynamic (mesh-level) fillet on a
       *  picked edge. */
      kind: 'dynamicFillet';
      edgeId: string;
      radiusMm: number;
      createdAt: number;
    }
  | {
      /** Wave 2 Phase 3 Track E2 — dynamic chamfer on a picked edge. */
      kind: 'dynamicChamfer';
      edgeId: string;
      distanceMm: number;
      createdAt: number;
    }
  | {
      /** E3 — body-level translation. */
      kind: 'moveBody';
      bodyId: string;
      translation: [number, number, number];
      createdAt: number;
    }
  | {
      /** E3 — body-level rotation. */
      kind: 'rotateBody';
      bodyId: string;
      rotation: {
        axis: [number, number, number];
        angleRad: number;
        pivot: [number, number, number];
      };
      createdAt: number;
    };

/** Snapshot of all direct edits the local session has applied since
 *  the last history-rerun / clear. The `historyVersion` is the binding
 *  to the parametric tree's current resolved state. */
export interface DirectEditStack {
  ops: DirectEditOp[];
  /** Bound to the parametric history version at the moment the first
   *  op was recorded. On history-rerun the host bumps the version on
   *  its side; mismatch triggers `clearStack()` + toast. */
  historyVersion: number;
}

/** Face-pick payload from the viewport raycaster. The overlay maps
 *  the raycast hit into this shape and forwards it to the controller.
 *  `faceId` is the value returned by `getFaceFeatureId(geometry, triIdx)`
 *  — see `faceProvenance.ts`. */
export interface DirectEditFacePick {
  faceId: string;
  /** Unit face normal in world coordinates. */
  faceNormal: [number, number, number];
  /** World-space click point on the face (mm). Used to seed the
   *  drag origin so the push-pull arrow renders at the click site. */
  facePoint: [number, number, number];
}

/** Edge-pick payload from the viewport raycaster, used by E2's
 *  `DynamicEdgeOverlay`. The overlay computes the picked edge from
 *  the hit triangle by finding the triangle edge nearest to the click
 *  point, then encodes that endpoint pair into a stable `edgeId`.
 *
 *  Lives next to `DirectEditFacePick` because both share the "click
 *  → controller payload" idiom and downstream consumers want one
 *  import site. */
export interface DirectEditEdgePick {
  /** Canonical edge id — see `encodeEdgeId` in dynamicEdgeMath. */
  edgeId: string;
  /** World-space start endpoint (mm). */
  edgeStart: [number, number, number];
  /** World-space end endpoint (mm). */
  edgeEnd: [number, number, number];
  /** World-space click point on the edge (mm). Used to seed the
   *  drag origin so the radius/distance handle renders at the click
   *  site. */
  edgePoint: [number, number, number];
}

/** Empty-stack helper. Initial `historyVersion` is 0 which matches
 *  the host's initial render — the first `pushOp` adopts the host's
 *  current version via the controller. */
export function emptyDirectEditStack(): DirectEditStack {
  return { ops: [], historyVersion: 0 };
}

/** Type guard for the `pushPull` op variant. Tests + callers that
 *  switch on op.kind use this to narrow before reading offset/faceId. */
export function isPushPullOp(
  op: DirectEditOp,
): op is Extract<DirectEditOp, { kind: 'pushPull' }> {
  return op.kind === 'pushPull';
}

/** Type guard for the `dynamicFillet` op variant (E2). */
export function isDynamicFilletOp(
  op: DirectEditOp,
): op is Extract<DirectEditOp, { kind: 'dynamicFillet' }> {
  return op.kind === 'dynamicFillet';
}

/** Type guard for the `dynamicChamfer` op variant (E2). */
export function isDynamicChamferOp(
  op: DirectEditOp,
): op is Extract<DirectEditOp, { kind: 'dynamicChamfer' }> {
  return op.kind === 'dynamicChamfer';
}

/** Type guard for the `moveBody` op variant (E3). */
export function isMoveBodyOp(
  op: DirectEditOp,
): op is Extract<DirectEditOp, { kind: 'moveBody' }> {
  return op.kind === 'moveBody';
}

/** Type guard for the `rotateBody` op variant (E3). */
export function isRotateBodyOp(
  op: DirectEditOp,
): op is Extract<DirectEditOp, { kind: 'rotateBody' }> {
  return op.kind === 'rotateBody';
}

/** Pick payload for body-level direct edits (E3). The overlay maps a
 *  body raycast hit into this shape and forwards it to the toolbar /
 *  controller. In the current single-body shape-generator scene,
 *  picking any face on the displayed mesh selects "the body" — which
 *  is interpreted as the entire mesh. Multi-body picking is Phase 4
 *  territory; this payload is forward-compatible. */
export interface DirectEditBodyPick {
  bodyId: string;
  /** World-space click point on the body (mm) — used to seed the
   *  rotation gizmo position so it spawns at the click site. */
  hitPoint: [number, number, number];
}

/** Validation outcomes for body-transform ops. Mirrors the
 *  push-pull validation shape so the overlay can branch uniformly. */
export type BodyTransformValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'invalid_bodyId'
        | 'invalid_translation'
        | 'invalid_rotation_axis'
        | 'invalid_rotation_angle'
        | 'invalid_rotation_pivot'
        | 'translation_too_large';
    };

/** Maximum allowed translation magnitude (mm) for `moveBody`. Beyond
 *  this we assume the user typed a wrong unit (m vs mm) and refuse
 *  early. Tuned to the same M8-scale fixture used by push-pull. */
export const MOVE_BODY_MAX_TRANSLATION_MM = 100_000;

/** Maximum allowed |angle| (rad) for `rotateBody`. Beyond this the user
 *  is almost certainly confusing degrees for radians. */
export const ROTATE_BODY_MAX_ANGLE_RAD = 2 * Math.PI;

/** Validate a `moveBody` op. Pure check; does not touch the mesh. */
export function validateMoveBody(
  op: Extract<DirectEditOp, { kind: 'moveBody' }>,
): BodyTransformValidationResult {
  if (!op.bodyId || typeof op.bodyId !== 'string') {
    return { ok: false, reason: 'invalid_bodyId' };
  }
  if (!op.translation || op.translation.length !== 3) {
    return { ok: false, reason: 'invalid_translation' };
  }
  for (const v of op.translation) {
    if (!Number.isFinite(v)) {
      return { ok: false, reason: 'invalid_translation' };
    }
  }
  const mag = Math.hypot(
    op.translation[0],
    op.translation[1],
    op.translation[2],
  );
  if (mag > MOVE_BODY_MAX_TRANSLATION_MM) {
    return { ok: false, reason: 'translation_too_large' };
  }
  return { ok: true };
}

/** Validate a `rotateBody` op. Pure check; does not touch the mesh. */
export function validateRotateBody(
  op: Extract<DirectEditOp, { kind: 'rotateBody' }>,
): BodyTransformValidationResult {
  if (!op.bodyId || typeof op.bodyId !== 'string') {
    return { ok: false, reason: 'invalid_bodyId' };
  }
  if (!op.rotation) {
    return { ok: false, reason: 'invalid_rotation_axis' };
  }
  const { axis, angleRad, pivot } = op.rotation;
  if (!axis || axis.length !== 3) {
    return { ok: false, reason: 'invalid_rotation_axis' };
  }
  for (const v of axis) {
    if (!Number.isFinite(v)) {
      return { ok: false, reason: 'invalid_rotation_axis' };
    }
  }
  const axisLen = Math.hypot(axis[0], axis[1], axis[2]);
  if (axisLen < 1e-9) {
    return { ok: false, reason: 'invalid_rotation_axis' };
  }
  if (!Number.isFinite(angleRad)) {
    return { ok: false, reason: 'invalid_rotation_angle' };
  }
  if (Math.abs(angleRad) > ROTATE_BODY_MAX_ANGLE_RAD) {
    return { ok: false, reason: 'invalid_rotation_angle' };
  }
  if (!pivot || pivot.length !== 3) {
    return { ok: false, reason: 'invalid_rotation_pivot' };
  }
  for (const v of pivot) {
    if (!Number.isFinite(v)) {
      return { ok: false, reason: 'invalid_rotation_pivot' };
    }
  }
  return { ok: true };
}

// ─── E2 op-level validation (per-kind, cheap; mesh-level validation
//     happens in the appliers + dynamicEdgeMath.validateDynamicFillet) ───

export type OpValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Lightweight per-op invariant check called BEFORE the controller
 *  records the op into the stack. Covers E2's edge ops; E3 body ops
 *  use the dedicated `validateMoveBody` / `validateRotateBody` above. */
export function validateDirectEditOp(op: DirectEditOp): OpValidationResult {
  switch (op.kind) {
    case 'pushPull':
      if (!Number.isFinite(op.offsetMm)) return { ok: false, reason: 'invalid_offset' };
      if (Math.abs(op.offsetMm) < PUSH_PULL_EPSILON_MM) return { ok: false, reason: 'invalid_offset' };
      if (Math.abs(op.offsetMm) > PUSH_PULL_MAX_OFFSET_MM) return { ok: false, reason: 'too_large' };
      if (!op.faceId) return { ok: false, reason: 'missing_faceId' };
      return { ok: true };
    case 'dynamicFillet':
      if (!Number.isFinite(op.radiusMm)) return { ok: false, reason: 'invalid_radius' };
      if (op.radiusMm <= 0) return { ok: false, reason: 'invalid_radius' };
      if (op.radiusMm > PUSH_PULL_MAX_OFFSET_MM) return { ok: false, reason: 'too_large' };
      if (!op.edgeId) return { ok: false, reason: 'missing_edgeId' };
      return { ok: true };
    case 'dynamicChamfer':
      if (!Number.isFinite(op.distanceMm)) return { ok: false, reason: 'invalid_distance' };
      if (op.distanceMm <= 0) return { ok: false, reason: 'invalid_distance' };
      if (op.distanceMm > PUSH_PULL_MAX_OFFSET_MM) return { ok: false, reason: 'too_large' };
      if (!op.edgeId) return { ok: false, reason: 'missing_edgeId' };
      return { ok: true };
    case 'moveBody': {
      const r = validateMoveBody(op);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    }
    case 'rotateBody': {
      const r = validateRotateBody(op);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    }
    default: {
      const _exhaustive: never = op;
      return { ok: false, reason: `unknown_op_kind:${String((_exhaustive as { kind?: string })?.kind)}` };
    }
  }
}
