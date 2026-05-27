/**
 * Server-side fillet op — Wave 1 W11 D3-5 (ADR-007).
 *
 * Rounds edges of the host box by `radius`. Edge selection scope:
 *
 *   'all'      → every edge (default; turns a box into a rounded brick)
 *   'vertical' → edges parallel to Z (typical UI "round the 4 corners")
 *   'top'      → edges at the +Z face only (lid rounding)
 *   'bottom'   → edges at the -Z face only
 *
 * The selector closure is fed to replicad's fillet(radius, edgeFinder)
 * signature; defensive `() => true` fallback covers replicad builds
 * that ignore the second arg.
 *
 * W16 D1-2: now accepts `sourceR2Key` as an alternative to `host` for
 * chained-op workflows. When R2 input is used, the min(host)/2 radius
 * pre-check is skipped (dimensions unknown until kernel import); a
 * bad radius surfaces as a kernel error → 500 instead of 400, which
 * the client-side fallback chain handles.
 */

import { ensureOcctReady, getReplicad } from './lifecycle.js';
import { serializeShape } from './_serialize.js';
import { resolveShape, type OpContext } from './_input.js';
import type { ReplicadLike, OcctShape, SerializedResult } from './_types.js';

export type FilletEdgeScope = 'all' | 'vertical' | 'top' | 'bottom';

export interface FilletParams {
  /** Primitive box. Exactly one of host or sourceR2Key required. */
  host?: { w: number; h: number; d: number };
  /** R2 key pointing to a STEP file (chained-op input). */
  sourceR2Key?: string;
  /** Edge rounding radius (mm). With host, must be < min(host)/2. */
  radius: number;
  edges?: FilletEdgeScope;
}

/** Edge surrogate used by the selector closure. replicad exposes
 *  geometric helpers (`inDirection`, `atZ`, etc.); we duck-type only
 *  what we need. */
interface EdgeLike {
  inDirection?: (axis: 'X' | 'Y' | 'Z') => boolean;
  atZ?: (z: number) => boolean;
}

function edgeSelector(scope: FilletEdgeScope, hostD: number): (edge: EdgeLike) => boolean {
  switch (scope) {
    case 'vertical':
      return (e) => (e.inDirection ? e.inDirection('Z') : true);
    case 'top':
      return (e) => (e.atZ ? e.atZ(hostD / 2) : true);
    case 'bottom':
      return (e) => (e.atZ ? e.atZ(-hostD / 2) : true);
    case 'all':
    default:
      return () => true;
  }
}

export async function runFillet(params: FilletParams, ctx: OpContext): Promise<SerializedResult> {
  await ensureOcctReady();
  const replicad = getReplicad() as ReplicadLike;

  // Pre-check is only valid when host dimensions are known. R2 input
  // shapes lose this guard — bad radius surfaces as kernel error later.
  if (params.host) {
    const minDim = Math.min(params.host.w, params.host.h, params.host.d);
    if (params.radius >= minDim / 2) {
      throw new Error(
        `invalid params: radius ${params.radius} must be < min(host)/2 (${minDim / 2})`,
      );
    }
  }

  const host = await resolveShape(replicad, params, ctx.userId);
  if (!host.fillet) {
    throw new Error('replicad shape has no fillet() method — kernel build mismatch');
  }
  const scope = params.edges ?? 'all';
  // Selector uses host depth for the top/bottom face Z target; with
  // R2 input we fall back to "any edge" since dimensions are unknown.
  const hostD = params.host?.d ?? 0;
  const selector = edgeSelector(scope, hostD);

  let filleted: OcctShape;
  try {
    // Some replicad versions take (radius, selector); others take
    // just (radius). Call with both — extra arg is harmless on the
    // single-arity path.
    filleted = host.fillet(params.radius, selector) as OcctShape;
  } catch (err) {
    throw new Error(`OCCT fillet failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return serializeShape(replicad, filleted);
}
