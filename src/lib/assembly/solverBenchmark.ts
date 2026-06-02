/**
 * solverBenchmark — Phase 3.2 documentation harness (ADR-013).
 *
 * Side-by-side comparator for the two assembly solvers we ship today:
 *
 *   - `iterativeSolve` (Gauss-Seidel relaxation, `iterativeSolver.ts`)
 *   - `lagrangianSolve` (Newton-Levenberg-Marquardt, `lagrangianSolver.ts`)
 *
 * Goals:
 *   1. Run a battery of representative scenarios (sample presets + a few
 *      synthetic stress cases) through both solvers and report duration,
 *      iteration count, success flag, and final residual.
 *   2. Provide `recommendSolver(state)` — a deterministic decision tree the
 *      assembly modal / API can call to pick a default solver based on the
 *      shape of the constraint system, without actually running both.
 *
 * The benchmark is intentionally pure (no perf timers in production paths):
 *   - Same input → same output. We use `performance.now()` averaged over
 *     N = 5 runs to smooth jitter, but ITERATION COUNT, SUCCESS, and FINAL
 *     RESIDUAL are deterministic and asserted in tests.
 *   - We never seed any randomness. Synthetic scenarios use hand-placed
 *     starting positions so the residual trajectory is reproducible.
 *
 * Decision tree (see `recommendSolver`):
 *
 *     parts < 5 AND mates < 10 ──┬─ all-analytical ─► gauss_seidel
 *                                └─ has-advanced  ──► lagrangian
 *     parts ≥ 5 OR over-constrained ──────────────► lagrangian
 *
 * The rationale, with citations to the solver header docs:
 *   - Gauss-Seidel converges in ≤ 3 sweeps for analytical mates on short
 *     chains (see iterativeSolver.ts header). Cheap startup, no Jacobian.
 *   - Lagrangian needs M·6N forward differences per Newton step but has
 *     quadratic convergence near the solution and handles rank-deficient
 *     systems via its LM damping (see lagrangianSolver.ts:24-30). It wins
 *     on long chains, over-constrained systems, and mate kinds where the
 *     Gauss-Seidel analytical placement is a no-op (gear, rack_pinion).
 *   - "Over-constrained" is detected by `approximateAssemblyDoF(state)`
 *     returning a non-positive `approximate` — heuristic, but the test
 *     fixtures show it's a reliable proxy for the cases where Gauss-Seidel
 *     stalls (oscillating between two mates pulling the same part).
 */

import type { AssemblyState, PartInstance } from './assemblyState';
import { approximateAssemblyDoF, IDENTITY_QUAT } from './assemblyState';
import type { Mate } from './mate';
import { iterativeSolve } from './iterativeSolver';
import { lagrangianSolve } from './lagrangianSolver';
import { featureTreeGeometryResolver } from './geometryResolver';
import type { FeatureTree } from '@/lib/cad/featureTree';
import { getSampleAssembly } from './sampleAssemblies';

// ─── public types ────────────────────────────────────────────────────────

export interface BenchmarkScenario {
  /** Stable id used in BenchmarkResult.scenario. */
  name: string;
  /** Assembly under test. */
  state: AssemblyState;
  /**
   * Per-part FeatureTree map fed to `featureTreeGeometryResolver`. The
   * resolver returns `null` for any part missing from this map, so every
   * mate's `partId` must have a tree here.
   */
  featureTrees: Record<string, FeatureTree>;
  /** Human-readable explanation. Echoed in the markdown report. */
  description: string;
}

export interface SolverStat {
  iterations: number;
  /** Average wall-clock time over `repeat` runs (ms). */
  durationMs: number;
  /** True iff finalResidual < the solver's tolerance. */
  success: boolean;
  /** Max residual across all mates at termination. */
  finalResidual: number;
}

export interface BenchmarkResult {
  scenario: string;
  gaussSeidel: SolverStat;
  lagrangian: SolverStat;
  /**
   * 'tie' iff (a) both succeeded AND durations differ by < 5%, OR (b) both
   * failed (neither is "winning"). Otherwise the faster successful solver
   * wins; if only one succeeded, that one wins.
   */
  winner: 'gauss_seidel' | 'lagrangian' | 'tie';
  /** durationMs(gauss_seidel) / durationMs(lagrangian). Higher = lagrangian
   *  faster. NaN-safe (clamps to 1.0 if either duration is 0). */
  ratio: number;
}

