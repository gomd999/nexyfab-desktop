/**
 * mateGroupSolver — Phase 3.3.x of NexyFab Pro own-CAD (ADR-013).
 *
 * Disjoint-sub-assembly partitioner + parallel solver wrapper. Many real
 * assemblies decompose naturally into several connectivity-independent
 * islands (engine block, drivetrain, body frame, …). The existing Phase 3.2
 * / 3.3 solvers (iterativeSolve, lagrangianSolve, lagrangianSolveAdaptive)
 * operate on the FULL mate list — they pay O(M²) per Newton step even
 * though most pairs of mates have no shared parts and cannot possibly
 * couple in the Jacobian.
 *
 * This module wraps those solvers with:
 *   1. `partitionAssembly` — Union-Find over the mate graph (parts as
 *      vertices, mates as edges) → one MateGroup per connected component.
 *      Isolated parts (touched by NO mate) form singleton groups.
 *   2. `solveByGroups` — runs the chosen solver on each group in parallel
 *      (Promise.all). Each group is treated as a self-contained
 *      AssemblyState; the per-group results are merged back into a single
 *      output state preserving the original `parts` ordering.
 *
 * Anchoring rule: a MateGroup is solvable iff it contains at least one
 * fixed part. The solver_state for a group inherits the global fixed flag.
 * Singleton groups (parts that aren't anchored to anything) skip the solve
 * entirely — they keep their input placement (which the global validator
 * already guarantees is fine because at least one part is fixed).
 *
 * Performance: for K groups of sizes N₁..Nₖ with Σ Nᵢ = N, the per-step
 * work drops from O(N²) (or O(M²) — same for typical assemblies) to
 * O(max(Nᵢ²)) wall-time when all groups run concurrently (single-thread
 * cooperative under Promise.all — true parallelism would need worker
 * threads; the async boundary lets the event loop interleave I/O if any
 * solver later becomes async). Even on a single thread the constant-factor
 * win is real because each per-group Newton step has a much smaller dense
 * matrix.
 *
 * Constraints:
 *   - Pure wrapper. Does NOT modify assemblyState.ts, mate.ts, or any
 *     existing solver — only re-exports the existing solver types and
 *     orchestrates calls.
 *   - Suppressed mates are excluded from the connectivity graph (they do
 *     not couple their endpoints for partitioning purposes — matches the
 *     existing solvers, which also skip them).
 */

import type { AssemblyState, PartInstance } from './assemblyState';
import type { Mate } from './mate';
import type {
  GeometryResolver,
  IterativeSolverOptions,
  IterativeSolveResult,
  MateResidual,
} from './iterativeSolver';
import { iterativeSolve } from './iterativeSolver';
import { lagrangianSolve, lagrangianSolveAdaptive } from './lagrangianSolver';

// ─── public types ────────────────────────────────────────────────────────

/** One connected component of the mate-connectivity graph. */
export interface MateGroup {
  /** Deterministic id derived from the lowest-sorted partId in the group
   *  (so callers can map test fixtures to expected groups). */
  groupId: string;
  /** All parts in this connected component (includes fixed parts). */
  partIds: ReadonlyArray<string>;
  /** All non-suppressed mates whose endpoints both lie in this group. */
  mateIds: ReadonlyArray<string>;
}

export type GroupSolverKind = 'gauss_seidel' | 'lagrangian' | 'adaptive';

export interface GroupedSolveOptions {
  /** Which underlying solver to invoke for each group. */
  solver: GroupSolverKind;
  /** Passed through to each per-group solver call. */
  perGroupOptions?: IterativeSolverOptions;
}

export interface GroupedSolveResult {
  /** Merged AssemblyState — same `parts` order as the input. */
  state: AssemblyState;
  /** Connectivity decomposition discovered by `partitionAssembly`. */
  groups: ReadonlyArray<MateGroup>;
  /** Per-group solver output (keyed by `MateGroup.groupId`). Groups with
   *  no mates are still represented with a trivially-converged result. */
  groupResults: Map<string, IterativeSolveResult>;
  /** Wall-clock total of the orchestration (includes partition + Promise.all
   *  await). When solvers run concurrently this is ~ max(per-group durations)
   *  plus overhead, not the sum. */
  totalDurationMs: number;
}

// ─── partitioning (union-find) ───────────────────────────────────────────

