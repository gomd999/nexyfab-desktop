/**
 * mateConflictResolver.ts — Auto-resolve assembly mate conflicts.
 *
 * Assembly mate solvers (existing `matesSolver`) report when the
 * system is over-constrained. The natural next question: *which*
 * mate(s) should be dropped to make it solvable, with the least
 * loss of designer intent?
 *
 * Approach:
 *
 *   1. Each mate carries a *strength* score (user-defined or
 *      auto-derived from creation order — newer mates win, OR
 *      mate type weight: coincident > parallel > distance).
 *   2. Build the dependency graph and identify the over-constrained
 *      subgraph (set of mates whose constraints sum to more DOFs
 *      than available).
 *   3. Greedy remove the weakest mate from the subgraph; re-check;
 *      repeat until consistent.
 *   4. Output a list of mates that were dropped + the inferred
 *      "suppressed" rationale per mate.
 */

export type MateType = 'coincident' | 'parallel' | 'perpendicular' | 'concentric' | 'distance' | 'angle' | 'tangent';

export interface AssemblyMate {
  id: string;
  /** Bodies the mate connects. */
  bodyA: string;
  bodyB: string;
  type: MateType;
  /** Strength (higher = harder to drop). */
  strength: number;
  /** Constraint DOFs removed by this mate. */
  dofsRemoved: number;
}

export interface Conflict {
  /** Mates participating in the over-constrained subsystem. */
  matesInvolved: string[];
  /** Total DOFs removed by these mates. */
  totalRemoved: number;
  /** DOFs the system actually has (6 per body × bodyCount). */
  availableDofs: number;
}

export interface ResolutionResult {
  /** Mates dropped to resolve conflicts. */
  droppedMates: string[];
  /** Remaining mates after resolution. */
  remainingMates: AssemblyMate[];
  /** Per-conflict explanation. */
  conflicts: Conflict[];
  /** Was resolution successful? */
  resolved: boolean;
  /** Per-iteration trace. */
  trace: Array<{ iteration: number; droppedMateId: string; reason: string }>;
}

export interface ResolveOptions {
  /** Maximum iterations to attempt. */
  maxIterations: number;
}

export const DEFAULT_OPTIONS: ResolveOptions = {
  maxIterations: 32,
};

// ── Default strength model ────────────────────────────────────

export const MATE_TYPE_WEIGHT: Record<MateType, number> = {
  coincident: 5,
  concentric: 5,
  parallel: 3,
  perpendicular: 3,
  tangent: 4,
  distance: 2,
  angle: 2,
};

export const MATE_TYPE_DOFS: Record<MateType, number> = {
  coincident: 3,
  concentric: 4,
  parallel: 2,
  perpendicular: 2,
  tangent: 1,
  distance: 1,
  angle: 1,
};

export function autoStrength(type: MateType, creationOrder: number): number {
  return MATE_TYPE_WEIGHT[type] * 100 + creationOrder;
}

// ── Top-level entry ────────────────────────────────────────────

export function resolveConflicts(
  mates: AssemblyMate[],
  bodyIds: string[],
  options: Partial<ResolveOptions> = {},
): ResolutionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const availableDofs = bodyIds.length * 6;
  const remaining = [...mates];
  const dropped: string[] = [];
  const trace: Array<{ iteration: number; droppedMateId: string; reason: string }> = [];
  const conflicts: Conflict[] = [];

  for (let iter = 0; iter < opts.maxIterations; iter++) {
    const conflictSubsets = findConflicts(remaining, availableDofs);
    if (conflictSubsets.length === 0) {
      return {
        droppedMates: dropped,
        remainingMates: remaining,
        conflicts,
        resolved: true,
        trace,
      };
    }
    conflicts.push(...conflictSubsets);
    // Pick the weakest mate across all conflicts.
    const involved = new Set<string>();
    for (const c of conflictSubsets) for (const id of c.matesInvolved) involved.add(id);
    const candidates = remaining.filter(m => involved.has(m.id));
    if (candidates.length === 0) break;
    candidates.sort((a, b) => a.strength - b.strength);
    const weakest = candidates[0]!;
    const idx = remaining.findIndex(m => m.id === weakest.id);
    if (idx >= 0) {
      remaining.splice(idx, 1);
      dropped.push(weakest.id);
      trace.push({ iteration: iter, droppedMateId: weakest.id, reason: `weakest (strength=${weakest.strength}) in conflict` });
    }
  }

  return {
    droppedMates: dropped,
    remainingMates: remaining,
    conflicts,
    resolved: false,
    trace,
  };
}

// ── Conflict detection ─────────────────────────────────────────

function findConflicts(mates: AssemblyMate[], availableDofs: number): Conflict[] {
  // Build the connected components of the mate graph.
  const adj = new Map<string, Set<string>>();
  for (const m of mates) {
    if (!adj.has(m.bodyA)) adj.set(m.bodyA, new Set());
    if (!adj.has(m.bodyB)) adj.set(m.bodyB, new Set());
    adj.get(m.bodyA)!.add(m.bodyB);
    adj.get(m.bodyB)!.add(m.bodyA);
  }
  const visited = new Set<string>();
  const components: Set<string>[] = [];
  for (const id of adj.keys()) {
    if (visited.has(id)) continue;
    const comp = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      comp.add(cur);
      for (const next of adj.get(cur) ?? []) stack.push(next);
    }
    components.push(comp);
  }

  const conflicts: Conflict[] = [];
  for (const comp of components) {
    const matesInComp = mates.filter(m => comp.has(m.bodyA) && comp.has(m.bodyB));
    const removed = matesInComp.reduce((s, m) => s + m.dofsRemoved, 0);
    const bodyCount = comp.size;
    // Available relative DOFs between N mated bodies = 6 × (N - 1).
    // (Each pair has 6 DOFs but minimum spanning tree has N-1 edges.)
    const available = Math.max(0, 6 * (bodyCount - 1));
    if (removed > available) {
      conflicts.push({
        matesInvolved: matesInComp.map(m => m.id),
        totalRemoved: removed,
        availableDofs: available,
      });
    }
  }
  void availableDofs;
  return conflicts;
}

// ── Summary ────────────────────────────────────────────────────

export interface ResolutionSummary {
  totalMates: number;
  droppedCount: number;
  conflictCount: number;
  resolved: boolean;
  /** Fraction of mates that survived. */
  preservedFraction: number;
}

export function summarize(originalMates: AssemblyMate[], result: ResolutionResult): ResolutionSummary {
  const total = originalMates.length;
  return {
    totalMates: total,
    droppedCount: result.droppedMates.length,
    conflictCount: result.conflicts.length,
    resolved: result.resolved,
    preservedFraction: total > 0 ? result.remainingMates.length / total : 1,
  };
}