export type SolverChoice = 'gauss_seidel' | 'lagrangian';

// ─── runner ──────────────────────────────────────────────────────────────

/**
 * Number of repetitions per solver per scenario. The MIN duration across
 * runs would be more robust against GC pauses; we use the MEAN to keep the
 * report representative of typical-call latency. 5 is enough to drown
 * single-run jitter without ballooning CI time (each scenario × 2 solvers
 * × 5 runs ≈ < 200 ms total for the 6 scenarios in the seeded suite).
 */
const DEFAULT_REPEATS = 5;

export interface RunScenariosOptions {
  /** Override the per-scenario repeat count. Default 5. */
  repeats?: number;
}

/**
 * Run every scenario through both solvers `repeats` times and return one
 * BenchmarkResult per scenario. Deterministic — the iteration count,
 * success flag, and final residual are reproducible across runs; only the
 * `durationMs` field varies with machine load.
 */
export function runScenarios(
  scenarios: ReadonlyArray<BenchmarkScenario>,
  opts: RunScenariosOptions = {},
): BenchmarkResult[] {
  const repeats = Math.max(1, Math.floor(opts.repeats ?? DEFAULT_REPEATS));
  const out: BenchmarkResult[] = [];
  for (const sc of scenarios) {
    out.push(benchmarkOne(sc, repeats));
  }
  return out;
}

function benchmarkOne(
  scenario: BenchmarkScenario,
  repeats: number,
): BenchmarkResult {
  // Tolerances mirror each solver's default — we asked nothing extra of
  // them. Asking the same numeric tolerance from both would be unfair:
  // Gauss-Seidel uses 1e-4 because its residual is mm-scale, Lagrangian
  // uses 1e-6 because LM converges quadratically and tighter tolerances
  // come "for free".
  const GS_TOL = 1e-4;
  const LAG_TOL = 1e-6;

  const resolverGS = featureTreeGeometryResolver(toFeatureTreeMap(scenario.featureTrees));
  const resolverLAG = featureTreeGeometryResolver(toFeatureTreeMap(scenario.featureTrees));

  // ── Gauss-Seidel ────────────────────────────────────────────────────
  let gsLast = iterativeSolve(scenario.state, resolverGS, { tolerance: GS_TOL });
  let gsTotal = 0;
  for (let i = 0; i < repeats; i++) {
    const t0 = nowMs();
    gsLast = iterativeSolve(scenario.state, resolverGS, { tolerance: GS_TOL });
    gsTotal += nowMs() - t0;
  }
  const gaussSeidel: SolverStat = {
    iterations: gsLast.iterations,
    durationMs: gsTotal / repeats,
    success: gsLast.success,
    finalResidual: gsLast.finalMaxResidual,
  };

  // ── Lagrangian ──────────────────────────────────────────────────────
  let lagLast = lagrangianSolve(scenario.state, resolverLAG, { tolerance: LAG_TOL });
  let lagTotal = 0;
  for (let i = 0; i < repeats; i++) {
    const t0 = nowMs();
    lagLast = lagrangianSolve(scenario.state, resolverLAG, { tolerance: LAG_TOL });
    lagTotal += nowMs() - t0;
  }
  const lagrangian: SolverStat = {
    iterations: lagLast.iterations,
    durationMs: lagTotal / repeats,
    success: lagLast.success,
    finalResidual: lagLast.finalMaxResidual,
  };

  // ── Winner + ratio ──────────────────────────────────────────────────
  const ratio = lagrangian.durationMs > 0
    ? gaussSeidel.durationMs / lagrangian.durationMs
    : (gaussSeidel.durationMs === 0 ? 1.0 : Infinity);

  let winner: 'gauss_seidel' | 'lagrangian' | 'tie';
  if (gaussSeidel.success && !lagrangian.success) winner = 'gauss_seidel';
  else if (!gaussSeidel.success && lagrangian.success) winner = 'lagrangian';
  else if (!gaussSeidel.success && !lagrangian.success) winner = 'tie';
  else {
    // Both succeeded — pick the faster, but call it a tie within 5%.
    const slack = 0.05;
    const ref = Math.min(gaussSeidel.durationMs, lagrangian.durationMs);
    if (Math.abs(gaussSeidel.durationMs - lagrangian.durationMs) <= ref * slack) {
      winner = 'tie';
    } else if (gaussSeidel.durationMs < lagrangian.durationMs) {
      winner = 'gauss_seidel';
    } else {
      winner = 'lagrangian';
    }
  }

  return {
    scenario: scenario.name,
    gaussSeidel,
    lagrangian,
    winner,
    ratio,
  };
}

