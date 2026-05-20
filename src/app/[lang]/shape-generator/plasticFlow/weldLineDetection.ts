/**
 * weldLineDetection.ts — Detect weld lines + air traps.
 *
 * When the flow front from two directions meets, it forms a
 * "weld line" — a visible mark on the surface that's also a
 * mechanical weak point. Air traps form where the last region to
 * fill has no vent, leaving compressed air → burn marks.
 *
 * Detection heuristics (post-fill simulation):
 *   - **Weld line**: an edge whose two endpoints have nearly-equal
 *     fill times AND opposite flow-front directions. The closer
 *     the fill times, the more visible the weld.
 *   - **Air trap**: a local maximum of fill time — every neighbor
 *     fills earlier.
 */

import type { FlowMesh, FillResult } from './fillSimulation';

export interface WeldLineEdge {
  v0: number;
  v1: number;
  /** Convergence intensity (0..1, higher = more visible weld). */
  intensity: number;
}

export interface AirTrap {
  vertex: number;
  /** Fill time at this trap. */
  fillTimeSec: number;
}

const WELD_TIME_TOLERANCE = 0.1; // seconds — flow fronts within 100ms

/** Detect weld lines: edges where both ends fill at nearly equal time. */
export function detectWeldLines(
  mesh: FlowMesh,
  fill: FillResult,
  toleranceSec: number = WELD_TIME_TOLERANCE,
): WeldLineEdge[] {
  const out: WeldLineEdge[] = [];
  const seen = new Set<string>();
  for (let v = 0; v < mesh.vertices.length; v++) {
    for (const nb of mesh.adjacency[v]!) {
      if (v >= nb) continue;
      const key = `${v}|${nb}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const t0 = fill.fillTimes[v]!;
      const t1 = fill.fillTimes[nb]!;
      const delta = Math.abs(t0 - t1);
      // Weld line: equal fill time at both ends → flow fronts met here.
      if (delta < toleranceSec) {
        // Check if this is actually a meeting point: if the gate is
        // closer to one direction, both ends should have ≈ same time.
        // Heuristic: intensity = exp(-delta/tol).
        const intensity = Math.exp(-delta / toleranceSec);
        // Only emit when both vertices are not the gate itself.
        if (t0 > toleranceSec && t1 > toleranceSec) {
          out.push({ v0: v, v1: nb, intensity });
        }
      }
    }
  }
  return out;
}

/** Detect air traps: vertices whose fill time is a local maximum. */
export function detectAirTraps(mesh: FlowMesh, fill: FillResult): AirTrap[] {
  const out: AirTrap[] = [];
  for (let v = 0; v < mesh.vertices.length; v++) {
    const tHere = fill.fillTimes[v]!;
    if (!Number.isFinite(tHere)) continue;
    let isMax = true;
    let hasNeighbor = false;
    for (const nb of mesh.adjacency[v]!) {
      hasNeighbor = true;
      if (fill.fillTimes[nb]! > tHere) { isMax = false; break; }
    }
    if (isMax && hasNeighbor) {
      out.push({ vertex: v, fillTimeSec: tHere });
    }
  }
  return out;
}
