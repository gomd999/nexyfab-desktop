/**
 * downgradeNotice.ts — surface OCCT→mesh downgrades to the user instead of
 * silently shipping an approximation (commercial-trust gate #3).
 *
 * The kernel-of-record is OCCT B-rep (see engineSelection). When B-rep is
 * WANTED but the feature runs its mesh fallback, one of two things happens:
 *
 *   - BLOCKED      — the mesh approximator can't even produce the op (a no-op:
 *                    e.g. all-convex fillet ∩ box = box). Shipping this is wrong
 *                    geometry; `roundingGuard.assertRoundingApplied` THROWS.
 *   - APPROXIMATED — the mesh path DID produce a result, but it is a faceted
 *                    approximation, not exact B-rep. The old code shipped this
 *                    with NO user signal — the silent-downgrade gap this module
 *                    closes.
 *
 * Design: a downgrade is a typed, i18n-keyed notice stamped onto the result
 * geometry's `userData` (the same side-channel features already use for
 * `occtHandle`). The pipeline/UI collects them off the final geometry and
 * renders a non-fatal banner ("이 피처는 메시로 근사됨 — 정밀 B-rep을 켜세요").
 * Non-fatal by design: APPROXIMATED never throws, so a preview-grade session
 * keeps working — it just stops lying about precision.
 */

import type * as THREE from 'three';
import { wantsOcctEngine } from './engineSelection';

export type DowngradeSeverity = 'blocked' | 'approximated' | 'reduced';

export interface MeshDowngradeNotice {
  /** The feature operation that downgraded (display label). */
  op: string;
  /** Feature instance id, when known (for click-to-locate in the tree). */
  featureId?: string;
  /** 'blocked' = no usable result (hard); 'approximated' = faceted, not exact;
   *  'reduced' = exact B-rep built, but with DEGRADED parameters (Phase-4
   *  auto-avoidance — e.g. fillet radius reduced, or a subset of edges). */
  severity: DowngradeSeverity;
  /** Translation key for the UI layer. */
  i18nKey: string;
  /** Best-effort English fallback. */
  fallbackMessage: string;
  /** 'reduced' only — what the user asked for vs what actually built. */
  requested?: Record<string, number>;
  applied?: Record<string, number>;
  /** 'reduced' only — short human summary, e.g. "radius 8 → 4 mm". */
  detail?: string;
}

/**
 * Build a 'reduced' notice for a Phase-4 auto-avoidance success: the kernel
 * REFUSED the requested parameters but succeeded with degraded ones. The
 * feature node keeps showing the requested params; this notice is the
 * mandatory "what was actually applied" signal (never silently apply
 * different params).
 */
export function makeReducedNotice(args: {
  op: string;
  featureId?: string;
  requested: Record<string, number>;
  applied: Record<string, number>;
  detail: string;
}): MeshDowngradeNotice {
  return {
    op: args.op,
    featureId: args.featureId,
    severity: 'reduced',
    i18nKey: 'downgrade.reduced',
    fallbackMessage:
      `${args.op}: the requested parameters failed in the B-rep kernel — ` +
      `auto-applied ${args.detail} instead. Adjust the feature to remove this notice.`,
    requested: args.requested,
    applied: args.applied,
    detail: args.detail,
  };
}

/**
 * Decide whether a feature's run was a downgrade worth telling the user about.
 *
 *   wantedOcct  — did user intent select B-rep? (engineSelection.wantsOcctEngine)
 *   occtRan     — did the OCCT path actually execute and return B-rep?
 *   isNoOp      — for ops that can degenerate to identity (rounding), did the
 *                 mesh fallback leave the solid unchanged?
 *
 * Returns null when there is nothing to report: the user explicitly chose mesh
 * (!wantedOcct), or OCCT genuinely ran (occtRan). Otherwise the feature ran the
 * mesh path against the user's B-rep intent → blocked (no-op) or approximated.
 */
