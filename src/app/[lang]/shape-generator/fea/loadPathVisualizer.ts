/**
 * loadPathVisualizer.ts — Trace and visualise the load path through
 * an FEA-meshed structure.
 *
 * For a static structural analysis, the load path is the sequence of
 * elements through which the maximum principal stress flows from
 * applied load to reaction. Useful for:
 *
 *   - Topology optimisation seed.
 *   - Identifying redundant material (off-load-path → low stress).
 *   - Finding weakest link.
 *
 * Module:
 *   - Takes FEA element stresses.
 *   - Walks from a starting node toward the support, choosing
 *     element neighbours by maximum stress flow.
 *   - Returns the load-path polyline + redundancy regions.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface FeaElement {
  id: string;
  /** Nodal centroid. */
  centroid: Vec3;
  /** Maximum principal stress (MPa). */
  vonMisesMpa: number;
  /** Node IDs that compose this element. */
  nodeIds: string[];
}

export interface BoundaryCondition {
  /** Where the load is applied. */
  loadAppliedAt: string;
  /** Node IDs that are supports. */
  supportNodeIds: string[];
}

export interface LoadPathOptions {
  /** Max path length to trace. */
  maxSteps: number;
  /** Fraction of path-element stress below which element is "redundant". */
  redundancyThreshold: number;
}

export const DEFAULT_OPTIONS: LoadPathOptions = {
  maxSteps: 100,
  redundancyThreshold: 0.2,
};

export interface LoadPathResult {
  pathElementIds: string[];
  pathStresses: number[];
  /** Elements considered redundant (low-stress, off-path). */
  redundantElementIds: string[];
  /** Whether the path reached a support. */
  reachedSupport: boolean;
}

// ── Top-level entry ────────────────────────────────────────────

export function traceLoadPath(
  elements: FeaElement[],
  bc: BoundaryCondition,
  options: Partial<LoadPathOptions> = {},
): LoadPathResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (elements.length === 0) {
    return { pathElementIds: [], pathStresses: [], redundantElementIds: [], reachedSupport: false };
  }
  const adjacency = buildAdjacency(elements);
  // Find starting element: contains load-applied node.
  const startElem = elements.find(e => e.nodeIds.includes(bc.loadAppliedAt));
  if (!startElem) {
    return { pathElementIds: [], pathStresses: [], redundantElementIds: [], reachedSupport: false };
  }
  const pathIds: string[] = [startElem.id];
  const pathStress: number[] = [startElem.vonMisesMpa];
  const visited = new Set<string>([startElem.id]);
  let current = startElem;
  let reached = false;

  for (let step = 0; step < opts.maxSteps; step++) {
    if (current.nodeIds.some(n => bc.supportNodeIds.includes(n))) {
      reached = true;
      break;
    }
    const neighbours = (adjacency.get(current.id) ?? []).filter(id => !visited.has(id));
    if (neighbours.length === 0) break;
    // Pick neighbour with highest stress.
    let bestId: string | null = null;
    let bestStress = -Infinity;
    for (const id of neighbours) {
      const e = elements.find(x => x.id === id);
      if (!e) continue;
      if (e.vonMisesMpa > bestStress) {
        bestStress = e.vonMisesMpa;
        bestId = id;
      }
    }
    if (!bestId) break;
    const next = elements.find(e => e.id === bestId)!;
    pathIds.push(next.id);
    pathStress.push(next.vonMisesMpa);
    visited.add(next.id);
    current = next;
  }

  // Mark redundant elements.
  const pathStressMean = pathStress.reduce((s, v) => s + v, 0) / Math.max(1, pathStress.length);
  const redundant: string[] = [];
  const pathSet = new Set(pathIds);
  for (const e of elements) {
    if (pathSet.has(e.id)) continue;
    if (e.vonMisesMpa < pathStressMean * opts.redundancyThreshold) {
      redundant.push(e.id);
    }
  }

  return {
    pathElementIds: pathIds,
    pathStresses: pathStress,
    redundantElementIds: redundant,
    reachedSupport: reached,
  };
}

function buildAdjacency(elements: FeaElement[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of elements) adj.set(e.id, []);
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      if (shareNode(elements[i]!, elements[j]!)) {
        adj.get(elements[i]!.id)!.push(elements[j]!.id);
        adj.get(elements[j]!.id)!.push(elements[i]!.id);
      }
    }
  }
  return adj;
}

function shareNode(a: FeaElement, b: FeaElement): boolean {
  const setA = new Set(a.nodeIds);
  for (const n of b.nodeIds) if (setA.has(n)) return true;
  return false;
}

// ── Path polyline (centroid sequence) ────────────────────────

export function pathPolyline(elements: FeaElement[], result: LoadPathResult): Vec3[] {
  return result.pathElementIds.map(id => {
    const e = elements.find(x => x.id === id)!;
    return e.centroid;
  });
}

// ── Stress envelope per path element ─────────────────────────

export interface StressEnvelope {
  index: number;
  elementId: string;
  stressMpa: number;
  /** Normalised against path peak. */
  normalised: number;
}

export function stressEnvelope(result: LoadPathResult): StressEnvelope[] {
  const peak = Math.max(...result.pathStresses, 0);
  return result.pathElementIds.map((id, i) => ({
    index: i,
    elementId: id,
    stressMpa: result.pathStresses[i] ?? 0,
    normalised: peak === 0 ? 0 : (result.pathStresses[i] ?? 0) / peak,
  }));
}

// ── Topology optimisation seed ───────────────────────────────

export interface TopologySeed {
  retainedElements: string[];
  removedElements: string[];
  retentionFraction: number;
}

export function buildTopologySeed(result: LoadPathResult, elements: FeaElement[]): TopologySeed {
  const removed = new Set(result.redundantElementIds);
  const retained = elements.filter(e => !removed.has(e.id)).map(e => e.id);
  return {
    retainedElements: retained,
    removedElements: result.redundantElementIds,
    retentionFraction: elements.length === 0 ? 1 : retained.length / elements.length,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface LoadPathSummary {
  pathLength: number;
  reachedSupport: boolean;
  redundantCount: number;
  peakStressMpa: number;
}

export function summarize(result: LoadPathResult): LoadPathSummary {
  return {
    pathLength: result.pathElementIds.length,
    reachedSupport: result.reachedSupport,
    redundantCount: result.redundantElementIds.length,
    peakStressMpa: Math.max(...result.pathStresses, 0),
  };
}
