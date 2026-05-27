/**
 * Server-side shell op — Wave 1 W11 D3-5 (ADR-007).
 *
 * Hollows the host box: offsets all faces inward by `thickness`, then
 * removes the selected `openFace` so the result has an opening (a
 * "shelled" container).
 *
 * Open face axis values follow the +/- convention of the host's local
 * frame:
 *   'top'    = +Z face (default; a "cup" / "tray")
 *   'bottom' = -Z face (an upside-down lid)
 *   'front'  = -Y face
 *   'back'   = +Y face
 *   'left'   = -X face
 *   'right'  = +X face
 *
 * OCCT requirement: thickness * 2 < min(host) — the inward offset must
 * leave material. We pre-check and reject as 400 if violated.
 */

import { ensureOcctReady, getReplicad } from './lifecycle.js';
import { serializeShape } from './_serialize.js';
import { resolveShape, type OpContext } from './_input.js';
import type { ReplicadLike, OcctShape, SerializedResult } from './_types.js';

export type ShellOpenFace = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

export interface ShellParams {
  /** Primitive box. Exactly one of host or sourceR2Key required. */
  host?: { w: number; h: number; d: number };
  /** R2 key pointing to a STEP file (chained-op input, W16 D1-2). */
  sourceR2Key?: string;
  /** Wall thickness (mm). With host, 2 * thickness must be < min(host). */
  thickness: number;
  openFace?: ShellOpenFace;
}

interface FaceLike {
  /** True if the face's normal points in the given axis direction. */
  inPlane?: (plane: 'XY' | 'YZ' | 'XZ', offset: number) => boolean;
  /** Centre-of-mass coords for fallback when inPlane is missing. */
  center?: { x: number; y: number; z: number };
}

function faceSelector(open: ShellOpenFace, h: { w: number; h: number; d: number }):
  (face: FaceLike) => boolean
{
  // Half-extents — box is centered at origin.
  const halfW = h.w / 2, halfH = h.h / 2, halfD = h.d / 2;
  const EPS = 1e-3;
  switch (open) {
    case 'top':    return (f) => closeTo(f, 'z',  halfD, EPS);
    case 'bottom': return (f) => closeTo(f, 'z', -halfD, EPS);
    case 'front':  return (f) => closeTo(f, 'y', -halfH, EPS);
    case 'back':   return (f) => closeTo(f, 'y',  halfH, EPS);
    case 'left':   return (f) => closeTo(f, 'x', -halfW, EPS);
    case 'right':  return (f) => closeTo(f, 'x',  halfW, EPS);
  }
}

function closeTo(f: FaceLike, axis: 'x' | 'y' | 'z', target: number, eps: number): boolean {
  // Prefer inPlane if replicad exposes it (more robust to floating
  // point), fall back to center coordinate match.
  if (f.inPlane) {
    const plane = axis === 'z' ? 'XY' : axis === 'y' ? 'XZ' : 'YZ';
    return f.inPlane(plane, target);
  }
  if (f.center) {
    return Math.abs(f.center[axis] - target) < eps;
  }
  return false;
}

export async function runShell(params: ShellParams, ctx: OpContext): Promise<SerializedResult> {
  await ensureOcctReady();
  const replicad = getReplicad() as ReplicadLike;

  if (params.host) {
    const minDim = Math.min(params.host.w, params.host.h, params.host.d);
    if (params.thickness * 2 >= minDim) {
      throw new Error(
        `invalid params: thickness ${params.thickness} must satisfy 2*thickness < min(host) (${minDim})`,
      );
    }
  }

  const host = await resolveShape(replicad, params, ctx.userId);
  if (!host.shell) {
    throw new Error('replicad shape has no shell() method — kernel build mismatch');
  }
  const open = params.openFace ?? 'top';
  // Face selector uses primitive box dimensions to compute target
  // face centers. With R2 input we fall back to a "match by name"
  // attempt via inPlane only — the centre-based fallback can't work
  // without dimensions, so it just rejects all faces and replicad
  // surfaces the kernel error if no face matched.
  const hostBox = params.host ?? { w: 0, h: 0, d: 0 };
  const selector = faceSelector(open, hostBox);

  let shelled: OcctShape;
  try {
    // replicad shell signature: shell(thickness, faceSelector)
    shelled = host.shell(params.thickness, selector) as OcctShape;
  } catch (err) {
    throw new Error(`OCCT shell failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return serializeShape(replicad, shelled);
}
