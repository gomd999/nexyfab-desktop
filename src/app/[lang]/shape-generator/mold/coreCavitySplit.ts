/**
 * coreCavitySplit.ts — Split a moldable part into core + cavity.
 *
 * Given a mesh + parting line, build two derived meshes:
 *   - **Cavity** (outside of the part, top half of mold)
 *   - **Core** (inside the protrusions, bottom half)
 *
 * Approach (Phase-3 starter): tag each triangle by which side of
 * the parting plane it sits on, then assign to core or cavity.
 * The actual mold "block" geometry (the surrounding cube the
 * cavity is cut from) is a follow-up — this module just classifies
 * the part surface.
 */

import type { MoldMesh, MoldTriangle } from './partingLine';

export type MoldHalf = 'core' | 'cavity' | 'parting';

export interface CoreCavityResult {
  /** Per-triangle assignment. */
  assignment: MoldHalf[];
  /** Triangles forming the cavity (top half). */
  cavityTriangles: MoldTriangle[];
  /** Triangles forming the core (bottom half). */
  coreTriangles: MoldTriangle[];
  /** Triangles on the parting line itself. */
  partingTriangles: MoldTriangle[];
}

function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Split a part's triangles by parting plane direction. */
export function splitCoreCavity(
  mesh: MoldMesh,
  pullDirection: [number, number, number] = [0, 0, 1],
  zeroToleranceDeg: number = 1,
): CoreCavityResult {
  const len = Math.hypot(...pullDirection) || 1;
  const pull: [number, number, number] = [
    pullDirection[0] / len,
    pullDirection[1] / len,
    pullDirection[2] / len,
  ];
  const zeroCos = Math.sin(zeroToleranceDeg * Math.PI / 180);

  const assignment: MoldHalf[] = [];
  const cavityTriangles: MoldTriangle[] = [];
  const coreTriangles: MoldTriangle[] = [];
  const partingTriangles: MoldTriangle[] = [];

  for (const tri of mesh.triangles) {
    const d = dot3(tri.normal, pull);
    if (Math.abs(d) <= zeroCos) {
      assignment.push('parting');
      partingTriangles.push(tri);
    } else if (d > 0) {
      assignment.push('cavity');
      cavityTriangles.push(tri);
    } else {
      assignment.push('core');
      coreTriangles.push(tri);
    }
  }

  return { assignment, cavityTriangles, coreTriangles, partingTriangles };
}

/** Build the mold "block" — a cube enclosing the part — and
 *  subtract the part to leave the cavity. Returns the resulting
 *  triangle mesh as two halves. Phase-3 placeholder: returns
 *  block dimensions only. */
export interface MoldBlock {
  topHalf: { min: [number, number, number]; max: [number, number, number] };
  bottomHalf: { min: [number, number, number]; max: [number, number, number] };
  partingZ: number;
}

export function buildMoldBlock(
  mesh: MoldMesh,
  pullDirection: [number, number, number] = [0, 0, 1],
  /** Mold block clearance around the part (mm). */
  clearanceMm: number = 50,
): MoldBlock | null {
  if (mesh.vertices.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const v of mesh.vertices) {
    if (v[0] < min[0]) min[0] = v[0];
    if (v[1] < min[1]) min[1] = v[1];
    if (v[2] < min[2]) min[2] = v[2];
    if (v[0] > max[0]) max[0] = v[0];
    if (v[1] > max[1]) max[1] = v[1];
    if (v[2] > max[2]) max[2] = v[2];
  }
  // Expand by clearance.
  const blockMin: [number, number, number] = [min[0] - clearanceMm, min[1] - clearanceMm, min[2] - clearanceMm];
  const blockMax: [number, number, number] = [max[0] + clearanceMm, max[1] + clearanceMm, max[2] + clearanceMm];

  // Determine parting axis based on pullDirection's dominant component.
  const absD = [Math.abs(pullDirection[0]), Math.abs(pullDirection[1]), Math.abs(pullDirection[2])];
  const axis = absD.indexOf(Math.max(...absD));
  // Parting at the midpoint along that axis.
  const partingValue = (min[axis] + max[axis]) / 2;
  void axis; void partingValue;

  return {
    topHalf:    { min: [blockMin[0], blockMin[1], partingValue], max: blockMax },
    bottomHalf: { min: blockMin, max: [blockMax[0], blockMax[1], partingValue] },
    partingZ: partingValue,
  };
}
