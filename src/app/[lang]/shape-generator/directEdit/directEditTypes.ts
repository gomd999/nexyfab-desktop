/**
 * directEditTypes.ts — Wave 2 Phase 3 Track E1.
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
 *     That path is out of scope for E1.
 *   - The stack is per-user (no CRDT broadcast in Phase 3; collab
 *     direct edit is a Wave 3 candidate, tracker §12).
 *
 * The type union is open-ended on purpose: E2 (W4) adds the
 * `fillet/chamfer dynamic` variant, E3-E4 add body-level booleans.
 * For E1 we only ship the `pushPull` variant + a reserved placeholder
 * so the discriminated-union exhaustiveness check stays meaningful.
 */

/** All direct-edit ops are scoped to a single picked face (E1) or a
 *  set of faces (E2+). The union grows over Phase 3 W3-W7. */
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
      /** Placeholder so the discriminated union forces exhaustiveness
       *  checks in switch statements. Replaced in W4 by E2's
       *  `fillet`/`chamfer` dynamic variant. */
      kind: 'reserved_W4_E2';
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
