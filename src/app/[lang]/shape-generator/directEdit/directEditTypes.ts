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
 *  picked edge (E2), or a set thereof (E2+). */
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
       *  picked edge. Distinct from the parametric `features/fillet.ts`
       *  feature: this is a session-only direct edit, not persisted in
       *  the .nfab, and operates on the displayed mesh — not on the
       *  upstream B-Rep. See ADR-012 §6.
       *
       *  `edgeId` is the canonical mesh-edge id computed by
       *  `dynamicEdgeMath.encodeEdgeId(startVert, endVert)` — a
       *  position-based signature so the same picked edge stays
       *  resolvable through a `pushOp` undo / re-apply cycle (the
       *  applier walks the mesh and matches edges by quantised
       *  endpoint). Strictly stable inside a session, NOT across
       *  history re-runs (which clear the stack anyway). */
      kind: 'dynamicFillet';
      edgeId: string;
      /** Fillet radius in mm. Must be > 0 and finite. */
      radiusMm: number;
      createdAt: number;
    }
  | {
      /** Wave 2 Phase 3 Track E2 — dynamic (mesh-level) chamfer on a
       *  picked edge. Same scope / lock-ins as `dynamicFillet`. */
      kind: 'dynamicChamfer';
      edgeId: string;
      /** Chamfer setback distance from the corner along each adjacent
       *  face, in mm. Symmetric chamfer (a 45° bevel for a 90° edge);
       *  asymmetric / angle-variant chamfer is a Phase 4 B-Rep job. */
      distanceMm: number;
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

/** Type guard for the `dynamicFillet` op variant. */
export function isDynamicFilletOp(
  op: DirectEditOp,
): op is Extract<DirectEditOp, { kind: 'dynamicFillet' }> {
  return op.kind === 'dynamicFillet';
}

/** Type guard for the `dynamicChamfer` op variant. */
export function isDynamicChamferOp(
  op: DirectEditOp,
): op is Extract<DirectEditOp, { kind: 'dynamicChamfer' }> {
  return op.kind === 'dynamicChamfer';
}

// ─── Op-level validation (per-kind, cheap; mesh-level validation
//     happens in the appliers + dynamicEdgeMath.validateDynamicFillet) ───

export type OpValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Lightweight per-op invariant check called BEFORE the controller
 *  records the op into the stack. Keeps obviously-bad ops (NaN, sign
 *  flips, oversize) out of the session stack so undo doesn't lose its
 *  alignment to the user's mental model.
 *
 *  The mesh appliers (`applyPushPull` / `applyDynamicFillet` /
 *  `applyDynamicChamfer`) still re-validate against the actual mesh
 *  state — this helper is a pre-flight gate, not the source of truth. */
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
    default: {
      // Exhaustiveness check — TS errors here if a kind is unhandled.
      const _exhaustive: never = op;
      return { ok: false, reason: `unknown_op_kind:${String((_exhaustive as { kind?: string })?.kind)}` };
    }
  }
}
