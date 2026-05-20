/**
 * surfaceFillet.ts — G1-continuous blend along a shared edge.
 *
 * Two surfaces meeting at an edge produce a sharp crease. A
 * "surface fillet" replaces the crease with a smooth rolling-ball
 * fillet — like dragging a sphere of radius R along the edge so it
 * touches both surfaces.
 *
 * This module computes the *blend strip* — a thin Coons-like patch
 * whose two long edges sit tangent to the parent surfaces. Output
 * is a triangle mesh suitable for stitching into the knit shell.
 *
 * Constraint: G1 continuity (tangent plane match). C0 (positional)
 * only would still leave a visible crease. We approximate G1 by
 * computing per-station tangent vectors from each parent surface
 * and using them as control directions for a cubic-Bezier
 * cross-section.
 */

import type { PatchPoint } from './coonsPatch';

export interface BlendStation {
  /** Point on surface A at this station along the edge. */
  pointA: PatchPoint;
  /** Point on surface B at this station along the edge. */
  pointB: PatchPoint;
  /** Tangent direction on surface A (out of fillet, into A). */
  tangentA: PatchPoint;
  /** Tangent direction on surface B. */
  tangentB: PatchPoint;
}

export interface SurfaceFilletInput {
  /** Stations sampled along the shared edge — ≥ 2 needed. */
  stations: BlendStation[];
  /** Number of cross-section samples (more = smoother fillet). */
  crossSamples?: number;
  /** Bias of the fillet center between the two surfaces (0 = A, 1 = B, 0.5 = mid). */
  centerBias?: number;
}

export interface FilletMesh {
  positions: number[];
  indices: number[];
  uvs: number[];
}

function lerpP(a: PatchPoint, b: PatchPoint, t: number): PatchPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function bezier3(p0: PatchPoint, p1: PatchPoint, p2: PatchPoint, p3: PatchPoint, t: number): PatchPoint {
  const it = 1 - t;
  return {
    x: it ** 3 * p0.x + 3 * it ** 2 * t * p1.x + 3 * it * t ** 2 * p2.x + t ** 3 * p3.x,
    y: it ** 3 * p0.y + 3 * it ** 2 * t * p1.y + 3 * it * t ** 2 * p2.y + t ** 3 * p3.y,
    z: it ** 3 * p0.z + 3 * it ** 2 * t * p1.z + 3 * it * t ** 2 * p2.z + t ** 3 * p3.z,
  };
}

/** Compute the fillet's cross-section curve at a single station. */
function crossSectionAt(station: BlendStation, samples: number, centerBias: number): PatchPoint[] {
  // P0 = A point, P3 = B point. P1, P2 = control points pulled along
  // each surface's tangent so the cross-section meets G1.
  const p0 = station.pointA;
  const p3 = station.pointB;
  // Effective chord between A and B.
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y, p3.z - p0.z);
  const handleLen = chord * 0.55; // approximate G1 round arc
  const p1 = {
    x: p0.x + station.tangentA.x * handleLen,
    y: p0.y + station.tangentA.y * handleLen,
    z: p0.z + station.tangentA.z * handleLen,
  };
  const p2 = {
    x: p3.x + station.tangentB.x * handleLen,
    y: p3.y + station.tangentB.y * handleLen,
    z: p3.z + station.tangentB.z * handleLen,
  };
  // Bias the curve toward A or B by re-aiming center handles.
  if (centerBias !== 0.5) {
    const mid = lerpP(p0, p3, centerBias);
    p1.x = lerpP(p1, mid, 0.3).x;
    p1.y = lerpP(p1, mid, 0.3).y;
    p1.z = lerpP(p1, mid, 0.3).z;
    p2.x = lerpP(p2, mid, 0.3).x;
    p2.y = lerpP(p2, mid, 0.3).y;
    p2.z = lerpP(p2, mid, 0.3).z;
  }
  const cross: PatchPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    cross.push(bezier3(p0, p1, p2, p3, i / samples));
  }
  return cross;
}

/** Build the fillet strip mesh. */
export function buildSurfaceFillet(input: SurfaceFilletInput): FilletMesh {
  const samples = input.crossSamples ?? 8;
  const bias = input.centerBias ?? 0.5;
  if (input.stations.length < 2) return { positions: [], indices: [], uvs: [] };

  const positions: number[] = [];
  const uvs: number[] = [];
  const stationCount = input.stations.length;
  for (let s = 0; s < stationCount; s++) {
    const cross = crossSectionAt(input.stations[s]!, samples, bias);
    for (let k = 0; k <= samples; k++) {
      const p = cross[k]!;
      positions.push(p.x, p.y, p.z);
      uvs.push(k / samples, s / (stationCount - 1));
    }
  }

  // Triangulate the strip.
  const indices: number[] = [];
  const cols = samples + 1;
  for (let s = 0; s < stationCount - 1; s++) {
    for (let k = 0; k < samples; k++) {
      const a = s * cols + k;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return { positions, indices, uvs };
}
