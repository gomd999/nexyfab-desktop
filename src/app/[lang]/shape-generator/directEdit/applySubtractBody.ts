/**
 * applySubtractBody.ts — Wave 2 Phase 3 Track E4 (W6).
 *
 * Mesh-level boolean subtract: `target − tool`. Uses three-bvh-csg's
 * `Evaluator + Brush + SUBTRACTION` operation — the same machinery the
 * Wave 1 parametric `features/boolean.ts` relies on, but invoked
 * synchronously (no worker round-trip per ADR-012 §6).
 *
 * Strategy:
 *   1. Validate the op via `validateSubtractBody`. Reject empty ids,
 *      same-body picks, invalid keepTool flag.
 *   2. Pre-check via `checkSubtractBodyCaps`. Blocking warnings
 *      (NON_MANIFOLD, SAME_BODY) → bail with `applied=false`.
 *      Non-blocking (DISJOINT) → return target unchanged but mark
 *      `applied=false` so the host can surface the warn.
 *   3. Run the boolean. If the result is empty (tool fully contains
 *      target), emit SUBTRACT_NULL_RESULT and bail.
 *   4. Re-stamp the result's per-triangle feature attribute so the
 *      target's identity propagates — tool-side faces inherit the
 *      target's coarse id (mirrors the W1 boolean's `stampFaceFeatureIdAll`
 *      tool-tagging idiom, except here we re-stamp the OUTPUT to match
 *      target rather than seeding the input).
 *   5. Recompute normals + bbox + sphere.
 *   6. Return result + optional tool clone (`keepTool=true`).
 *
 * Performance budget (ADR-012 §8): ≤ 30ms p95 on M8-scale (~500 tri)
 * pairs. CSG dominates; pre/post overhead is trivial.
 *
 * Does NOT mutate either input. Output is a fresh BufferGeometry.
 */

import * as THREE from 'three';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import {
  stampFaceFeatureIdAll,
  FACE_FEATURE_ID_ATTR,
} from '../features/faceProvenance';
import {
  validateSubtractBody,
  type DirectEditOp,
} from './directEditTypes';
import {
  checkSubtractBodyCaps,
  makeNullResultWarning,
  type BooleanCapWarning,
} from './booleanCapWarnings';

/** Reason buckets returned alongside the geometry. The overlay uses
 *  these to display either a toast / banner / no-op silently. */
export type ApplySubtractBodyReason =
  | 'ok'
  | 'invalid_op'
  | 'same_body'
  | 'non_manifold'
  | 'disjoint'
  | 'null_result'
  | 'csg_error';

export interface ApplySubtractBodyContext {
  /** Optional console-warn target (overridable for tests). */
  warn?: (msg: string) => void;
  /** Optional evaluator override — tests inject a stub to avoid
   *  pulling in three-bvh-csg's CDT machinery. When absent we
   *  instantiate a fresh Evaluator per call (see "Persistent vs
   *  per-call evaluator" in the README). */
  evaluator?: Evaluator;
}

export interface ApplySubtractBodyResult {
  /** The result geometry — `target − tool` on success, the input
   *  `target` reference unchanged on rejection / disjoint / error. */
  geometry: THREE.BufferGeometry;
  /** When `op.keepTool` is true AND the op applied, this carries a
   *  defensive clone of the tool geometry the host should keep as a
   *  separate body. Null when keepTool was false or the op didn't
   *  apply. */
  keptToolGeometry: THREE.BufferGeometry | null;
  /** Whether the op mutated the displayed mesh. False on any
   *  rejection / disjoint / error path. */
  applied: boolean;
  /** Stable categorical reason for the outcome — programmatic
   *  callers branch on this rather than parsing the `warnings`
   *  payload. */
  reason: ApplySubtractBodyReason;
  /** Cap warnings raised pre-apply (SAME_BODY / NON_MANIFOLD /
   *  DISJOINT) and post-apply (NULL_RESULT). */
  warnings: BooleanCapWarning[];
  /** Wall-clock duration in ms — used by the perf-budget test. */
  elapsedMs: number;
}

