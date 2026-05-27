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
import { resolveShape, type OpContext } from './_input.js';
import type { ReplicadLike, OcctShape, SerializedResult } from './_types.js';

export type ChamferEdgeScope = 'all' | 'vertical' | 'top' | 'bottom';

export interface ChamferParams {
  /** Primitive box. Exactly one of host or sourceR2Key required. */
  host?: { w: number; h: number; d: number };
  /** R2 key pointing to a STEP file (chained-op input, W16 D1-2). */
  sourceR2Key?: string;
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

export async function runChamfer(params: ChamferParams, ctx: OpContext): Promise<SerializedResult> {
  await ensureOcctReady();
  const replicad = getReplicad() as ReplicadLike;

  if (params.host) {
    const minDim = Math.min(params.host.w, params.host.h, params.host.d);
    if (params.distance >= minDim / 2) {
      throw new Error(
        `invalid params: distance ${params.distance} must be < min(host)/2 (${minDim / 2})`,
      );
    }
  }

  const host = await resolveShape(replicad, params, ctx.userId);
  if (!host.chamfer) {
    throw new Error('replicad shape has no chamfer() method — kernel build mismatch');
  }
  const scope = params.edges ?? 'all';
  const hostD = params.host?.d ?? 0;
  const selector = edgeSelector(scope, hostD);

  let chamfered: OcctShape;
  try {
    chamfered = host.chamfer(params.distance, selector) as OcctShape;
  } catch (err) {
    throw new Error(`OCCT chamfer failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return serializeShape(replicad, chamfered);
}