/**
 * Connected-component decomposition of the mate graph. Each PartInstance
 * is a vertex; each non-suppressed Mate is an undirected edge between its
 * two endpoint parts. Disconnected parts (no mates) become singleton groups.
 *
 * Group ids are derived from the lexicographically smallest member partId
 * for deterministic snapshots in tests.
 *
 * Complexity: O((P + M) · α(P)) with α the inverse Ackermann — effectively
 * linear in (parts + mates).
 */
export function partitionAssembly(state: AssemblyState): MateGroup[] {
  const partIds = state.parts.map((p) => p.id);

  // ── union-find on partIds ─────────────────────────────────────────────
  const parent = new Map<string, string>();
  const rank = new Map<string, number>();
  for (const id of partIds) {
    parent.set(id, id);
    rank.set(id, 0);
  }

  const find = (x: string): string => {
    let root = x;
    while (parent.get(root)! !== root) {
      root = parent.get(root)!;
    }
    // path compression
    let cur = x;
    while (parent.get(cur)! !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };

  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const raRank = rank.get(ra)!;
    const rbRank = rank.get(rb)!;
    if (raRank < rbRank) {
      parent.set(ra, rb);
    } else if (raRank > rbRank) {
      parent.set(rb, ra);
    } else {
      parent.set(rb, ra);
      rank.set(ra, raRank + 1);
    }
  };

  // Only NON-SUPPRESSED mates couple their endpoints. (Suppressed mates
  // are also skipped by the underlying solvers, so excluding them here
  // keeps partition behaviour consistent with what the solver will see.)
  const activeMates: Mate[] = state.mates.filter(
    (m) => !m.suppressed
      // Guard against mates referencing unknown parts — `validateAssembly`
      // would normally catch this, but `partitionAssembly` shouldn't throw
      // on its own. Skip the bad edge so partition is still well-defined.
      && parent.has(m.a.partId)
      && parent.has(m.b.partId),
  );

  for (const mate of activeMates) {
    union(mate.a.partId, mate.b.partId);
  }

  // ── group up by root ──────────────────────────────────────────────────
  const groupParts = new Map<string, string[]>();
  for (const id of partIds) {
    const root = find(id);
    let bucket = groupParts.get(root);
    if (!bucket) {
      bucket = [];
      groupParts.set(root, bucket);
    }
    bucket.push(id);
  }

  // Mates assigned to the group of (either) endpoint — they're equal by
  // construction since `union(a, b)` placed them in the same component.
  const groupMates = new Map<string, string[]>();
  for (const mate of activeMates) {
    const root = find(mate.a.partId);
    let bucket = groupMates.get(root);
    if (!bucket) {
      bucket = [];
      groupMates.set(root, bucket);
    }
    bucket.push(mate.id);
  }

  // Build result. groupId = sorted-smallest-partId in the component so
  // tests can pin against a stable label.
  const out: MateGroup[] = [];
  for (const [, parts] of groupParts) {
    const sorted = parts.slice().sort();
    const root = sorted[0]!;
    out.push({
      groupId: root,
      partIds: sorted,
      // Sort mate ids for deterministic test snapshots, too.
      mateIds: (groupMates.get(find(root)) ?? []).slice().sort(),
    });
  }
  // Sort groups by their (smallest) id so callers see a stable iteration
  // order regardless of insertion order in the Map.
  out.sort((a, b) => (a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0));
  return out;
}

// ─── grouped solve ───────────────────────────────────────────────────────

/**
 * Solve each connected sub-assembly independently and merge the results.
 *
 * Algorithm:
 *   1. `partitionAssembly` → list of MateGroups.
 *   2. For each group, build a sub-AssemblyState containing only that
 *      group's parts + mates. Group must contain ≥ 1 fixed part to be
 *      solved (matches the global validator's invariant). Singleton groups
 *      (no mates) trivially "converge" with their input placement.
 *   3. Promise.all over the groups — each underlying solver is currently
 *      synchronous, but wrapping in async lets the event loop pump and
 *      keeps the API future-proof for worker-thread offload.
 *   4. Merge: for each part in the original `state.parts` order, look up
 *      its post-solve PartInstance in the group result.
 *
 * Error handling: if a non-trivial group (≥ 1 mate) has NO fixed part, the
 * underlying solver might either succeed (if effectively under-constrained
 * and the residual evaluates to 0) or report failure via `success: false`.
 * We do not throw — that's a caller decision. Group results are surfaced
 * via `groupResults` so the caller can inspect.
 */
