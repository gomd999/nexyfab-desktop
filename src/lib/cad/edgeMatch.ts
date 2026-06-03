/**
 * edgeMatch — geometric correspondence between a stable name's anchor point and
 * a kernel's re-indexed edges (K3 of ADR-014).
 *
 * topoNaming gives every edge a name that survives a rebuild (`e.vert.0`, …).
 * A kernel (OCCT) re-enumerates its edges in its own arbitrary order on every
 * rebuild, so to actually fillet "the edge named e.vert.0" we resolve the name
 * to its 3D midpoint (topoNaming.edgeMidpoint) and then find the kernel edge
 * whose midpoint coincides. This module is the pure, kernel-agnostic matcher;
 * the OCCT bridge supplies the kernel-edge midpoints.
 */

import type { Vec3 } from '@/lib/sketch/sketchPlane';
import { sub, lengthOf } from '@/lib/sketch/sketchPlane';

export interface EdgeMatch {
  /** Index into the candidate list, or -1 if none within tolerance. */
  index: number;
  /** Distance from the target to the matched candidate's midpoint. */
  dist: number;
}

/**
 * Nearest candidate midpoint to `target`. Returns the closest index together
 * with its distance; callers gate on `tol` to reject a non-match.
 */
export function nearestByMidpoint(mids: ReadonlyArray<Vec3>, target: Vec3, tol = 1e-6): EdgeMatch {
  let index = -1;
  let dist = Infinity;
  for (let i = 0; i < mids.length; i++) {
    const d = lengthOf(sub(mids[i], target));
    if (d < dist) {
      dist = d;
      index = i;
    }
  }
  return index >= 0 && dist <= tol ? { index, dist } : { index: -1, dist };
}
