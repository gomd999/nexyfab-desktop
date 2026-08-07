/**
 * occtFilletAvoidance — auto-avoidance for OCCT fillet failures (Phase 4).
 *
 * Fillet is the highest-frequency OCCT failure (radius ≥ adjacent face width,
 * tangent-edge blends, post-shell thin walls…). Instead of silently dropping
 * to the mesh approximator on the first throw, retry deterministically:
 *
 *   (a) REDUCED RADIUS — retry at 75% / 50% / 25% of the requested radius
 *       (floored at MIN_FILLET_RADIUS). Most "radius too large for the local
 *       topology" failures succeed a step or two down the ladder.
 *   (b) PER-EDGE SUBSET (async path only) — when the user picked ≥2 edges,
 *       re-resolve each selection to its own EdgeFinder and fillet the edges
 *       one at a time, skipping the ones that fail. The part keeps the
 *       requested radius on every edge the kernel CAN build.
 *
 * NEVER silent: every degraded success reports requested-vs-applied so the
 * caller stamps a 'reduced' downgrade notice (the feature node keeps showing
 * the REQUESTED params; the notice shows what was APPLIED). Every initial
 * failure is captured into the kernel corpus (kernelCorpus.ts) and the
 * record's resolution is updated with what the avoidance achieved.
 */

import type { BufferGeometry } from 'three';
import {
  occtFilletBox,
  occtEdgeSignatures,
  hostBoxFromGeometry,
  resolveBrepHostHandle,
  resolveBrepHostHandleAsync,
  type ReplicadEdgeFinder,
} from './occtEngine';
import {
  resolveEdgeFinderBySignature,
  buildEdgeFinderFromSelection,
} from './topologyEdgeFinder';
import type { EdgeSelectionInfo } from '../editing/selectionInfo';
import { captureKernelFailure, resolveKernelFailure } from './kernelCorpus';
import { requireValidBrepResult } from './kernelOperationQuality';

/** Retry ladder, as fractions of the requested radius. */
export const RADIUS_LADDER_FACTORS = [0.75, 0.5, 0.25] as const;
/** Don't bother retrying below this radius (mm) — visually meaningless. */
export const MIN_FILLET_RADIUS = 0.2;

/**
 * Concrete retry radii for a requested radius: descending, floored, deduped.
 * Pure — unit-tested headlessly.
 */
export function radiusLadder(
  requested: number,
  factors: readonly number[] = RADIUS_LADDER_FACTORS,
  floor = MIN_FILLET_RADIUS,
): number[] {
  if (!(requested > 0)) return [];
  const out: number[] = [];
  for (const f of factors) {
    const r = Math.round(requested * f * 1000) / 1000;
    if (r < floor) break;
    if (r < requested && !out.includes(r)) out.push(r);
  }
  return out;
}

export interface FilletAvoidanceAttempt {
  kind: 'requested' | 'reduced' | 'per-edge';
  radius: number;
  error: string | null;
}

export interface FilletAvoidanceResult {
  geometry: BufferGeometry;
  handle: string | null;
  /** 'requested' = no degradation; otherwise what avoidance applied. */
  strategy: 'requested' | 'reduced-radius' | 'partial-edges';
  requestedRadius: number;
  appliedRadius: number;
  /** Only set for 'partial-edges'. */
  edgesApplied?: number;
  edgesRequested?: number;
  attempts: FilletAvoidanceAttempt[];
}

interface HostBox { w: number; h: number; d: number; cx: number; cy: number; cz: number }