export async function solveByGroups(
  state: AssemblyState,
  resolve: GeometryResolver,
  opts: GroupedSolveOptions,
): Promise<GroupedSolveResult> {
  const t0 = performance.now();

  const groups = partitionAssembly(state);
  const groupResults = new Map<string, IterativeSolveResult>();

  // Index helpers.
  const partById = new Map(state.parts.map((p) => [p.id, p]));
  const mateById = new Map(state.mates.map((m) => [m.id, m]));

  // ── per-group solve (parallel) ───────────────────────────────────────
  const tasks = groups.map(async (g): Promise<[string, IterativeSolveResult]> => {
    const subParts: PartInstance[] = g.partIds
      .map((id) => partById.get(id)!)
      // We pass parts by reference into a fresh sub-state. The solvers
      // already clone via `state.parts.map(p => ({...p}))` internally so
      // there's no mutation back into the input.
      .filter(Boolean);

    const subMates: Mate[] = g.mateIds
      .map((id) => mateById.get(id)!)
      .filter(Boolean);

    const subState: AssemblyState = { parts: subParts, mates: subMates };

    // ── short-circuit: nothing to solve ─────────────────────────────────
    if (subMates.length === 0) {
      // Singleton group (or all-fixed cluster with no mates): trivially
      // satisfied. Surface a synthetic IterativeSolveResult so the caller's
      // `groupResults` map stays complete.
      return [g.groupId, {
        state: subState,
        success: true,
        iterations: 0,
        finalMaxResidual: 0,
        residuals: [],
      }];
    }

    // Pick the underlying solver. `adaptive` and `lagrangian` both return
    // IterativeSolveResult (declared in their .ts signatures); the wrapper
    // is a thin adapter that calls them on each sub-state independently.
    const subResult = await runOneGroup(subState, resolve, opts);
    return [g.groupId, subResult];
  });

  const settled = await Promise.all(tasks);
  for (const [gid, res] of settled) {
    groupResults.set(gid, res);
  }

  // ── merge results into a single output state ─────────────────────────
  // Re-index solved parts by id so the merged `parts` array preserves the
  // ORIGINAL ordering (callers downstream — UI panels, BOM exporter —
  // depend on stable order).
  const solvedById = new Map<string, PartInstance>();
  for (const [, res] of groupResults) {
    for (const p of res.state.parts) {
      solvedById.set(p.id, p);
    }
  }

  const mergedParts: PartInstance[] = state.parts.map(
    (p) => solvedById.get(p.id) ?? p,
  );

  const mergedState: AssemblyState = {
    parts: mergedParts,
    mates: state.mates,
  };

  const totalDurationMs = performance.now() - t0;

  return {
    state: mergedState,
    groups,
    groupResults,
    totalDurationMs,
  };
}

// ─── internal: dispatch to the chosen underlying solver ──────────────────

async function runOneGroup(
  subState: AssemblyState,
  resolve: GeometryResolver,
  opts: GroupedSolveOptions,
): Promise<IterativeSolveResult> {
  // Yield to the event loop once so disjoint groups get a chance to
  // interleave (matters when callers race solveByGroups against UI ticks).
  await Promise.resolve();

  const perGroup = opts.perGroupOptions ?? {};
  switch (opts.solver) {
    case 'gauss_seidel':
      return iterativeSolve(subState, resolve, perGroup);
    case 'lagrangian':
      return lagrangianSolve(subState, resolve, perGroup);
    case 'adaptive':
      return lagrangianSolveAdaptive(subState, resolve, perGroup);
  }
}

// ─── small helpers for callers building diagnostics ──────────────────────

/**
 * Aggregate per-group residuals into a single max-residual scalar — handy
 * for "did the entire assembly converge?" checks. Returns 0 when all
 * groups are empty/trivial.
 */
export function maxResidualAcrossGroups(
  groupResults: ReadonlyMap<string, IterativeSolveResult>,
): number {
  let mx = 0;
  for (const [, r] of groupResults) {
    if (r.finalMaxResidual > mx) mx = r.finalMaxResidual;
  }
  return mx;
}

/**
 * Concatenate all per-group `residuals` into a flat list — useful for
 * surfacing in the mate-panel UI which is typically grouped by mate id,
 * not by sub-assembly.
 */
export function flattenGroupResiduals(
  groupResults: ReadonlyMap<string, IterativeSolveResult>,
): MateResidual[] {
  const out: MateResidual[] = [];
  for (const [, r] of groupResults) {
    for (const mr of r.residuals) out.push(mr);
  }
  return out;
}
