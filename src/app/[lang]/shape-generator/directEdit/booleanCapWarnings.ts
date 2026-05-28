/**
 * booleanCapWarnings.ts — Wave 2 Phase 3 Track E4 (W6).
 *
 * Soft + hard "cap" warnings for the body-subtract direct edit.
 *
 * Catalogue (per the E4 spec):
 *   - SUBTRACT_SAME_BODY      — tool and target ids equal. REFUSE.
 *   - SUBTRACT_NULL_RESULT    — boolean produces empty geometry
 *                               (tool fully contains target). REFUSE.
 *   - SUBTRACT_DISJOINT       — bodies don't intersect (no-op
 *                               subtract). WARN — applier returns the
 *                               target unchanged.
 *   - SUBTRACT_NON_MANIFOLD   — either input is non-manifold.
 *                               REFUSE.
 *
 * Naming + shape mirror `edgeCapWarnings.ts` / `bodyCapWarnings.ts`
 * so the toolbar's warning-strip can switch on the discriminant.
 */

import * as THREE from 'three';
import type { DirectEditOp } from './directEditTypes';

/** Discriminated codes for the four spec-locked warnings. */
export type BooleanCapWarningCode =
  | 'SUBTRACT_SAME_BODY'
  | 'SUBTRACT_NULL_RESULT'
  | 'SUBTRACT_DISJOINT'
  | 'SUBTRACT_NON_MANIFOLD';

export interface BooleanCapWarning {
  code: BooleanCapWarningCode;
  /** Human-readable English message. i18n lives in `directEditI18n`. */
  message: string;
  /** True when the warning should block the apply path. SAME_BODY,
   *  NULL_RESULT and NON_MANIFOLD are blocking; DISJOINT is advisory. */
  blocking: boolean;
}

/** Catalogue map — useful for tests that want to enumerate all codes
 *  without parsing emit sites. */
export const BOOLEAN_CAP_WARNING_CATALOGUE: ReadonlyArray<BooleanCapWarningCode> = [
  'SUBTRACT_SAME_BODY',
  'SUBTRACT_NULL_RESULT',
  'SUBTRACT_DISJOINT',
  'SUBTRACT_NON_MANIFOLD',
] as const;

/** Geometry + op inputs the checker uses to decide which warnings to
 *  emit. All fields are required so the caller can't accidentally
 *  skip a guard. */
export interface BooleanCapContext {
  /** Target body geometry (the one being subtracted FROM). */
  target: THREE.BufferGeometry | null;
  /** Tool body geometry (the one being subtracted, consumed). */
  tool: THREE.BufferGeometry | null;
}

/** Lightweight manifoldness probe — checks that:
 *   1. The position attribute exists and has > 0 verts.
 *   2. The triangle count is a multiple of 1 (always true) AND
 *      there are at least 4 triangles (a tetrahedron is the
 *      smallest closed surface).
 *   3. No NaN/Inf in the position buffer.
 *
 * Cheap O(N) — not a true topological manifold check (that needs an
 * edge-adjacency walk which is too expensive for a pre-check). The
 * three-bvh-csg Evaluator itself catches the deep cases; this probe
 * stops the obvious "empty / single-tri / NaN" inputs early.
 */
export function isLikelyManifold(geo: THREE.BufferGeometry | null): boolean {
  if (!geo) return false;
  const pos = geo.getAttribute('position') as
    | THREE.BufferAttribute
    | undefined;
  if (!pos || pos.count === 0) return false;
  const triCount = geo.index ? geo.index.count / 3 : pos.count / 3;
  if (triCount < 4) return false;
  const arr = pos.array as Float32Array;
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i]!)) return false;
  }
  return true;
}

/** Cheap bbox-overlap test — used to detect SUBTRACT_DISJOINT before
 *  the (expensive) full boolean run. Returns true when the two bboxes
 *  overlap on all three axes. False is conclusive (no overlap → no
 *  intersection); true is suggestive (bboxes overlap, real meshes
 *  might still be disjoint — but cheap to over-warn here is fine). */
export function bboxesOverlap(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): boolean {
  a.computeBoundingBox();
  b.computeBoundingBox();
  const A = a.boundingBox;
  const B = b.boundingBox;
  if (!A || !B) return false;
  return (
    A.max.x >= B.min.x &&
    A.min.x <= B.max.x &&
    A.max.y >= B.min.y &&
    A.min.y <= B.max.y &&
    A.max.z >= B.min.z &&
    A.min.z <= B.max.z
  );
}

/**
 * Compute the pre-apply warnings for a `subtractBody` op + its
 * geometries. Returns a (possibly empty) array. Same-body and
 * non-manifold are blocking (the applier refuses); disjoint and
 * null-result the caller folds in after the apply attempt.
 *
 * The null-result check requires the applier output, so we don't
 * surface SUBTRACT_NULL_RESULT here — see {@link makeNullResultWarning}.
 */
export function checkSubtractBodyCaps(
  op: Extract<DirectEditOp, { kind: 'subtractBody' }>,
  ctx: BooleanCapContext,
): BooleanCapWarning[] {
  const warnings: BooleanCapWarning[] = [];

  // ─── SAME_BODY: hard refuse, regardless of geometry. ─────────────────────
  if (op.targetBodyId === op.toolBodyId) {
    warnings.push({
      code: 'SUBTRACT_SAME_BODY',
      message:
        'Tool and target are the same body — pick a different body to subtract.',
      blocking: true,
    });
    // Same-body is already disqualifying; no point in further checks.
    return warnings;
  }

  // ─── NON_MANIFOLD: refuse before we feed CSG. ────────────────────────────
  if (!isLikelyManifold(ctx.target) || !isLikelyManifold(ctx.tool)) {
    warnings.push({
      code: 'SUBTRACT_NON_MANIFOLD',
      message:
        'One of the bodies is non-manifold (open, degenerate, or contains NaN/Inf) — cannot subtract.',
      blocking: true,
    });
    return warnings;
  }

  // ─── DISJOINT: soft warn — applier returns target unchanged. ─────────────
  // We use bboxes (cheap) as the gate. A true conservative disjoint
  // detector would need a full mesh-vs-mesh intersection probe; the
  // applier's CSG run is the final arbiter.
  if (ctx.target && ctx.tool && !bboxesOverlap(ctx.target, ctx.tool)) {
    warnings.push({
      code: 'SUBTRACT_DISJOINT',
      message:
        "Tool and target don't intersect — subtraction has no effect (target unchanged).",
      blocking: false,
    });
  }

  return warnings;
}

/** Synthesize a {@link BooleanCapWarning} after the applier reports an
 *  empty result. The applier alone can detect this — the pre-check
 *  has no way to know without running CSG. The caller folds this into
 *  the warning bus alongside the pre-check list. */
export function makeNullResultWarning(): BooleanCapWarning {
  return {
    code: 'SUBTRACT_NULL_RESULT',
    message:
      'Subtraction produced an empty geometry — the tool fully contains the target.',
    blocking: true,
  };
}