// ─── decision tree ───────────────────────────────────────────────────────

/**
 * Recommend a solver based on the static shape of the constraint system.
 *
 * Decision tree (in evaluation order — first match wins):
 *
 *   1. Over-constrained (heuristic DoF ≤ 0)  ─► lagrangian
 *      (Gauss-Seidel oscillates on rank-deficient systems; LM dampens.)
 *
 *   2. Any mate kind not in the "purely analytical for GS" set
 *      {coincident, concentric, distance, angle, parallel, perpendicular,
 *      hinge}  ─► lagrangian
 *      (gear/slot/rack_pinion have a no-op placement in iterativeSolver,
 *      so Gauss-Seidel can't satisfy them on its own.)
 *
 *   3. ≥ 5 unfixed parts OR ≥ 10 mates  ─► lagrangian
 *      (Newton's quadratic convergence pays off vs O(N) sweeps once the
 *      chain length grows.)
 *
 *   4. Default                ─► gauss_seidel
 *      (Small, well-conditioned, all-analytical assemblies — the common
 *      "two parts pinned by a concentric" case.)
 *
 * This is intentionally a static recommendation: the caller is free to
 * ignore it and force a solver, and a benchmark run on the real assembly
 * will always trump the heuristic. The function exists so the API has a
 * sensible default when the user picks `solver: 'auto'`.
 */
export function recommendSolver(state: AssemblyState): SolverChoice {
  // ── 1) Over-constrained → Lagrangian wins on rank-deficient Jacobians.
  const dof = approximateAssemblyDoF(state);
  if (dof.approximate <= 0 && state.mates.length > 0) {
    return 'lagrangian';
  }

  // ── 2) Mate kinds the iterative solver can't satisfy analytically.
  const activeMates = state.mates.filter((m) => !m.suppressed);
  const ANALYTICAL_FOR_GS = new Set<Mate['kind']>([
    'coincident',
    'concentric',
    'distance',
    'angle',
    'parallel',
    'perpendicular',
    'hinge',
  ]);
  const hasAdvanced = activeMates.some(
    (m) => !ANALYTICAL_FOR_GS.has(m.kind),
  );
  if (hasAdvanced) return 'lagrangian';

  // ── 3) Size threshold — long chains favour Newton convergence.
  const unfixedParts = state.parts.filter((p) => !p.fixed).length;
  if (unfixedParts >= 5 || activeMates.length >= 10) {
    return 'lagrangian';
  }

  // ── 4) Default: small all-analytical assembly → Gauss-Seidel.
  return 'gauss_seidel';
}

// ─── scenario library (used by the test suite + Phase 3.2 report) ────────

/**
 * Pre-canned scenarios that exercise the comparison matrix:
 *
 *   | name                            | parts | mates | mate kinds         | over-constrained? |
 *   |---------------------------------|-------|-------|--------------------|-------------------|
 *   | two-cubes-concentric (sample)   |   2   |   1   | concentric         | no                |
 *   | three-cubes-chain (sample)      |   3   |   2   | concentric         | no                |
 *   | hinge-pair (sample)             |   2   |   1   | hinge              | no                |
 *   | five-cube-chain (synthetic)     |   5   |   4   | concentric         | no                |
 *   | over-constrained-triangle (syn) |   3   |   3   | concentric (×3)    | yes (cycle)       |
 *   | mixed-mates (synthetic)         |   2   |   4   | concentric/coinc./ | no                |
 *   |                                 |       |       | parallel/perp.     |                   |
 *
 * The sample-derived rows go through `getSampleAssembly`; the synthetic
 * rows are built inline below.
 */
