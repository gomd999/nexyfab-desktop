/**
 * mateDofAnalysis.ts — DOF analysis + over-constraint detection for
 * assembly mate networks.
 *
 * Stage 1 (`AssemblyMates.ts`) applies mates to position parts.
 * Stage 2 (here) answers the *graph-level* questions:
 *
 *   - **How many DOF does each part have left** after the mates it
 *     participates in?
 *   - **Is the assembly over-constrained**? Sum of mate-DOF-reductions
 *     exceeds (parts × 6 - 6 for ground).
 *   - **Which mate(s) cause the conflict**? Try removing each mate in
 *     turn; if the remaining system is consistent, that mate was the
 *     redundant one. (Min-cut diagnosis.)
 *   - **Kinematic loops** — sets of mates that form a closed cycle in
 *     the part-graph (e.g. 4-bar linkage). Loops require special-case
 *     solving since they introduce dependent constraints.
 *
 * Each mate type contributes a known DOF reduction:
 *
 *   coincident (planar) ─ 3 (loses 1 translation + 2 rotation)
 *   concentric / cylindrical ─ 4
 *   distance ─ 1
 *   angle ─ 1
 *   parallel ─ 2
 *   perpendicular ─ 2 (same as parallel — 2 rotation DOF)
 *   tangent ─ 1
 *   hinge / revolute ─ 5
 *   slider / prismatic ─ 5
 *   gear ─ 1 (couples rotations)
 *   rigid (= fix) ─ 6
 */

export type MateKind =
  | 'coincident'
  | 'concentric'
  | 'distance'
  | 'angle'
  | 'parallel'
  | 'perpendicular'
  | 'tangent'
  | 'hinge'
  | 'slider'
  | 'gear'
  | 'rigid';

/** DOF reduction per mate type. */
export const MATE_DOF_REDUCTION: Record<MateKind, number> = {
  coincident: 3,
  concentric: 4,
  distance: 1,
  angle: 1,
  parallel: 2,
  perpendicular: 2,
  tangent: 1,
  hinge: 5,
  slider: 5,
  gear: 1,
  rigid: 6,
};

export interface MateRef {
  id: string;
  kind: MateKind;
  partA: string;
  partB: string;
}

export interface PartRef {
  id: string;
  /** Is this part the immovable ground? Ground has 0 DOF intrinsically. */
  isGround?: boolean;
}

export interface PartDofRow {
  partId: string;
  intrinsicDof: number;
  reducedDof: number;
  remainingDof: number;
  /** Mates the part participates in. */
  mateIds: string[];
}

export interface AssemblyDofReport {
  parts: PartDofRow[];
  /** Cumulative free DOF across the whole assembly. */
  totalRemainingDof: number;
  /** Expected DOF (free body 6 × (parts - grounded)). */
  expectedTotalDof: number;
  status: 'mobile' | 'fully-constrained' | 'over-constrained';
  /** Loops detected in the mate graph. */
  kinematicLoops: KinematicLoop[];
}

export interface KinematicLoop {
  partIds: string[];
  mateIds: string[];
}

// ── DOF analysis ─────────────────────────────────────────────────

export function analyzeAssemblyDof(
  parts: PartRef[],
  mates: MateRef[],
): AssemblyDofReport {
  const partMates = new Map<string, string[]>();
  const partReduction = new Map<string, number>();
  for (const p of parts) {
    partMates.set(p.id, []);
    partReduction.set(p.id, 0);
  }
  // Each mate's DOF reduction is shared between the two parts it links.
  // We split the reduction in half between A and B; ground "absorbs"
  // its half (it has no DOF to lose).
  for (const m of mates) {
    const reduction = MATE_DOF_REDUCTION[m.kind];
    const a = parts.find(p => p.id === m.partA);
    const b = parts.find(p => p.id === m.partB);
    if (!a || !b) continue;
    if (a.isGround && b.isGround) continue;
    // If only one side is ground, the other side eats the full reduction.
    // Otherwise split.
    if (a.isGround) {
      partReduction.set(b.id, (partReduction.get(b.id) ?? 0) + reduction);
    } else if (b.isGround) {
      partReduction.set(a.id, (partReduction.get(a.id) ?? 0) + reduction);
    } else {
      partReduction.set(a.id, (partReduction.get(a.id) ?? 0) + reduction / 2);
      partReduction.set(b.id, (partReduction.get(b.id) ?? 0) + reduction / 2);
    }
    partMates.get(m.partA)!.push(m.id);
    partMates.get(m.partB)!.push(m.id);
  }

  const rows: PartDofRow[] = parts.map(p => {
    const intrinsic = p.isGround ? 0 : 6;
    const reduced = partReduction.get(p.id) ?? 0;
    const remaining = Math.max(0, intrinsic - reduced); // clamp at 0
    return {
      partId: p.id,
      intrinsicDof: intrinsic,
      reducedDof: reduced,
      remainingDof: remaining,
      mateIds: partMates.get(p.id) ?? [],
    };
  });

  const totalRemaining = rows.reduce((s, r) => s + r.remainingDof, 0);
  const totalIntrinsic = rows.reduce((s, r) => s + r.intrinsicDof, 0);
  const totalReduced = rows.reduce((s, r) => s + r.reducedDof, 0);

  const status: AssemblyDofReport['status'] =
    totalReduced > totalIntrinsic ? 'over-constrained'
    : totalRemaining === 0 ? 'fully-constrained'
    : 'mobile';

  const loops = detectLoops(parts, mates);

  return {
    parts: rows,
    totalRemainingDof: totalRemaining,
    expectedTotalDof: totalIntrinsic,
    status,
    kinematicLoops: loops,
  };
}