/**
 * Persistent vs per-call Evaluator (decision log):
 *   three-bvh-csg's Evaluator carries internal BVH caches across
 *   evaluate() calls. Persisting it across many subtracts in a
 *   session SHOULD amortise the cache-warm cost; however the cache
 *   keys off Brush identity, and the E4 overlay produces a fresh
 *   Brush per drag (target/tool change every pick), so the cache hit
 *   rate is effectively zero. We instantiate per-call. The test
 *   harness can inject a shared one via `ctx.evaluator` when running
 *   the perf suite, to confirm the choice is wash.
 */
function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

/** Ensure both inputs carry the per-vertex `nfabFaceFeatureId`
 *  attribute (sentinel 0) so the evaluator doesn't crash reading
 *  `.array` of an absent attribute. Mirrors the helper in
 *  `features/boolean.ts`. */
function fillSentinelFaceId(geo: THREE.BufferGeometry): void {
  if (geo.getAttribute(FACE_FEATURE_ID_ATTR)) return;
  const vertCount = geo.attributes.position.count;
  geo.setAttribute(
    FACE_FEATURE_ID_ATTR,
    new THREE.BufferAttribute(new Uint32Array(vertCount), 1),
  );
}

/** Resolve the target body's coarse feature id, falling back to a
 *  derived synthetic id when the geometry lacks one. Used for the
 *  post-CSG re-stamp. */
function resolveTargetFeatureId(
  geo: THREE.BufferGeometry,
  fallback: string,
): string {
  const last = geo.userData?.lastFeatureId;
  if (typeof last === 'string' && last.length > 0) return last;
  return fallback;
}

/**
 * Apply a `subtractBody` op to a target geometry. Returns a new
 * geometry on success; returns the input geometry unchanged on
 * rejection, with `applied=false` + `warnings` describing why.
 *
 * Signature:
 *   - `targetGeometry` — the body the user picked Stage 2 ("keep").
 *   - `toolGeometry`   — the body the user picked Stage 1 ("consume").
 *   - `op`             — discriminated DirectEditOp (subtractBody).
 *   - `ctx`            — optional warn sink + evaluator override.
 */
