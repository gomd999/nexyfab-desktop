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
import type { ReplicadLike, OcctShape, SerializedResult } from './_types.js';

export type ShellOpenFace = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

export interface ShellParams {
  host: { w: number; h: number; d: number };
  /** Wall thickness (mm). 2 * thickness must be < min(host). */
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

export async function runShell(params: ShellParams): Promise<SerializedResult> {
  await ensureOcctReady();
  const replicad = getReplicad() as ReplicadLike;

  if (!replicad.makeBaseBox) {
    throw new Error('replicad.makeBaseBox unavailable — verify WASM loaded');
  }
  const minDim = Math.min(params.host.w, params.host.h, params.host.d);
  if (params.thickness * 2 >= minDim) {
    throw new Error(
      `invalid params: thickness ${params.thickness} must satisfy 2*thickness < min(host) (${minDim})`,
    );
  }

  const host = replicad.makeBaseBox(params.host.w, params.host.h, params.host.d) as OcctShape;
  if (!host.shell) {
    throw new Error('replicad shape has no shell() method — kernel build mismatch');
  }
  const open = params.openFace ?? 'top';
  const selector = faceSelector(open, params.host);

  let shelled: OcctShape;
  try {
    // replicad shell signature: shell(thickness, faceSelector)
    shelled = host.shell(params.thickness, selector) as OcctShape;
  } catch (err) {
    throw new Error(`OCCT shell failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return serializeShape(replicad, shelled);
}
