/**
 * POST /api/assembly-solve — Phase 4 of NexyFab Pro own-CAD assembly track
 * (ADR-013).
 *
 * Validates an AssemblyState IR payload and runs the assembly solver. Two
 * modes coexist:
 *
 *   - **'stub' (Phase 1 — preserved):** when the client supplies only
 *     `state`, the endpoint runs IR-layer `validateAssembly` and returns
 *     deterministic zero-residual records, matching the contract the
 *     AssemblyBrowserModal UI and the pre-Phase-4 integration tests rely
 *     on. The "supported" flag is always true here because no real solve
 *     happens.
 *
 *   - **'real' (Phase 4 — new):** when the client also supplies
 *     `featureTrees: Record<partId, FeatureTree>`, we build a
 *     `featureTreeGeometryResolver` over that map and run `iterativeSolve`
 *     end-to-end. The response carries the actual iteration count,
 *     per-mate residuals, and a `phase: 'real'` marker. Clients can pass
 *     optional solver overrides (`maxIterations`, `tolerance`,
 *     `relaxation`) via `solverOptions`.
 *
 * Request body:
 *   {
 *     state: {
 *       parts: PartInstance[],   // ≥ 1 fixed iff len > 0
 *       mates: Mate[]            // each ref points to an existing partId
 *     },
 *     featureTrees?: Record<partId, FeatureTree>,
 *     solverOptions?: { maxIterations?, tolerance?, relaxation? },
 *     solver?: 'gauss_seidel' | 'lagrangian' | 'adaptive' | 'auto'
 *               // default 'gauss_seidel' (back-compat). 'auto' → server
 *               // picks via `pickAutoSolver` (recommendSolver + size
 *               // upgrade to 'adaptive'). The chosen solver is echoed
 *               // in `solverUsed` so the UI can display it.
 *   }
 *
 * Success response (both phases):
 *   {
 *     ok: true,
 *     success: boolean,            // (stub: always true; real: tol-pass)
 *     iterations: number,          // (stub: 0)
 *     finalMaxResidual: number,    // (stub: 0)
 *     dof: number,                 // approximateAssemblyDoF.approximate
 *     residuals: [
 *       { mateId, residual, supported }
 *     ],
 *     state?: AssemblyState,       // (real only) post-solve placements
 *     phase: 'stub' | 'real',
 *     solverUsed: 'gauss_seidel' | 'lagrangian' | 'adaptive'
 *                                  // ('auto' resolved server-side)
 *   }
 *
 * Error response:
 *   { ok: false, code: 'BAD_REQUEST' | 'INVALID_ASSEMBLY' | 'TOO_LARGE', message: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  type AssemblyState,
  approximateAssemblyDoF,
  AssemblyValidationError,
  validateAssembly,
} from '@/lib/assembly/assemblyState';
import { iterativeSolve, type IterativeSolverOptions } from '@/lib/assembly/iterativeSolver';
import {
  lagrangianSolve,
  lagrangianSolveAdaptive,
} from '@/lib/assembly/lagrangianSolver';
import { recommendSolver } from '@/lib/assembly/solverBenchmark';
import { featureTreeGeometryResolver } from '@/lib/assembly/geometryResolver';
import type { FeatureTree } from '@/lib/cad/featureTree';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Solver choice exposed by the API.
 *
 *   - 'gauss_seidel' — `iterativeSolve` (Gauss-Seidel relaxation). Default,
 *     fast on small all-analytical chains. Same as omitting the field
 *     (back-compat with pre-Phase-3.2 clients).
 *   - 'lagrangian'   — `lagrangianSolve` (Newton-LM, numeric Jacobian).
 *   - 'adaptive'     — `lagrangianSolveAdaptive` (Newton-LM + analytic
 *     Jacobian + line-search + stall detection). Recommended for large or
 *     over-constrained systems.
 *   - 'auto'         — server picks one of {gauss_seidel | lagrangian |
 *     adaptive} via `pickAutoSolver` below. The chosen solver is echoed in
 *     `solverUsed` so the UI can display the decision to the user.
 */
type SolverRequest = 'gauss_seidel' | 'lagrangian' | 'adaptive' | 'auto';
type SolverUsed = 'gauss_seidel' | 'lagrangian' | 'adaptive';

const VALID_SOLVERS: ReadonlySet<SolverRequest> = new Set<SolverRequest>([
  'gauss_seidel',
  'lagrangian',
  'adaptive',
  'auto',
]);

