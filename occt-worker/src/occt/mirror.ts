/**
 * Server-side mirror op — Wave 1 W15 (ADR-007).
 *
 * Reflects a primitive box across one of the three principal planes.
 * Standalone use is limited (a mirrored box is identical to the
 * original); the real value is as a chainable op once boolean / cut
 * accept R2-imported shapes as input (W12+ chained-op surface).
 *
 * replicad's `mirror` API signature varies between releases — some
 * builds take a plane object, others take `(plane, copy?)` with the
 * axis as a string. We probe both call shapes and surface a clean
 * error if neither works.
 */

import { ensureOcctReady, getReplicad } from './lifecycle.js';
import { serializeShape } from './_serialize.js';
import { resolveShape, type OpContext } from './_input.js';
import type { ReplicadLike, OcctShape, SerializedResult } from './_types.js';

export type MirrorPlane = 'XY' | 'YZ' | 'XZ';

export interface MirrorParams {
  /** Primitive box host. Exactly one of host or sourceR2Key required. */
  host?: { w: number; h: number; d: number };
  /** R2 key pointing to a STEP file (chained-op input). */
  sourceR2Key?: string;
  /** Reflection plane through origin. */
  plane: MirrorPlane;
}

function tryMirror(shape: OcctShape, plane: MirrorPlane): OcctShape | null {
  if (!shape.mirror) return null;
  // Try replicad v0.23+ string-plane call: shape.mirror('XY')
  try {
    const r1 = shape.mirror(plane);
    if (r1 && typeof r1 === 'object') return r1 as OcctShape;
  } catch {
    // Fall through to alternate signature.
  }
  // Try plane-as-axis-vector call: shape.mirror([0,0,1]) for XY etc.
  const axis: [number, number, number] =
    plane === 'XY' ? [0, 0, 1] :
    plane === 'YZ' ? [1, 0, 0] :
    /* XZ */         [0, 1, 0];
  try {
    const r2 = shape.mirror(axis, [0, 0, 0]);
    if (r2 && typeof r2 === 'object') return r2 as OcctShape;
  } catch {
    // Fall through.
  }
  return null;
}

export async function runMirror(params: MirrorParams, ctx: OpContext): Promise<SerializedResult> {
  await ensureOcctReady();
  const replicad = getReplicad() as ReplicadLike;

  const host = await resolveShape(replicad, params, ctx.userId);
  const mirrored = tryMirror(host, params.plane);
  if (!mirrored) {
    throw new Error(
      `OCCT mirror failed: replicad shape has no compatible mirror() signature (tried string and axis-vector forms)`,
    );
  }
  return serializeShape(replicad, mirrored);
}