export function buildDefaultScenarios(): BenchmarkScenario[] {
  return [
    sampleScenario(
      'two-cubes-concentric',
      'Single concentric — analytical 1-shot case. Gauss-Seidel ideal.',
    ),
    sampleScenario(
      'three-cubes-chain',
      'Short chain — 2 concentric mates. Gauss-Seidel sweeps suffice.',
    ),
    sampleScenario(
      'hinge-pair',
      'Single hinge — concentric-equivalent placement. Gauss-Seidel ideal.',
    ),
    fiveCubeChainScenario(),
    overConstrainedTriangleScenario(),
    mixedMatesScenario(),
  ];
}

function sampleScenario(
  name: 'two-cubes-concentric' | 'three-cubes-chain' | 'hinge-pair',
  description: string,
): BenchmarkScenario {
  const sample = getSampleAssembly(name);
  return {
    name,
    state: sample.state,
    featureTrees: sample.featureTrees,
    description,
  };
}

// ─── synthetic scenario builders ─────────────────────────────────────────

/** Cube FeatureTree centred on local origin — same shape as the sample
 *  library but inlined so we don't depend on its private helper. */
function cubeTree(nodeId: string): FeatureTree {
  return {
    nodes: [
      {
        id: nodeId,
        name: 'CubeExtrude',
        dependencies: [],
        payload: {
          kind: 'extrude',
          loop: [
            { x: -15, y: -15 },
            { x: 15, y: -15 },
            { x: 15, y: 15 },
            { x: -15, y: 15 },
          ],
          depth: 30,
          direction: 'one_sided',
          mode: 'add',
        },
      },
    ],
  };
}

function makeCube(
  id: string,
  pos: { x: number; y: number; z: number },
  fixed = false,
): PartInstance {
  return {
    id,
    name: id,
    partTemplateId: id,
    position: pos,
    orientation: IDENTITY_QUAT,
    fixed,
  };
}

/**
 * 5 cubes pinned end-to-end by 4 concentric mates on the world Z axis.
 * This is the "long chain" stress case in the decision tree — large enough
 * that Lagrangian's Newton step beats 4 sequential Gauss-Seidel sweeps.
 */
function fiveCubeChainScenario(): BenchmarkScenario {
  const parts: PartInstance[] = [
    makeCube('chain_0', { x: 0, y: 0, z: 0 }, true),
    makeCube('chain_1', { x: 8, y: 5, z: 0 }),
    makeCube('chain_2', { x: -12, y: 4, z: 0 }),
    makeCube('chain_3', { x: 6, y: -9, z: 0 }),
    makeCube('chain_4', { x: -3, y: 11, z: 0 }),
  ];
  const mates: Mate[] = [
    { id: 'chain_m0', kind: 'concentric',
      a: { partId: 'chain_0', refId: 'z_axis', refKind: 'axis' },
      b: { partId: 'chain_1', refId: 'z_axis', refKind: 'axis' } },
    { id: 'chain_m1', kind: 'concentric',
      a: { partId: 'chain_1', refId: 'z_axis', refKind: 'axis' },
      b: { partId: 'chain_2', refId: 'z_axis', refKind: 'axis' } },
    { id: 'chain_m2', kind: 'concentric',
      a: { partId: 'chain_2', refId: 'z_axis', refKind: 'axis' },
      b: { partId: 'chain_3', refId: 'z_axis', refKind: 'axis' } },
    { id: 'chain_m3', kind: 'concentric',
      a: { partId: 'chain_3', refId: 'z_axis', refKind: 'axis' },
      b: { partId: 'chain_4', refId: 'z_axis', refKind: 'axis' } },
  ];
  const featureTrees: Record<string, FeatureTree> = {};
  for (const p of parts) featureTrees[p.id] = cubeTree(`${p.id}_extrude`);
  return {
    name: 'five-cube-chain',
    state: { parts, mates },
    description: '5 cubes chained on Z axis — long chain that benefits from Newton convergence.',
    featureTrees,
  };
}