interface AssemblySolveBody {
  state?: unknown;
  /** Per-part FeatureTree map (keyed by PartInstance.id). When present the
   *  endpoint runs the real solver; when absent it returns the Phase 1
   *  stub response (back-compat). */
  featureTrees?: unknown;
  /** Optional solver options pass-through (maxIterations / tolerance /
   *  relaxation). Shared between Gauss-Seidel + Lagrangian — the
   *  relaxation field is ignored by the Lagrangian variants but accepted
   *  for API symmetry. */
  solverOptions?: unknown;
  /** Phase 3.2 — solver selection. Default 'gauss_seidel' for back-compat
   *  with pre-Phase-3.2 clients. */
  solver?: unknown;
}

/**
 * Pick a solver when the client requests `solver: 'auto'`.
 *
 * The base recommendation comes from `recommendSolver(state)`, which
 * already returns 'lagrangian' for ≥ 5 unfixed parts, ≥ 10 mates, advanced
 * mate kinds (gear/rack_pinion/slot/tangent), or over-constrained systems
 * — and 'gauss_seidel' otherwise. We then UPGRADE that recommendation to
 * 'adaptive' for the production-grade Newton-LM whenever:
 *
 *   - parts ≥ 10        — long chains where the adaptive line-search /
 *     stall detector materially cuts iteration count, OR
 *   - over-constrained  — DoF heuristic ≤ 0 with mates present, where
 *     plain Gauss-Seidel oscillates and even basic Lagrangian benefits
 *     from the adaptive λ schedule.
 *
 * Otherwise the base recommendation passes through unchanged:
 *   - 'lagrangian'   for ≥ 5 unfixed parts / advanced mates,
 *   - 'gauss_seidel' for everything else.
 *
 * recommendSolver itself is NOT modified (see solverBenchmark.ts) — the
 * upgrade is a pure wrapper.
 */
function pickAutoSolver(state: AssemblyState): SolverUsed {
  const base = recommendSolver(state);
  const totalParts = state.parts.length;
  const dof = approximateAssemblyDoF(state).approximate;
  const overConstrained = dof <= 0 && state.mates.length > 0;
  if (totalParts >= 10 || overConstrained) return 'adaptive';
  return base; // 'lagrangian' or 'gauss_seidel'
}

const MAX_PARTS = 1000;
const MAX_MATES = 5000;

function err(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, code, message }, { status });
}

/** Light shape check — full IR validation runs in `validateAssembly`. */
function looksLikeAssemblyState(v: unknown): v is AssemblyState {
  if (!v || typeof v !== 'object') return false;
  const s = v as { parts?: unknown; mates?: unknown };
  return Array.isArray(s.parts) && Array.isArray(s.mates);
}

/** Light shape check for the FeatureTree map. Per-tree validity is
 *  delegated to `replayTree`/`validateTree` at use-time. We just need the
 *  outer record shape + every value to look like `{ nodes: [...] }`. */
