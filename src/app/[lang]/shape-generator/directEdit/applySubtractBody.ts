/**
 * applySubtractBody.ts — Wave 2 Phase 3 Track E4 (W6).
 *
 * Mesh-level boolean subtract on the direct-edit session stack.
 * Subtracts `toolGeometry` from `targetGeometry` and returns a new
 * target geometry; the tool body is logically consumed (caller is
 * expected to remove it from the scene on `applied: true`).
 *
 * Strategy:
 *   1. Validate the op (targetBodyId / toolBodyId present + distinct).
 *   2. Look up the tool geometry via the caller-provided context.
 *      Caller owns the scene → caller knows which BufferGeometry the
 *      tool body resolves to. Returning null = "tool body missing"
 *      (e.g. already removed by a prior E4 op in the stack).
 *   3. Call the existing parametric boolean primitive
 *      `applyBooleanSync('subtract', target, tool)` so feature-id
 *      provenance + nfabFeatureIdMap survive the cut (E4 inherits
 *      the same provenance contract as `boolean.ts`).
 *   4. Empty result (tool didn't intersect target) → applied=false +
 *      console warn. Caller leaves the original target unchanged so
 *      live-drag previews can roll back.
 *
 * Performance budget (ADR-012 §8): the boolean primitive is heavier
 * than push-pull (CSG is per-triangle), so we don't ship a per-op p95
 * budget here — direct-edit subtract is a release-style op, not a
 * live-drag op. The session-stack records the result.
 *
 * F-DE-04 (per Phase 3 master tracker) — this is the discrete applier
 * the fixture was waiting on; `fixtureWalkthrough.test.ts` activates
 * its F-DE-04 case once this lands.
 */

import * as THREE from 'three';
import { applyBooleanSync } from '../features/boolean';
import type { DirectEditOp } from './directEditTypes';

/** Context passed to the applier. The host supplies the tool-geometry
 *  lookup since the applier doesn't own the scene graph. */
export interface ApplySubtractBodyContext {
  /** Resolve a tool body id to its current `BufferGeometry`. Return
   *  null when the body has been removed or doesn't exist — the
   *  applier degrades to a no-op + warn. */
  lookupToolGeometry: (toolBodyId: string) => THREE.BufferGeometry | null;
  /** Optional console-warn target (overridable for tests). */
  warn?: (msg: string) => void;
}

export interface ApplySubtractBodyResult {
  /** New target geometry on success; original target on rejection. */
  geometry: THREE.BufferGeometry;
  /** True when the boolean ran AND produced a non-empty result. */
  applied: boolean;
  /** Tool body id the caller should remove from the scene. Equal to
   *  op.toolBodyId on success; empty string on rejection. */
  consumedToolBodyId: string;
  /** Wall-clock duration in ms. */
  elapsedMs: number;
  /** Optional reason for rejection — surfaced in tests + Sentry. */
  rejectionReason?:
    | 'missing_targetBodyId'
    | 'missing_toolBodyId'
    | 'self_subtract'
    | 'tool_not_found'
    | 'empty_intersection'
    | 'boolean_exception';
}

function validateOp(
  op: Extract<DirectEditOp, { kind: 'subtractBody' }>,
): ApplySubtractBodyResult['rejectionReason'] | null {
  if (!op.targetBodyId || op.targetBodyId.length === 0) return 'missing_targetBodyId';
  if (!op.toolBodyId || op.toolBodyId.length === 0) return 'missing_toolBodyId';
  if (op.targetBodyId === op.toolBodyId) return 'self_subtract';
  return null;
}

/**
 * Apply a `subtractBody` op. Returns the original target geometry +
 * applied=false on rejection (with a warn). On success, returns a NEW
 * cut geometry and the tool body id the caller must remove from the
 * scene.
 */
export function applySubtractBody(
  targetGeometry: THREE.BufferGeometry,
  op: Extract<DirectEditOp, { kind: 'subtractBody' }>,
  ctx: ApplySubtractBodyContext,
): ApplySubtractBodyResult {
  const t0 = performance.now();
  const warn = ctx.warn ?? ((m: string) => console.warn(`[directEdit] ${m}`));

  const validationReason = validateOp(op);
  if (validationReason) {
    warn(`applySubtractBody: rejected (${validationReason}) — no-op`);
    return {
      geometry: targetGeometry,
      applied: false,
      consumedToolBodyId: '',
      elapsedMs: performance.now() - t0,
      rejectionReason: validationReason,
    };
  }

  const toolGeometry = ctx.lookupToolGeometry(op.toolBodyId);
  if (!toolGeometry) {
    warn(`applySubtractBody: tool body '${op.toolBodyId}' not found — no-op`);
    return {
      geometry: targetGeometry,
      applied: false,
      consumedToolBodyId: '',
      elapsedMs: performance.now() - t0,
      rejectionReason: 'tool_not_found',
    };
  }

  try {
    const cut = applyBooleanSync('subtract', targetGeometry, toolGeometry);
    return {
      geometry: cut,
      applied: true,
      consumedToolBodyId: op.toolBodyId,
      elapsedMs: performance.now() - t0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // applyBooleanSync throws "empty result" when target + tool don't
    // intersect. Surface that distinctly so the UI can differentiate
    // from a genuine evaluator crash.
    const isEmpty = msg.includes('empty result') || msg.includes('교차하지');
    warn(`applySubtractBody: ${isEmpty ? 'empty intersection' : 'boolean failed'} — ${msg}`);
    return {
      geometry: targetGeometry,
      applied: false,
      consumedToolBodyId: '',
      elapsedMs: performance.now() - t0,
      rejectionReason: isEmpty ? 'empty_intersection' : 'boolean_exception',
    };
  }
}