/**
 * Over-constrained: three cubes, three concentric mates forming a CYCLE
 * (a-b, b-c, c-a). The third mate is redundant given the first two when the
 * cycle is satisfiable, and it pulls in conflict when initial positions are
 * scattered. Gauss-Seidel oscillates between the three mates; Lagrangian's
 * normal-equations regularisation handles the rank deficiency cleanly.
 */
function overConstrainedTriangleScenario(): BenchmarkScenario {
  const parts: PartInstance[] = [
    makeCube('tri_a', { x: 0, y: 0, z: 0 }, true),
    makeCube('tri_b', { x: 9, y: 7, z: 0 }),
    makeCube('tri_c', { x: -6, y: 8, z: 0 }),
  ];
  const mates: Mate[] = [
    { id: 'tri_ab', kind: 'concentric',
      a: { partId: 'tri_a', refId: 'z_axis', refKind: 'axis' },
      b: { partId: 'tri_b', refId: 'z_axis', refKind: 'axis' } },
    { id: 'tri_bc', kind: 'concentric',
      a: { partId: 'tri_b', refId: 'z_axis', refKind: 'axis' },
      b: { partId: 'tri_c', refId: 'z_axis', refKind: 'axis' } },
    { id: 'tri_ca', kind: 'concentric',
      a: { partId: 'tri_c', refId: 'z_axis', refKind: 'axis' },
      b: { partId: 'tri_a', refId: 'z_axis', refKind: 'axis' } },
  ];
  const featureTrees: Record<string, FeatureTree> = {};
  for (const p of parts) featureTrees[p.id] = cubeTree(`${p.id}_extrude`);
  return {
    name: 'over-constrained-triangle',
    state: { parts, mates },
    description: '3 cubes joined by a 3-mate cycle (a-b, b-c, c-a). Redundant constraint.',
    featureTrees,
  };
}

/**
 * Two cubes, four different mate kinds applied to them. Tests the "mixed
 * mate vocabulary" path through the decision tree — every mate is in the
 * analytical-GS set, so the recommendation depends on size (parts < 5,
 * mates < 10 → still gauss_seidel).
 */
function mixedMatesScenario(): BenchmarkScenario {
  const parts: PartInstance[] = [
    makeCube('mix_a', { x: 0, y: 0, z: 0 }, true),
    makeCube('mix_b', { x: 12, y: 8, z: 4 }),
  ];
  const mates: Mate[] = [
    { id: 'mix_concentric', kind: 'concentric',
      a: { partId: 'mix_a', refId: 'z_axis', refKind: 'axis' },
      b: { partId: 'mix_b', refId: 'z_axis', refKind: 'axis' } },
    { id: 'mix_coincident', kind: 'coincident',
      a: { partId: 'mix_a', refId: 'origin', refKind: 'point' },
      b: { partId: 'mix_b', refId: 'origin', refKind: 'point' } },
    { id: 'mix_parallel', kind: 'parallel',
      a: { partId: 'mix_a', refId: 'x_axis', refKind: 'axis' },
      b: { partId: 'mix_b', refId: 'x_axis', refKind: 'axis' } },
    { id: 'mix_perp', kind: 'perpendicular',
      a: { partId: 'mix_a', refId: 'y_axis', refKind: 'axis' },
      b: { partId: 'mix_b', refId: 'z_axis', refKind: 'axis' } },
  ];
  const featureTrees: Record<string, FeatureTree> = {};
  for (const p of parts) featureTrees[p.id] = cubeTree(`${p.id}_extrude`);
  return {
    name: 'mixed-mates',
    state: { parts, mates },
    description: '2 parts joined by 4 mate kinds (concentric + coincident + parallel + perpendicular).',
    featureTrees,
  };
}

// ─── tiny helpers ────────────────────────────────────────────────────────

function nowMs(): number {
  // Use performance.now() when available (Node 16+ and all browsers) for
  // sub-millisecond resolution; fall back to Date.now() in unusual hosts.
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function toFeatureTreeMap(rec: Record<string, FeatureTree>): Map<string, FeatureTree> {
  const map = new Map<string, FeatureTree>();
  for (const [k, v] of Object.entries(rec)) map.set(k, v);
  return map;
}