function looksLikeFeatureTreeMap(v: unknown): v is Record<string, FeatureTree> {
  if (!v || typeof v !== 'object') return false;
  for (const value of Object.values(v as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') return false;
    const t = value as { nodes?: unknown };
    if (!Array.isArray(t.nodes)) return false;
  }
  return true;
}

function looksLikeSolverOptions(v: unknown): v is IterativeSolverOptions {
  if (v === undefined || v === null) return true;
  if (typeof v !== 'object') return false;
  const o = v as Partial<IterativeSolverOptions>;
  if (o.maxIterations !== undefined && (typeof o.maxIterations !== 'number' || o.maxIterations <= 0)) {
    return false;
  }
  if (o.tolerance !== undefined && (typeof o.tolerance !== 'number' || o.tolerance <= 0)) {
    return false;
  }
  if (o.relaxation !== undefined && (typeof o.relaxation !== 'number' || o.relaxation <= 0 || o.relaxation > 1)) {
    return false;
  }
  return true;
}

function looksLikeSolverRequest(v: unknown): v is SolverRequest {
  if (v === undefined) return true; // default → 'gauss_seidel'
  if (typeof v !== 'string') return false;
  return VALID_SOLVERS.has(v as SolverRequest);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: AssemblySolveBody;
  try {
    body = (await req.json()) as AssemblySolveBody;
  } catch {
    return err('BAD_REQUEST', 'Body must be valid JSON', 400);
  }

  if (!body || typeof body !== 'object') {
    return err('BAD_REQUEST', 'Body must be a JSON object', 400);
  }
  if (!looksLikeAssemblyState(body.state)) {
    return err(
      'BAD_REQUEST',
      'state.parts and state.mates must be arrays',
      400,
    );
  }

  const state = body.state;
  if (state.parts.length > MAX_PARTS) {
    return err(
      'TOO_LARGE',
      `Assembly has ${state.parts.length} parts (max ${MAX_PARTS})`,
      413,
    );
  }
  if (state.mates.length > MAX_MATES) {
    return err(
      'TOO_LARGE',
      `Assembly has ${state.mates.length} mates (max ${MAX_MATES})`,
      413,
    );
  }

  try {
    validateAssembly(state);
  } catch (e) {
    if (e instanceof AssemblyValidationError) {
      return err('INVALID_ASSEMBLY', e.message, 400);
    }
    return err(
      'INVALID_ASSEMBLY',
      e instanceof Error ? e.message : String(e),
      400,
    );
  }

  const dof = approximateAssemblyDoF(state).approximate;

  // Solver selection is validated regardless of phase so a misspelled value
  // surfaces a 400 even on the cheap stub path. Default = 'gauss_seidel'
  // for back-compat with pre-Phase-3.2 clients (the only behaviour they
  // ever saw on the real-solve path).
  if (!looksLikeSolverRequest(body.solver)) {
    return err(
      'BAD_REQUEST',
      "solver must be one of 'gauss_seidel' | 'lagrangian' | 'adaptive' | 'auto'",
      400,
    );
  }
  const solverReq: SolverRequest = (body.solver as SolverRequest | undefined) ?? 'gauss_seidel';

  // ── 'real' phase: featureTrees provided ─────────────────────────────────
  if (body.featureTrees !== undefined) {
    if (!looksLikeFeatureTreeMap(body.featureTrees)) {
      return err(
        'BAD_REQUEST',
        'featureTrees must be an object mapping partId → { nodes: [...] }',
        400,
      );
    }
    if (!looksLikeSolverOptions(body.solverOptions)) {
      return err(
        'BAD_REQUEST',
        'solverOptions has an invalid maxIterations / tolerance / relaxation',
        400,
      );
    }
    const trees = new Map<string, FeatureTree>(
      Object.entries(body.featureTrees as Record<string, FeatureTree>),
    );
    const resolver = featureTreeGeometryResolver(trees);
    // Resolve 'auto' to a concrete choice BEFORE dispatch so the response
    // can report which solver actually ran.
    const solverUsed: SolverUsed =
      solverReq === 'auto' ? pickAutoSolver(state) : solverReq;

    // Defaults: 100 iter / 1e-4 tol match the pre-Phase-3.2 contract for
    // back-compat. The Lagrangian variants apply their own tighter
    // tolerance (1e-6) by default; passing 1e-4 here keeps the API's
    // public success criterion consistent across solvers when the client
    // doesn't override it.
    const opts: IterativeSolverOptions = {
      maxIterations: 100,
      tolerance: 1e-4,
      ...(body.solverOptions as IterativeSolverOptions | undefined),
    };
    let result;
    try {
      if (solverUsed === 'lagrangian') {
        result = lagrangianSolve(state, resolver, {
          maxIterations: opts.maxIterations,
          tolerance: opts.tolerance,
        });
      } else if (solverUsed === 'adaptive') {
        result = lagrangianSolveAdaptive(state, resolver, opts);
      } else {
        // 'gauss_seidel' — default + back-compat path.
        result = iterativeSolve(state, resolver, opts);
      }
    } catch (e) {
      // The solver itself shouldn't throw for normal input, but a malformed
      // FeatureTree node payload could surface here at first use. Translate
      // to a 400 so the caller can fix and retry rather than seeing 500.
      return err(
        'INVALID_ASSEMBLY',
        e instanceof Error ? e.message : String(e),
        400,
      );
    }
    return NextResponse.json({
      ok: true,
      success: result.success,
      iterations: result.iterations,
      finalMaxResidual: result.finalMaxResidual,
      dof,
      residuals: result.residuals,
      state: result.state,
      phase: 'real' as const,
      solverUsed,
    });
  }

  // ── Phase 1 stub response (preserved for backward compat) ───────────────
  // The stub path doesn't actually invoke a solver, so `solverUsed`
  // reports whatever the request asked for ('auto' → pickAutoSolver, even
  // though no solve ran — the UX value is "what would have run").
  const stubSolverUsed: SolverUsed =
    solverReq === 'auto' ? pickAutoSolver(state) : solverReq;
  const residuals = state.mates.map((m) => ({
    mateId: m.id,
    residual: 0,
    supported: true,
  }));

  return NextResponse.json({
    ok: true,
    success: true,
    iterations: 0,
    finalMaxResidual: 0,
    dof,
    residuals,
    phase: 'stub' as const,
    solverUsed: stubSolverUsed,
  });
}
