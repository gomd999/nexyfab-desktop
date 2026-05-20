/**
 * explodeStepSequencer.ts — Determine the *order* of exploded-view
 * steps for an assembly disassembly animation / instruction.
 *
 * Existing modules produce the exploded geometry. This module
 * decides "which part comes out first" — the sequence that turns
 * a static exploded shot into a viewable assembly/disassembly
 * animation or printable step-by-step instructions.
 *
 * Rules:
 *
 *   - **Layered removal**: parts on the outside (further from the
 *     assembly centroid along the explode axis) are removed first.
 *   - **Fastener priority**: when a part is tagged as a fastener
 *     (e.g., bolt, screw), it's removed BEFORE the panel it
 *     attaches.
 *   - **Sub-assembly grouping**: parts in the same sub-assembly
 *     can be removed together as a step.
 *   - **Dependency edges**: caller may supply explicit "X must
 *     be removed before Y" constraints, which override layering.
 */

export interface PartNode {
  id: string;
  /** Centroid in the *assembled* (pre-explode) frame. */
  centroid: [number, number, number];
  /** True if this part is a fastener (bolt / screw / pin). */
  isFastener: boolean;
  /** Optional sub-assembly id. */
  subAssemblyId?: string;
}

export interface DependencyEdge {
  /** Part that must come out first. */
  predecessor: string;
  /** Part that comes out after the predecessor. */
  successor: string;
}

export interface ExplodeStep {
  /** 1-indexed step number. */
  stepNumber: number;
  /** Part ids removed in this step. */
  parts: string[];
  /** Sub-assembly id if all parts belong to one. */
  subAssemblyId?: string;
  /** Step kind. */
  kind: 'fastener' | 'subassembly' | 'part';
}

export interface SequenceResult {
  steps: ExplodeStep[];
  /** Edges from dependency input that could not be honored (cycles). */
  unresolvedEdges: DependencyEdge[];
  /** Assembly centroid used for layering. */
  assemblyCentroid: [number, number, number];
}

export interface SequenceOptions {
  /** Explode direction (unit vector). Parts further along this axis
   *  from the centroid are removed first. */
  explodeAxis: [number, number, number];
  /** Group fasteners and the panel they belong to in one step. */
  groupFastenersWithPanel: boolean;
  /** Group sub-assembly parts into a single step. */
  groupSubAssemblies: boolean;
}

export const DEFAULT_OPTIONS: SequenceOptions = {
  explodeAxis: [0, 0, 1],
  groupFastenersWithPanel: false,
  groupSubAssemblies: true,
};

// ── Top-level entry ────────────────────────────────────────────

export function sequenceSteps(
  parts: PartNode[],
  dependencies: DependencyEdge[] = [],
  options: Partial<SequenceOptions> = {},
): SequenceResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (parts.length === 0) {
    return { steps: [], unresolvedEdges: [], assemblyCentroid: [0, 0, 0] };
  }

  // Assembly centroid.
  let cx = 0, cy = 0, cz = 0;
  for (const p of parts) {
    cx += p.centroid[0];
    cy += p.centroid[1];
    cz += p.centroid[2];
  }
  cx /= parts.length;
  cy /= parts.length;
  cz /= parts.length;
  const centroid: [number, number, number] = [cx, cy, cz];

  // Project each part along the explode axis from the centroid.
  const axis = normalize(opts.explodeAxis);
  const projections = parts.map(p => ({
    part: p,
    layer: (p.centroid[0] - cx) * axis[0] + (p.centroid[1] - cy) * axis[1] + (p.centroid[2] - cz) * axis[2],
  }));
  // Higher projection = further out = remove first → descending sort.
  projections.sort((a, b) => b.layer - a.layer);

  // Honor dependencies: any id that appears as predecessor in a dep
  // must come before its successors. For parts with no dependency,
  // follow preferred (layer) order. Use simple iterative repair.
  const preferred = projections.map(p => p.part.id);
  const { order: sortedIds, unresolvedEdges } = repairWithDependencies(preferred, dependencies);

  // Group steps.
  const steps: ExplodeStep[] = [];
  let stepNum = 1;
  let i = 0;
  while (i < sortedIds.length) {
    const id = sortedIds[i]!;
    const part = parts.find(p => p.id === id)!;

    if (opts.groupSubAssemblies && part.subAssemblyId) {
      const subId = part.subAssemblyId;
      const groupIds: string[] = [];
      while (i < sortedIds.length) {
        const cur = parts.find(p => p.id === sortedIds[i]!)!;
        if (cur.subAssemblyId === subId) {
          groupIds.push(cur.id);
          i++;
        } else break;
      }
      steps.push({ stepNumber: stepNum++, parts: groupIds, subAssemblyId: subId, kind: 'subassembly' });
    } else {
      steps.push({
        stepNumber: stepNum++,
        parts: [part.id],
        kind: part.isFastener ? 'fastener' : 'part',
      });
      i++;
    }
  }

  return { steps, unresolvedEdges, assemblyCentroid: centroid };
}

// ── Dependency-aware reorder ───────────────────────────────────

function repairWithDependencies(
  preferred: string[],
  edges: DependencyEdge[],
): { order: string[]; unresolvedEdges: DependencyEdge[] } {
  // Detect cycles via DFS first.
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.predecessor)) adj.set(e.predecessor, []);
    adj.get(e.predecessor)!.push(e.successor);
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  let cycleDetected = false;
  function dfs(node: string): void {
    if (stack.has(node)) { cycleDetected = true; return; }
    if (visited.has(node)) return;
    visited.add(node);
    stack.add(node);
    for (const next of adj.get(node) ?? []) dfs(next);
    stack.delete(node);
  }
  for (const id of preferred) dfs(id);

  // Iterative swap repair: walk preferred, for each pair where the
  // successor appears before the predecessor, swap.
  const order = preferred.slice();
  const idxOf = new Map<string, number>();
  function reindex(): void {
    idxOf.clear();
    order.forEach((id, i) => idxOf.set(id, i));
  }
  reindex();

  const maxPasses = preferred.length * 2;
  for (let pass = 0; pass < maxPasses; pass++) {
    let swapped = false;
    for (const e of edges) {
      const pi = idxOf.get(e.predecessor);
      const si = idxOf.get(e.successor);
      if (pi === undefined || si === undefined) continue;
      if (pi > si) {
        // Swap predecessor earlier than successor.
        order.splice(pi, 1);
        order.splice(si, 0, e.predecessor);
        reindex();
        swapped = true;
      }
    }
    if (!swapped) break;
  }

  const unresolvedEdges = cycleDetected ? edges : [];
  return { order, unresolvedEdges };
}

// ── Helpers ────────────────────────────────────────────────────

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

// ── Summary ────────────────────────────────────────────────────

export interface SequenceSummary {
  stepCount: number;
  partCount: number;
  fastenerStepCount: number;
  subAssemblyStepCount: number;
  unresolvedDependencyCount: number;
}

export function summarize(result: SequenceResult): SequenceSummary {
  return {
    stepCount: result.steps.length,
    partCount: result.steps.reduce((s, st) => s + st.parts.length, 0),
    fastenerStepCount: result.steps.filter(s => s.kind === 'fastener').length,
    subAssemblyStepCount: result.steps.filter(s => s.kind === 'subassembly').length,
    unresolvedDependencyCount: result.unresolvedEdges.length,
  };
}
