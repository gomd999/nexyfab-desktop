/**
 * Server-side chamfer op — Wave 1 W11 D3-5 (ADR-007).
 *
 * Bevels edges of the host box by `distance`. Same edge-scope vocabulary
 * as fillet (all / vertical / top / bottom).
 *
 * The OCCT distance limit is the same as fillet: distance < min(host)/2.
 * Beyond that, BRepFilletAPI_MakeChamfer throws and we'd surface an
 * opaque kernel error — we pre-check for a clean 400.
 */

import { ensureOcctReady, getReplicad } from './lifecycle.js';
import { serializeShape } from './_serialize.js';
import type { ReplicadLike, OcctShape, SerializedResult } from './_types.js';

export type ChamferEdgeScope = 'all' | 'vertical' | 'top' | 'bottom';

export interface ChamferParams {
  host: { w: number; h: number; d: number };
  /** Bevel distance (mm) from the edge. */
  distance: number;
  edges?: ChamferEdgeScope;
}

interface EdgeLike {
  inDirection?: (axis: 'X' | 'Y' | 'Z') => boolean;
  atZ?: (z: number) => boolean;
}

function edgeSelector(scope: ChamferEdgeScope, hostD: number): (edge: EdgeLike) => boolean {
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

export async function runChamfer(params: ChamferParams): Promise<SerializedResult> {
  await ensureOcctReady();
  const replicad = getReplicad() as ReplicadLike;

  if (!replicad.makeBaseBox) {
    throw new Error('replicad.makeBaseBox unavailable — verify WASM loaded');
  }
  const minDim = Math.min(params.host.w, params.host.h, params.host.d);
  if (params.distance >= minDim / 2) {
    throw new Error(
      `invalid params: distance ${params.distance} must be < min(host)/2 (${minDim / 2})`,
    );
  }

  const host = replicad.makeBaseBox(params.host.w, params.host.h, params.host.d) as OcctShape;
  if (!host.chamfer) {
    throw new Error('replicad shape has no chamfer() method — kernel build mismatch');
  }
  const scope = params.edges ?? 'all';
  const selector = edgeSelector(scope, params.host.d);

  let chamfered: OcctShape;
  try {
    chamfered = host.chamfer(params.distance, selector) as OcctShape;
  } catch (err) {
    throw new Error(`OCCT chamfer failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return serializeShape(replicad, chamfered);
}