function tryFillet(
  host: HostBox,
  radius: number,
  hostHandle: string | null,
  edgeFinder: ReplicadEdgeFinder | undefined,
): { geometry: BufferGeometry; handle: string | null } | { error: string } {
  try {
    const r = requireValidBrepResult(occtFilletBox(host, radius, {}, hostHandle, edgeFinder));
    return { geometry: r.geometry, handle: r.handle };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Sync avoidance: requested radius, then the reduced-radius ladder.
 * Returns null when every attempt failed (caller falls back to mesh) — the
 * failure is already captured in the corpus with resolution 'mesh-fallback'.
 *
 * Host contract (fail-clean): the host handle comes from
 * resolveBrepHostHandle — a registered upstream B-rep solid, or null ONLY for
 * a verifiably-box mesh (where the box host is faithful). A handle-less
 * non-box body THROWS BrepHostUnavailableError instead of silently filleting
 * its bounding box; the caller's try/catch falls to the mesh path. Async
 * callers can pre-bridge a handle and pass it via `opts.hostHandle`.
 */
export function occtFilletWithAvoidanceSync(
  geometry: BufferGeometry,
  radius: number,
  edgeFinder: ReplicadEdgeFinder | null,
  opts: { featureId?: string; hostHandle?: string | null } = {},
): FilletAvoidanceResult | null {
  const upstreamHandle = opts.hostHandle !== undefined
    ? opts.hostHandle
    : resolveBrepHostHandle(geometry); // throws BrepHostUnavailableError — never a bbox stand-in
  const host = hostBoxFromGeometry(geometry);
  const attempts: FilletAvoidanceAttempt[] = [];

  // 1. Requested radius (the only attempt on the healthy path).
  const first = tryFillet(host, radius, upstreamHandle, edgeFinder ?? undefined);
  if (!('error' in first)) {
    return {
      geometry: first.geometry,
      handle: first.handle,
      strategy: 'requested',
      requestedRadius: radius,
      appliedRadius: radius,
      attempts: [{ kind: 'requested', radius, error: null }],
    };
  }
  attempts.push({ kind: 'requested', radius, error: first.error });
  const record = captureKernelFailure({
    op: 'fillet',
    stage: 'occt-apply',
    params: { radius, featureId: opts.featureId ?? '' },
    geometry,
    error: first.error,
  });

  // 2. Reduced-radius ladder.
  for (const r of radiusLadder(radius)) {
    const out = tryFillet(host, r, upstreamHandle, edgeFinder ?? undefined);
    if (!('error' in out)) {
      attempts.push({ kind: 'reduced', radius: r, error: null });
      resolveKernelFailure(record.id, {
        strategy: 'reduced-radius',
        requested: { radius },
        applied: { radius: r },
        detail: `radius ${radius} → ${r} mm`,
      });
      return {
        geometry: out.geometry,
        handle: out.handle,
        strategy: 'reduced-radius',
        requestedRadius: radius,
        appliedRadius: r,
        attempts,
      };
    }
    attempts.push({ kind: 'reduced', radius: r, error: out.error });
  }

  resolveKernelFailure(record.id, { strategy: 'mesh-fallback', requested: { radius } });
  return null;
}

/**
 * Async avoidance: sync ladder first; if that fails AND the user picked ≥2
 * edges, fillet the selections one at a time at the REQUESTED radius and keep
 * the subset that succeeds (cheap — reuses the existing edge-finder builders).
 */
export async function occtFilletWithAvoidanceAsync(
  geometry: BufferGeometry,
  radius: number,
  edgeFinder: ReplicadEdgeFinder | null,
  ctx: { featureId?: string; edgeSelections?: EdgeSelectionInfo[] } = {},
): Promise<FilletAvoidanceResult | null> {
  // Fail-clean host resolution with the async mesh→B-rep bridge: a handle-less
  // non-box body gets a faithful simplified B-rep imported from its mesh, or
  // this THROWS (caller falls back to mesh) — never a bbox stand-in.
  const hostHandle = await resolveBrepHostHandleAsync(geometry);
  const ladderResult = occtFilletWithAvoidanceSync(geometry, radius, edgeFinder, { ...ctx, hostHandle });
  if (ladderResult) return ladderResult;

  const sels = ctx.edgeSelections;
  if (!sels || sels.length < 2) return null;

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const currentBbox = bb
    ? { min: [bb.min.x, bb.min.y, bb.min.z] as [number, number, number], max: [bb.max.x, bb.max.y, bb.max.z] as [number, number, number] }
    : undefined;

  const host = hostBoxFromGeometry(geometry);
  let runningHandle = hostHandle;
  let runningGeometry: BufferGeometry | null = null;
  const attempts: FilletAvoidanceAttempt[] = [];
  let applied = 0;

  for (const sel of sels) {
    // Re-resolve THIS selection against the current (possibly already
    // partially-filleted) solid: signature match first, click-point fallback.
    let finder: ReplicadEdgeFinder | null = null;
    let lostReason: string | null = null;
    try {
      if (runningHandle) {
        const res = await resolveEdgeFinderBySignature(sel, occtEdgeSignatures(runningHandle), currentBbox);
        if (res.status === 'matched') finder = res.finder;
        // ⚠ 'lost' means the matcher REFUSED to identify this edge. Retrying
        // with the stale click point would just launder that refusal into a
        // silent guess (ADR-017 §D1) — skip this edge and say why instead.
        else if (res.status === 'lost') lostReason = res.reason;
      }
      if (!finder && !lostReason) finder = await buildEdgeFinderFromSelection(sel, { currentBbox });
    } catch {
      finder = null;
    }
    if (!finder) {
      attempts.push({
        kind: 'per-edge',
        radius,
        error: lostReason ? `edge reference lost (${lostReason}) — re-select this edge` : 'edge finder unresolved',
      });
      continue;
    }
    const out = tryFillet(host, radius, runningHandle, finder);
    if ('error' in out) {
      attempts.push({ kind: 'per-edge', radius, error: out.error });
      continue;
    }
    attempts.push({ kind: 'per-edge', radius, error: null });
    runningHandle = out.handle;
    runningGeometry = out.geometry;
    applied++;
  }

  if (applied === 0 || !runningGeometry) {
    // Per-edge couldn't save anything either — corpus already says mesh-fallback.
    return null;
  }

  captureKernelFailure({
    op: 'fillet',
    stage: 'occt-retry',
    params: { radius, featureId: ctx.featureId ?? '' },
    geometry,
    error: `multi-edge fillet failed; per-edge subset applied (${applied}/${sels.length})`,
    resolution: {
      strategy: 'partial-edges',
      requested: { radius, edges: sels.length },
      applied: { radius, edges: applied },
      detail: `edges ${applied}/${sels.length} @ r=${radius} mm`,
    },
    forward: false, // the initial failure was already forwarded by the sync pass
  });

  return {
    geometry: runningGeometry,
    handle: runningHandle,
    strategy: 'partial-edges',
    requestedRadius: radius,
    appliedRadius: radius,
    edgesApplied: applied,
    edgesRequested: sels.length,
    attempts,
  };
}