// ── Loop detection ───────────────────────────────────────────────

/** Find cycles in the part-mate graph via DFS. Cycles indicate
 *  kinematic loops (4-bar, double-rocker, etc) that need closure
 *  constraint handling. */
export function detectLoops(parts: PartRef[], mates: MateRef[]): KinematicLoop[] {
  const adj = new Map<string, Array<{ to: string; mateId: string }>>();
  for (const p of parts) adj.set(p.id, []);
  for (const m of mates) {
    if (m.partA === m.partB) continue;
    adj.get(m.partA)?.push({ to: m.partB, mateId: m.id });
    adj.get(m.partB)?.push({ to: m.partA, mateId: m.id });
  }
  const loops: KinematicLoop[] = [];
  const visitedEdge = new Set<string>();

  for (const startPart of parts) {
    if (startPart.isGround) continue;
    // DFS from this part with a stack tracking the current path.
    const stack: Array<{ node: string; pathParts: string[]; pathMates: string[]; prevMate: string | null }> = [
      { node: startPart.id, pathParts: [startPart.id], pathMates: [], prevMate: null },
    ];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const e of adj.get(cur.node) ?? []) {
        if (e.mateId === cur.prevMate) continue;
        if (cur.pathParts.length > 2 && e.to === cur.pathParts[0]) {
          // Found a loop back to start.
          const loopKey = [...cur.pathMates, e.mateId].sort().join('|');
          if (!visitedEdge.has(loopKey)) {
            visitedEdge.add(loopKey);
            loops.push({
              partIds: cur.pathParts.slice(),
              mateIds: [...cur.pathMates, e.mateId],
            });
          }
          continue;
        }
        if (cur.pathParts.includes(e.to)) continue;
        if (cur.pathParts.length > 6) continue; // cap depth
        stack.push({
          node: e.to,
          pathParts: [...cur.pathParts, e.to],
          pathMates: [...cur.pathMates, e.mateId],
          prevMate: e.mateId,
        });
      }
    }
  }
  return loops;
}

// ── Over-constraint diagnosis ────────────────────────────────────

export interface OverConstraintDiagnosis {
  redundantMateCandidates: string[];
  /** Recommended removals that would restore consistency. */
  suggestedRemovals: string[];
}

/** Min-cut style: try removing each mate; if the resulting system
 *  drops from over-constrained to fully/under-constrained, that mate
 *  is a candidate. */
export function diagnoseOverConstraints(
  parts: PartRef[],
  mates: MateRef[],
): OverConstraintDiagnosis {
  const baseline = analyzeAssemblyDof(parts, mates);
  if (baseline.status !== 'over-constrained') {
    return { redundantMateCandidates: [], suggestedRemovals: [] };
  }
  const candidates: string[] = [];
  for (const m of mates) {
    const reduced = mates.filter(x => x.id !== m.id);
    const r = analyzeAssemblyDof(parts, reduced);
    if (r.status !== 'over-constrained') {
      candidates.push(m.id);
    }
  }
  // Suggest the highest-DOF-reduction mate among candidates as the
  // most likely culprit — removing it clears the most constraint.
  candidates.sort((a, b) => {
    const ma = mates.find(x => x.id === a)!;
    const mb = mates.find(x => x.id === b)!;
    return MATE_DOF_REDUCTION[mb.kind] - MATE_DOF_REDUCTION[ma.kind];
  });
  return {
    redundantMateCandidates: candidates,
    suggestedRemovals: candidates.slice(0, 1),
  };
}
