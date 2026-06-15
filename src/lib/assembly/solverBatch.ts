/**
 * solverBatch — Phase 3.3 of NexyFab Pro own-CAD (ADR-013).
 *
 * Batch driver that runs MANY assembly solves concurrently. Each item in
 * the batch carries its own AssemblyState, GeometryResolver, a solver
 * choice ('gauss_seidel' | 'lagrangian' | 'adaptive'), and per-item
 * IterativeSolverOptions. The driver chunks the input into windows of
 * `maxParallel` (default 4) and dispatches each chunk through `Promise.all`,
 * preserving input order in the returned result array.
 *
 * Two production motivations:
 *
 *   1. Multi-assembly UI. When the user opens 5 assembly tabs at once the
 *      shell would otherwise solve them sequentially on the main thread,
 *      blocking the UI for the cumulative duration. Even though our solvers
 *      are CPU-bound (see "Parallel speedup" caveat below), wrapping each
 *      solve in a Promise lets the browser interleave layout/paint between
 *      microtasks and gives `requestIdleCallback`-friendly latency.
 *
 *   2. Hyperparameter / solver search. Run the SAME assembly through
 *      multiple solver configurations (e.g., relaxation 0.5 vs 1.0,
 *      Gauss-Seidel vs Lagrangian vs adaptive) and pick the best result.
 *      This is the cheapest way to drive the auto-tuner that picks defaults
 *      for `recommendSolver`.
 *
 * Solver dispatch:
 *
 *   - 'gauss_seidel' → `iterativeSolve` (Phase 2)
 *   - 'lagrangian'   → `lagrangianSolve` (Phase 3.3.1 — numeric Jacobian)
 *   - 'adaptive'     → `lagrangianSolveAdaptive` (Phase 3.2.4 — line search
 *                      + LM auto-tune; recommended production default for
 *                      Lagrangian-family work)
 *
 *   The `IterativeSolverOptions` type is shared by all three (only the
 *   common fields — maxIterations, tolerance — are honored; relaxation is
 *   silently ignored by the Lagrangian variants because they have their own
 *   damping mechanism).
 *
 * Parallel chunk algorithm:
 *
 *   for (let i = 0; i < items.length; i += maxParallel) {
 *     const chunk = items.slice(i, i + maxParallel);
 *     const chunkResults = await Promise.all(chunk.map(runOne));
 *     out.push(...chunkResults);
 *   }
 *
 *   Why CHUNKED rather than a worker-pool pattern? With Phase 1's plain
 *   `Promise.all` on CPU-bound work, both approaches are equivalent on a
 *   single thread — the scheduler still runs them sequentially within a
 *   microtask group. Chunking keeps memory bounded (no fan-out to
 *   N=hundreds of concurrent promises) and the implementation is one loop.
 *
 * Parallel speedup (Phase 1 reality check):
 *
 *   JavaScript is single-threaded. Wrapping CPU-bound work in promises and
 *   `Promise.all` does NOT give you wall-clock speedup — each solve still
 *   blocks the main thread for its full duration; promises just reorder
 *   when they run. You'll see speedup only when:
 *
 *     (a) Solves can yield to async work (network, disk) — none of our
 *         solvers do this today; everything is in-memory math.
 *     (b) The solver itself is moved to a Web Worker (Phase 4 wishlist
 *         below). At that point `maxParallel=N` becomes a real N-way
 *         speedup bounded by `navigator.hardwareConcurrency`.
 *
 *   Today's `solveBatch(maxParallel=4)` on 8 CPU-bound items will run in
 *   ~8x single-item time, same as a sequential `for await`. The value
 *   we ship in Phase 1 is API ergonomics + UI yield points, NOT speed.
 *
 * Phase 4 wishlist (Web Worker speedup):
 *
 *   - Spin up a pool of Worker instances, each running a `solverWorker.ts`
 *     that imports `iterativeSolve` / `lagrangianSolve*` and listens for
 *     postMessage requests.
 *   - `solveBatch` becomes a true worker-pool: each chunk slot ships an
 *     item to a free worker, awaits its postMessage reply, and yields the
 *     slot back to the pool.
 *   - Transferable buffers for the Float64Array Jacobian/state to avoid
 *     structured-clone overhead on large assemblies.
 *   - Fallback to today's sync path when `typeof Worker === 'undefined'`
 *     (Node tests, SSR) so the API stays identical.
 *
 *   Estimated speedup: ~N× on the 5-assembly-tab use case (N = number of
 *   workers, capped at hardwareConcurrency). The 60ms median Lagrangian
 *   solve in the burn-in suite (`project_nexyfab_3d_burnin`) drops to
 *   ~15ms wall-clock for a 4-worker pool on a 4-tab dashboard.
 */

