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
 * Scope match to W11: input is a primitive box, not yet a R2-imported
 * STEP shape. Chaining with prior op outputs (boolean → fillet) lands
 * in W12 when the worker accepts `sourceR2Key` as an alternative input.
 */

import { ensureOcctReady, getReplicad } from './lifecycle.js';
import { serializeShape } from './_serialize.js';
import type { ReplicadLike, OcctShape, SerializedResult } from './_types.js';

export type FilletEdgeScope = 'all' | 'vertical' | 'top' | 'bottom';

export interface FilletParams {
  host: { w: number; h: number; d: number };
  /** Edge rounding radius (mm). Must be < min(host)/2 or OCCT refuses. */
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

export async function runFillet(params: FilletParams): Promise<SerializedResult> {
  await ensureOcctReady();
  const replicad = getReplicad() as ReplicadLike;

  if (!replicad.makeBaseBox) {
    throw new Error('replicad.makeBaseBox unavailable — verify WASM loaded');
  }
  // OCCT guards: radius must fit inside the box, else fillet fails
  // with an opaque "edge cannot be filleted" kernel error. Pre-check
  // gives a clean 400.
  const minDim = Math.min(params.host.w, params.host.h, params.host.d);
  if (params.radius >= minDim / 2) {
    throw new Error(
      `invalid params: radius ${params.radius} must be < min(host)/2 (${minDim / 2})`,
    );
  }

  const host = replicad.makeBaseBox(params.host.w, params.host.h, params.host.d) as OcctShape;
  if (!host.fillet) {
    throw new Error('replicad shape has no fillet() method — kernel build mismatch');
  }
  const scope = params.edges ?? 'all';
  const selector = edgeSelector(scope, params.host.d);

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
