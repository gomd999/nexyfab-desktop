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

export type DowngradeSeverity = 'blocked' | 'approximated';

export interface MeshDowngradeNotice {
  /** The feature operation that downgraded (display label). */
  op: string;
  /** Feature instance id, when known (for click-to-locate in the tree). */
  featureId?: string;
  /** 'blocked' = no usable result (hard); 'approximated' = faceted, not exact. */
  severity: DowngradeSeverity;
  /** Translation key for the UI layer. */
  i18nKey: string;
  /** Best-effort English fallback. */
  fallbackMessage: string;
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
 * Stamp a downgrade notice onto a geometry's userData side-channel so the
 * pipeline can collect it. Accumulates (a feature pipeline can downgrade more
 * than once); no-ops on a null notice for call-site convenience.
 */
export function stampDowngrade(
  geometry: THREE.BufferGeometry,
  notice: MeshDowngradeNotice | null,
): void {
  if (!notice) return;
  const list = (geometry.userData[USERDATA_KEY] as MeshDowngradeNotice[] | undefined) ?? [];
  list.push(notice);
  geometry.userData[USERDATA_KEY] = list;
}

/** Read back the downgrade notices accumulated on a geometry (never null). */
export function collectDowngrades(geometry: THREE.BufferGeometry): MeshDowngradeNotice[] {
  return (geometry.userData[USERDATA_KEY] as MeshDowngradeNotice[] | undefined) ?? [];
}

/** True if any stamped downgrade is hard (blocked) rather than a soft approximation. */
export function hasBlockingDowngrade(geometry: THREE.BufferGeometry): boolean {
  return collectDowngrades(geometry).some((n) => n.severity === 'blocked');
}