import type { AssemblyState } from './assemblyState';
import type {
  GeometryResolver,
  IterativeSolveResult,
  IterativeSolverOptions,
} from './iterativeSolver';
import { iterativeSolve } from './iterativeSolver';
import {
  lagrangianSolve,
  lagrangianSolveAdaptive,
} from './lagrangianSolver';

// ─── public API ──────────────────────────────────────────────────────────

/**
 * Solver choice for a batch item.
 *
 *   - 'gauss_seidel' — Phase 2 relaxation. Fastest on short, well-posed
 *     analytical chains. Use this for live-UI dragging where iteration
 *     cap matters more than tightness.
 *   - 'lagrangian'   — Phase 3.3.1 Newton-LM with numeric Jacobian.
 *     Quadratic convergence near the solution; handles redundancy. Use
 *     this for "press Solve" actions where tightness wins.
 *   - 'adaptive'     — Phase 3.2.4 Newton-LM with line search + auto-tuned
 *     LM schedule + stall detection. The recommended production default
 *     for Lagrangian-family work — strictly dominates 'lagrangian' on the
 *     burn-in suite but pays a small constant-factor setup cost.
 */
export type BatchSolverChoice = 'gauss_seidel' | 'lagrangian' | 'adaptive';

export interface BatchSolveItem {
  /** Caller-supplied id, echoed in BatchSolveResult.id. Need not be unique
   *  across items — the driver does not deduplicate. */
  id: string;
  /** The assembly to solve. Not mutated. */
  state: AssemblyState;
  /** Caller-supplied geometry resolver (same contract as the per-solver
   *  API). Must be safe to call from multiple async contexts — the
   *  driver itself does not invoke it across chunks, but a future Web
   *  Worker version will serialise it. */
  resolver: GeometryResolver;
  /** Which solver to dispatch to. */
  solver: BatchSolverChoice;
  /** Per-item solver options. Common fields (maxIterations, tolerance)
   *  are honored by all three solvers; relaxation is honored only by
   *  Gauss-Seidel. Lagrangian-specific options (lineSearch, damping)
   *  are not exposed here yet — promote them to a discriminated union if
   *  needed in Phase 4. */
  options?: IterativeSolverOptions;
}

export interface BatchSolveResult {
  /** Echoes BatchSolveItem.id at the same index. */
  id: string;
  /** Solver output. Same shape regardless of which solver was dispatched. */
  result: IterativeSolveResult;
  /** Wall-clock time spent in the solver call, including resolver lookups
   *  but excluding the chunking overhead. Useful for the auto-tuner. */
  durationMs: number;
}

export interface SolveBatchOptions {
  /** Number of items dispatched per `Promise.all` chunk. Larger = more
   *  microtask interleaving (and, under Phase 4 workers, more parallel
   *  speedup). Smaller = bounded memory if `state` is huge. Default 4. */
  maxParallel?: number;
}

const DEFAULT_MAX_PARALLEL = 4;

