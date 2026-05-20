/**
 * fillSimulation.ts — Approximate injection mold fill simulation.
 *
 * Full Moldflow uses 2.5D / 3D FEA with non-Newtonian viscosity
 * equations. NexyFab provides a *preview-grade* estimator that
 * runs in the browser:
 *
 *   1. Build a vertex-to-vertex graph weighted by edge length.
 *   2. From the gate vertex, run Dijkstra-equivalent shortest-path
 *      to get a "fill distance" for every vertex.
 *   3. Convert distance → fill time using a flow-front velocity.
 *
 * Result: each vertex carries a fill time (seconds) the renderer
 * heat-maps. The user spots far-from-gate regions that fill last
 * and may need a vent / second gate.
 */

export interface FlowMesh {
  vertices: ReadonlyArray<[number, number, number]>;
  /** Vertex adjacency — each entry lists neighbor vertex indices. */
  adjacency: ReadonlyArray<number[]>;
}

export interface FillParams {
  /** Gate vertex index (where the plastic enters). */
  gateVertex: number;
  /** Flow-front velocity (mm/s) — depends on viscosity + pressure. */
  flowVelocityMmS: number;
}

export interface FillResult {
  /** Per-vertex fill distance from the gate (mm). */
  distances: number[];
  /** Per-vertex fill time (s). */
  fillTimes: number[];
  /** Maximum fill time = part total cycle. */
  totalFillSec: number;
  /** Vertex index hardest to fill. */
  worstFillVertex: number;
}

/** Compute fill distance + time. Dijkstra with a binary heap would
 *  be faster; this Phase-3 starter uses a simple bucketed loop
 *  which is O(V·E). Good for < 10k vertex previews. */
export function simulateFill(mesh: FlowMesh, params: FillParams): FillResult {
  const n = mesh.vertices.length;
  const distances = new Array(n).fill(Infinity);
  distances[params.gateVertex] = 0;
  // Process queue — sorted by current distance.
  const queue = new Set<number>([params.gateVertex]);
  while (queue.size > 0) {
    // Pop the lowest-distance vertex.
    let cur = -1;
    let curDist = Infinity;
    for (const v of queue) {
      if (distances[v] < curDist) { curDist = distances[v]; cur = v; }
    }
    if (cur === -1) break;
    queue.delete(cur);
    const here = mesh.vertices[cur]!;
    for (const nb of mesh.adjacency[cur]!) {
      const there = mesh.vertices[nb]!;
      const edgeLen = Math.hypot(there[0] - here[0], there[1] - here[1], there[2] - here[2]);
      const newDist = curDist + edgeLen;
      if (newDist < distances[nb]) {
        distances[nb] = newDist;
        queue.add(nb);
      }
    }
  }

  const fillTimes = distances.map(d => d / params.flowVelocityMmS);
  let worst = 0;
  for (let i = 1; i < n; i++) {
    if (fillTimes[i] > fillTimes[worst]!) worst = i;
  }
  return {
    distances,
    fillTimes,
    totalFillSec: fillTimes[worst]!,
    worstFillVertex: worst,
  };
}

/** Color ramp for fill-time heat map. Blue (gate) → green → red (far). */
export function fillTimeColor(timeSec: number, totalSec: number): [number, number, number] {
  const t = Math.min(1, timeSec / totalSec);
  // Simple piecewise: 0 = blue, 0.5 = green, 1 = red.
  if (t < 0.5) {
    const u = t / 0.5;
    return [0, u, 1 - u];
  }
  const u = (t - 0.5) / 0.5;
  return [u, 1 - u, 0];
}

/** Default flow velocities (mm/s) by polymer. Empirical mean
 *  for general-purpose injection at typical pressures. */
export const DEFAULT_FLOW_VELOCITY: Record<string, number> = {
  ABS:      350,
  PC:       250,
  PP:       400,
  PE:       500,
  PA:       300,
  POM:      280,
  PET:      230,
  PMMA:     200,
  PEEK:     150,
  TPE:      450,
};
