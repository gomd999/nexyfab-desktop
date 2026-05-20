/**
 * mateRedundancyDetector.ts — Detect redundant / over-constraining
 * mates in an assembly.
 *
 * An assembly with N rigid bodies has 6·N DOFs (3 translations +
 * 3 rotations per body) minus 6 for the ground frame. Each mate
 * removes some DOFs:
 *
 *   - Coincident (point-on-point): 3
 *   - Concentric (axis-on-axis): 4
 *   - Mate (plane-on-plane): 3 (1 translation + 2 rotations)
 *   - Parallel: 2 rotations
 *   - Perpendicular: 1 rotation
 *   - Tangent: 1 translation
 *   - Hinge (concentric + coincident): 5
 *   - Lock: 6
 *
 * If total constraints removed > 6·N - 6 + (target DOF), the
 * assembly is over-constrained → solver oscillates or fails.
 *
 * Module computes:
 *   - Total DOF removed.
 *   - Remaining DOF (negative = over-constrained).
 *   - Per-body / per-pair redundancy (multiple mates pinning the
 *     same pair contribute fast).
 *   - Suggestions for which mate to remove.
 */

export type MateKind = 'coincident' | 'concentric' | 'mate' | 'parallel' | 'perpendicular' | 'tangent' | 'hinge' | 'lock' | 'distance' | 'angle';

export const DOFS_REMOVED_BY_KIND: Record<MateKind, number> = {
  coincident: 3,
  concentric: 4,
  mate: 3,
  parallel: 2,
  perpendicular: 1,
  tangent: 1,
  hinge: 5,
  lock: 6,
  distance: 1,
  angle: 1,
};

export interface Mate {
  id: string;
  bodyA: string;
  bodyB: string;
  kind: MateKind;
  /** Optional flag to mark grounded (one side ground). */
  groundedA?: boolean;
  groundedB?: boolean;
}

export interface RedundancyResult {
  bodyCount: number;
  totalDofs: number;
  /** Sum of DOF removed by all mates. */
  dofRemoved: number;
  /** Remaining DOF; negative = over-constrained. */
  remainingDof: number;
  /** Whether assembly is fully constrained (= 0 remaining). */
  fullyConstrained: boolean;
  /** Whether over-constrained. */
  overConstrained: boolean;
  /** Per pair-of-bodies summed constraint. */
  pairCounts: Map<string, { mates: string[]; totalDofs: number }>;
  /** Redundant mates (could be removed without losing assembly). */
  redundantMateIds: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function detectRedundancy(bodies: string[], mates: Mate[]): RedundancyResult {
  const bodyCount = bodies.length;
  const totalDofs = Math.max(0, 6 * bodyCount - 6);

  const pairCounts = new Map<string, { mates: string[]; totalDofs: number }>();
  let dofRemoved = 0;

  for (const mate of mates) {
    const dof = DOFS_REMOVED_BY_KIND[mate.kind];
    dofRemoved += dof;
    const key = pairKey(mate.bodyA, mate.bodyB);
    const existing = pairCounts.get(key);
    if (existing) {
      existing.mates.push(mate.id);
      existing.totalDofs += dof;
    } else {
      pairCounts.set(key, { mates: [mate.id], totalDofs: dof });
    }
  }

  const remainingDof = totalDofs - dofRemoved;
  const overConstrained = remainingDof < 0;
  const fullyConstrained = remainingDof === 0;

  // Identify redundant mates: a pair with > 6 total dofs has extras.
  const redundantMateIds: string[] = [];
  for (const [, pair] of pairCounts) {
    if (pair.totalDofs > 6) {
      // The last-added mate is treated as redundant first.
      const sorted = pair.mates.slice().reverse();
      let budget = pair.totalDofs - 6;
      for (const mid of sorted) {
        if (budget <= 0) break;
        const mate = mates.find(m => m.id === mid)!;
        const dof = DOFS_REMOVED_BY_KIND[mate.kind];
        redundantMateIds.push(mid);
        budget -= dof;
      }
    }
  }

  return {
    bodyCount,
    totalDofs,
    dofRemoved,
    remainingDof,
    fullyConstrained,
    overConstrained,
    pairCounts,
    redundantMateIds,
  };
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ── Suggestion: which mates to remove first ───────────────────

export interface RemovalSuggestion {
  mateId: string;
  kind: MateKind;
  dofsFreed: number;
  reason: string;
}

export function suggestRemovals(result: RedundancyResult, mates: Mate[]): RemovalSuggestion[] {
  return result.redundantMateIds.map(id => {
    const mate = mates.find(m => m.id === id)!;
    const pair = result.pairCounts.get(pairKey(mate.bodyA, mate.bodyB))!;
    return {
      mateId: id,
      kind: mate.kind,
      dofsFreed: DOFS_REMOVED_BY_KIND[mate.kind],
      reason: `Pair (${mate.bodyA}, ${mate.bodyB}) carries ${pair.totalDofs} DOFs across ${pair.mates.length} mates (max 6 needed).`,
    };
  });
}

// ── Per-body DOF distribution ─────────────────────────────────

export interface BodyDofUsage {
  bodyId: string;
  dofsRemoved: number;
  mateCount: number;
  isGround: boolean;
}

export function perBodyDof(bodies: string[], mates: Mate[]): BodyDofUsage[] {
  return bodies.map(bodyId => {
    const relevant = mates.filter(m => m.bodyA === bodyId || m.bodyB === bodyId);
    let dofs = 0;
    let isGround = false;
    for (const m of relevant) {
      dofs += DOFS_REMOVED_BY_KIND[m.kind];
      if ((m.bodyA === bodyId && m.groundedA) || (m.bodyB === bodyId && m.groundedB)) {
        isGround = true;
      }
    }
    return { bodyId, dofsRemoved: dofs, mateCount: relevant.length, isGround };
  });
}

// ── Summary ────────────────────────────────────────────────────

export interface RedundancySummary {
  bodyCount: number;
  mateCount: number;
  overConstrained: boolean;
  remainingDof: number;
  redundantMateCount: number;
  highestPairDof: number;
}

export function summarize(result: RedundancyResult, mateCount: number): RedundancySummary {
  let highest = 0;
  for (const pair of result.pairCounts.values()) {
    if (pair.totalDofs > highest) highest = pair.totalDofs;
  }
  return {
    bodyCount: result.bodyCount,
    mateCount,
    overConstrained: result.overConstrained,
    remainingDof: result.remainingDof,
    redundantMateCount: result.redundantMateIds.length,
    highestPairDof: highest,
  };
}