/**
 * Run every item through its requested solver, chunked by `maxParallel`.
 * Results are returned in INPUT ORDER (not completion order) so the caller
 * can `result[i]` against `items[i]`.
 *
 * @param items  Ordered list of solve requests. May be empty (→ []).
 * @param opts   Options. `maxParallel` defaults to 4. Values < 1 are
 *               clamped to 1 (sequential — useful for deterministic tests).
 *
 * @returns Promise resolving to one BatchSolveResult per input item, in
 *          the same order.
 *
 * Errors: a single item's solver throwing causes the WHOLE batch to reject
 * (standard Promise.all semantics). This is intentional — solver throws
 * are programming errors (e.g., resolver returning the wrong shape), not
 * data errors. Solver "failure" (residual > tol after maxIterations) is
 * surfaced via `result.success === false`, NOT a throw.
 */
export async function solveBatch(
  items: ReadonlyArray<BatchSolveItem>,
  opts: SolveBatchOptions = {},
): Promise<BatchSolveResult[]> {
  const maxParallel = Math.max(1, Math.floor(opts.maxParallel ?? DEFAULT_MAX_PARALLEL));
  if (items.length === 0) return [];

  const out: BatchSolveResult[] = new Array(items.length);

  for (let start = 0; start < items.length; start += maxParallel) {
    const end = Math.min(start + maxParallel, items.length);
    const chunk: BatchSolveItem[] = [];
    for (let i = start; i < end; i++) chunk.push(items[i]!);

    // Promise.all preserves the order of the input array, so we can write
    // straight into `out[start + j]` without sorting afterwards.
    const chunkResults = await Promise.all(chunk.map((item) => runOne(item)));
    for (let j = 0; j < chunkResults.length; j++) {
      out[start + j] = chunkResults[j]!;
    }
  }

  return out;
}

// ─── per-item driver ─────────────────────────────────────────────────────

/**
 * Solve a single item, measure wall-clock, and return the BatchSolveResult.
 *
 * Wrapped as `async` so even the synchronous solver bodies hop one
 * microtask before returning — this is what gives `Promise.all` the
 * scheduling slack to interleave layout/paint on the browser side.
 */
async function runOne(item: BatchSolveItem): Promise<BatchSolveResult> {
  const t0 = nowMs();
  const result = dispatchSolver(item);
  const durationMs = nowMs() - t0;
  return { id: item.id, result, durationMs };
}

/**
 * Synchronous solver dispatch. Pure function — no I/O, no awaits.
 *
 * `IterativeSolverOptions` is the lowest-common-denominator option shape;
 * Lagrangian-specific fields are not exposed via BatchSolveItem yet, so we
 * pass only the shared fields through. Phase 4 may widen this with a
 * discriminated union (one option type per solver choice) once a real
 * caller needs e.g. lineSearch tuning per item.
 */
function dispatchSolver(item: BatchSolveItem): IterativeSolveResult {
  const opts: IterativeSolverOptions = item.options ?? {};
  switch (item.solver) {
    case 'gauss_seidel':
      return iterativeSolve(item.state, item.resolver, opts);
    case 'lagrangian':
      // lagrangianSolve takes LagrangianSolverOptions; the common fields
      // (maxIterations, tolerance) line up by name.
      return lagrangianSolve(item.state, item.resolver, {
        maxIterations: opts.maxIterations,
        tolerance: opts.tolerance,
      });
    case 'adaptive':
      return lagrangianSolveAdaptive(item.state, item.resolver, opts);
    default: {
      // Exhaustiveness guard — TypeScript catches this at compile time,
      // but the runtime throw is here for defence-in-depth against callers
      // who skirt the type system (e.g., JS interop or `as any` casts).
      const _exhaust: never = item.solver;
      throw new Error(`solveBatch: unknown solver choice ${String(_exhaust)}`);
    }
  }
}

// ─── timing helper (kept private; matches solverBenchmark.nowMs) ─────────

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