export function applySubtractBody(
  targetGeometry: THREE.BufferGeometry,
  toolGeometry: THREE.BufferGeometry,
  op: Extract<DirectEditOp, { kind: 'subtractBody' }>,
  ctx: ApplySubtractBodyContext = {},
): ApplySubtractBodyResult {
  const t0 = performance.now();
  const warn = ctx.warn ?? ((m: string) => console.warn(`[directEdit] ${m}`));

  // ─── Step 1: op validation ──────────────────────────────────────────────
  const validation = validateSubtractBody(op);
  if (!validation.ok) {
    warn(`applySubtractBody: invalid op (${validation.reason}) — no-op`);
    return {
      geometry: targetGeometry,
      keptToolGeometry: null,
      applied: false,
      reason:
        validation.reason === 'same_body' ? 'same_body' : 'invalid_op',
      warnings:
        validation.reason === 'same_body'
          ? [
              {
                code: 'SUBTRACT_SAME_BODY',
                message:
                  'Tool and target are the same body — pick a different body to subtract.',
                blocking: true,
              },
            ]
          : [],
      elapsedMs: performance.now() - t0,
    };
  }

  // ─── Step 2: pre-apply cap-warning sweep ────────────────────────────────
  const preWarnings = checkSubtractBodyCaps(op, {
    target: targetGeometry,
    tool: toolGeometry,
  });
  const sameBody = preWarnings.find((w) => w.code === 'SUBTRACT_SAME_BODY');
  if (sameBody) {
    warn('applySubtractBody: tool and target are the same body — no-op');
    return {
      geometry: targetGeometry,
      keptToolGeometry: null,
      applied: false,
      reason: 'same_body',
      warnings: preWarnings,
      elapsedMs: performance.now() - t0,
    };
  }
  const nonManifold = preWarnings.find(
    (w) => w.code === 'SUBTRACT_NON_MANIFOLD',
  );
  if (nonManifold) {
    warn('applySubtractBody: non-manifold input — no-op');
    return {
      geometry: targetGeometry,
      keptToolGeometry: null,
      applied: false,
      reason: 'non_manifold',
      warnings: preWarnings,
      elapsedMs: performance.now() - t0,
    };
  }
  const disjoint = preWarnings.find((w) => w.code === 'SUBTRACT_DISJOINT');
  if (disjoint) {
    // Spec: DISJOINT warns but allows — the result is the original
    // target unchanged. We short-circuit before running CSG since the
    // boolean would just return target anyway, and CSG cost is the
    // dominant factor on the perf budget.
    warn(
      "applySubtractBody: target and tool don't intersect — returning target unchanged",
    );
    return {
      geometry: targetGeometry,
      keptToolGeometry: null,
      applied: false,
      reason: 'disjoint',
      warnings: preWarnings,
      elapsedMs: performance.now() - t0,
    };
  }

  // ─── Step 3: run the boolean ───────────────────────────────────────────
  let resultGeo: THREE.BufferGeometry;
  try {
    // Clone the inputs defensively so the per-vertex attribute fill
    // doesn't mutate the host's geometries (the host may keep using
    // the tool body if keepTool is true).
    const targetClone = targetGeometry.clone();
    const toolClone = toolGeometry.clone();
    fillSentinelFaceId(targetClone);
    fillSentinelFaceId(toolClone);

    const evaluator = ctx.evaluator ?? new Evaluator();
    evaluator.attributes = [
      ...(evaluator.attributes ?? []).filter(
        (a: string) => a !== FACE_FEATURE_ID_ATTR,
      ),
      FACE_FEATURE_ID_ATTR,
    ];

    const brushA = makeBrush(targetClone);
    const brushB = makeBrush(toolClone);
    const result: Brush = evaluator.evaluate(brushA, brushB, SUBTRACTION);

    if (
      !result.geometry ||
      !result.geometry.attributes.position ||
      result.geometry.attributes.position.count === 0
    ) {
      warn('applySubtractBody: empty result — tool fully contains target');
      const nullWarn = makeNullResultWarning();
      return {
        geometry: targetGeometry,
        keptToolGeometry: null,
        applied: false,
        reason: 'null_result',
        warnings: [...preWarnings, nullWarn],
        elapsedMs: performance.now() - t0,
      };
    }
    resultGeo = result.geometry;

    // ─── Step 4: face-provenance re-stamp ────────────────────────────────
    // The subtracted output is single-body from the user's POV (a
    // hole carved into target). Re-stamp every triangle with the
    // target's feature id so downstream provenance reads
    // (`getFaceFeatureId`) resolve to "the target" rather than a
    // mixed target/tool blend. This is the E4 contract: target keeps
    // identity, tool is consumed.
    const targetFeatureId = resolveTargetFeatureId(
      targetGeometry,
      `body-${op.targetBodyId}`,
    );
    stampFaceFeatureIdAll(resultGeo, targetFeatureId);
  } catch (err) {
    warn(
      `applySubtractBody: CSG error (${err instanceof Error ? err.message : 'unknown'}) — no-op`,
    );
    return {
      geometry: targetGeometry,
      keptToolGeometry: null,
      applied: false,
      reason: 'csg_error',
      warnings: preWarnings,
      elapsedMs: performance.now() - t0,
    };
  }

  // ─── Step 5: post-process the result geometry ──────────────────────────
  resultGeo.computeVertexNormals();
  resultGeo.computeBoundingBox();
  resultGeo.computeBoundingSphere();

  // ─── Step 6: keepTool clone ────────────────────────────────────────────
  let keptToolGeometry: THREE.BufferGeometry | null = null;
  if (op.keepTool) {
    keptToolGeometry = toolGeometry.clone();
    keptToolGeometry.computeVertexNormals();
    keptToolGeometry.computeBoundingBox();
    keptToolGeometry.computeBoundingSphere();
  }

  return {
    geometry: resultGeo,
    keptToolGeometry,
    applied: true,
    reason: 'ok',
    warnings: preWarnings, // may be empty
    elapsedMs: performance.now() - t0,
  };
}