export function classifyMeshDowngrade(args: {
  op: string;
  featureId?: string;
  wantedOcct: boolean;
  occtRan: boolean;
  isNoOp?: boolean;
}): MeshDowngradeNotice | null {
  const { op, featureId, wantedOcct, occtRan, isNoOp = false } = args;
  // User explicitly picked mesh, or we delivered real B-rep → no downgrade.
  if (!wantedOcct || occtRan) return null;

  if (isNoOp) {
    return {
      op,
      featureId,
      severity: 'blocked',
      i18nKey: 'downgrade.blocked',
      fallbackMessage:
        `${op}: the B-rep (OCCT) engine is unavailable and the mesh approximation ` +
        `cannot produce this operation. Enable the OCCT engine and retry.`,
    };
  }
  return {
    op,
    featureId,
    severity: 'approximated',
    i18nKey: 'downgrade.approximated',
    fallbackMessage:
      `${op}: computed with the faceted mesh approximation, not exact B-rep. ` +
      `Enable the OCCT engine for a precise result.`,
  };
}

const USERDATA_KEY = 'meshDowngrades';

/**
 * Drop a stale B-rep handle from a mesh-fallback result.
 *
 * THREE's `BufferGeometry.clone()/copy()` shares `userData` BY REFERENCE, so a
 * feature's mesh fallback that clones-and-mutates vertices still carries the
 * upstream `occtHandle` — the displayed mesh and the registered B-rep solid
 * silently diverge (downstream OCCT features / STEP export then operate on the
 * WRONG solid). After any mesh fallback the handle must be cleared so
 * downstream OCCT features re-derive a host from the mesh instead.
 *
 * Detaches `userData` (shallow copy) before deleting, so the upstream
 * geometry's own (still-valid) handle is never mutated through the shared
 * reference. Returns the geometry for chaining.
 */
export function clearStaleBrepHandle(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const ud = geometry.userData as Record<string, unknown> | undefined;
  if (ud && 'occtHandle' in ud) {
    const detached = { ...ud };
    delete detached.occtHandle;
    geometry.userData = detached;
  }
  return geometry;
}

/**
 * Stamp a downgrade notice onto a geometry's userData side-channel so the
 * pipeline can collect it. Accumulates (a feature pipeline can downgrade more
 * than once); no-ops on a null notice for call-site convenience.
 *
 * Copy-on-write: `userData` (and the notice list) may be SHARED with the
 * upstream geometry via THREE's reference-sharing clone, so both the object
 * and the array are replaced rather than mutated in place.
 */
export function stampDowngrade(
  geometry: THREE.BufferGeometry,
  notice: MeshDowngradeNotice | null,
): void {
  if (!notice) return;
  const list = (geometry.userData[USERDATA_KEY] as MeshDowngradeNotice[] | undefined) ?? [];
  geometry.userData = { ...geometry.userData, [USERDATA_KEY]: [...list, notice] };
}

/** Read back the downgrade notices accumulated on a geometry (never null). */
export function collectDowngrades(geometry: THREE.BufferGeometry): MeshDowngradeNotice[] {
  return (geometry.userData[USERDATA_KEY] as MeshDowngradeNotice[] | undefined) ?? [];
}

/** True if any stamped downgrade is hard (blocked) rather than a soft approximation. */
export function hasBlockingDowngrade(geometry: THREE.BufferGeometry): boolean {
  return collectDowngrades(geometry).some((n) => n.severity === 'blocked');
}

/**
 * Chainable convenience for the common feature mesh-fallback site:
 *
 *     if (shouldUseOcctEngine(engine)) { try { return occt } catch { warn } }
 *     return noteMeshFallback(applyXMesh(geo), { op: 'X', engine, featureId });
 *
 * Self-gating: it stamps a soft 'approximated' notice ONLY when the engine intent
 * actually wanted B-rep (wantsOcctEngine) — so wrapping a pure-mesh return where
 * the user explicitly picked the mesh engine is a no-op. Returns the geometry so
 * it drops in around the existing `return`.
 *
 * Always (regardless of engine intent) clears a stale `occtHandle` from the
 * result: a mesh-path output must never advertise the upstream B-rep solid as
 * its own (see clearStaleBrepHandle). Exception: an isNoOp fallback returned
 * the input UNCHANGED, so an existing handle still matches the mesh and is
 * kept.
 */
export function noteMeshFallback(
  geometry: THREE.BufferGeometry,
  args: { op: string; engine?: number; featureId?: string; isNoOp?: boolean },
): THREE.BufferGeometry {
  if (!args.isNoOp) clearStaleBrepHandle(geometry);
  stampDowngrade(
    geometry,
    classifyMeshDowngrade({
      op: args.op,
      featureId: args.featureId,
      wantedOcct: wantsOcctEngine(args.engine),
      occtRan: false,
      isNoOp: args.isNoOp ?? false,
    }),
  );
  return geometry;
}
