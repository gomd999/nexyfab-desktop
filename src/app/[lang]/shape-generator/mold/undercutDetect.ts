/**
 * undercutDetect.ts — Locate features that block mold opening.
 *
 * An undercut is geometry that "looks behind" relative to the
 * pull direction — for example, a snap-fit hook, an internal
 * groove, or a hole perpendicular to pull. Detecting these tells
 * the designer they need a slide / lifter mechanism or a redesign.
 *
 * Algorithm:
 *   1. Get every triangle with negative draft.
 *   2. Cluster contiguous negative-draft triangles by shared edge.
 *   3. Each cluster = one undercut region.
 *   4. For each region: bounding box, area, depth, suggested
 *      remedy (slide axis or design change).
 */

import type { MoldMesh, MoldTriangle } from './partingLine';
import { analyzeDraft } from './draftAnalysis';

export interface UndercutRegion {
  /** Triangle indices in this region. */
  triangleIndices: number[];
  /** Bounding box of the region's vertices. */
  bbox: { min: [number, number, number]; max: [number, number, number] };
  /** Estimated surface area (mm²). */
  areaMm2: number;
  /** Recommended slide direction (unit vector). */
  slideDirection: [number, number, number];
  /** Severity hint based on region size. */
  severity: 'minor' | 'moderate' | 'severe';
}

function triangleArea(
  v0: [number, number, number],
  v1: [number, number, number],
  v2: [number, number, number],
): number {
  const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
  const cross = [
    e1[1]! * e2[2]! - e1[2]! * e2[1]!,
    e1[2]! * e2[0]! - e1[0]! * e2[2]!,
    e1[0]! * e2[1]! - e1[1]! * e2[0]!,
  ];
  return Math.hypot(cross[0]!, cross[1]!, cross[2]!) / 2;
}

/** Run the undercut detector. */
export function detectUndercuts(
  mesh: MoldMesh,
  pullDirection: [number, number, number] = [0, 0, 1],
): UndercutRegion[] {
  const draft = analyzeDraft(mesh, pullDirection);
  // Index of negative-draft triangles.
  const negativeIdx: number[] = [];
  draft.classes.forEach((c, i) => { if (c === 'negative') negativeIdx.push(i); });
  if (negativeIdx.length === 0) return [];

  // Build edge → triangle map for adjacency.
  const edgeToTris = new Map<string, number[]>();
  mesh.triangles.forEach((t, i) => {
    const [a, b, c] = t.indices;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      const key = u < v ? `${u}|${v}` : `${v}|${u}`;
      if (!edgeToTris.has(key)) edgeToTris.set(key, []);
      edgeToTris.get(key)!.push(i);
    }
  });

  // Build adjacency-only-within-negatives map.
  const neighbors = new Map<number, number[]>();
  for (const ti of negativeIdx) {
    const tri = mesh.triangles[ti]!;
    const [a, b, c] = tri.indices;
    const nbs: number[] = [];
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      const key = u < v ? `${u}|${v}` : `${v}|${u}`;
      for (const ot of edgeToTris.get(key) ?? []) {
        if (ot !== ti && draft.classes[ot] === 'negative') nbs.push(ot);
      }
    }
    neighbors.set(ti, nbs);
  }

  // BFS clustering.
  const visited = new Set<number>();
  const regions: UndercutRegion[] = [];
  for (const start of negativeIdx) {
    if (visited.has(start)) continue;
    const cluster: number[] = [];
    const stack = [start];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      cluster.push(cur);
      for (const nb of neighbors.get(cur) ?? []) {
        if (!visited.has(nb)) stack.push(nb);
      }
    }
    regions.push(buildRegion(mesh, cluster));
  }
  return regions;
}

function buildRegion(mesh: MoldMesh, triangleIndices: number[]): UndercutRegion {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let totalArea = 0;
  let normalSum: [number, number, number] = [0, 0, 0];
  for (const ti of triangleIndices) {
    const tri = mesh.triangles[ti]!;
    const [ia, ib, ic] = tri.indices;
    const va = mesh.vertices[ia]!;
    const vb = mesh.vertices[ib]!;
    const vc = mesh.vertices[ic]!;
    for (const v of [va, vb, vc]) {
      if (v[0] < min[0]) min[0] = v[0];
      if (v[1] < min[1]) min[1] = v[1];
      if (v[2] < min[2]) min[2] = v[2];
      if (v[0] > max[0]) max[0] = v[0];
      if (v[1] > max[1]) max[1] = v[1];
      if (v[2] > max[2]) max[2] = v[2];
    }
    totalArea += triangleArea(va, vb, vc);
    normalSum = [
      normalSum[0] + tri.normal[0],
      normalSum[1] + tri.normal[1],
      normalSum[2] + tri.normal[2],
    ];
  }
  const nLen = Math.hypot(...normalSum) || 1;
  const slideDirection: [number, number, number] = [
    normalSum[0] / nLen,
    normalSum[1] / nLen,
    normalSum[2] / nLen,
  ];
  const severity: UndercutRegion['severity'] =
    totalArea < 50 ? 'minor' :
    totalArea < 500 ? 'moderate' : 'severe';
  return {
    triangleIndices,
    bbox: { min, max },
    areaMm2: totalArea,
    slideDirection,
    severity,
  };
}
