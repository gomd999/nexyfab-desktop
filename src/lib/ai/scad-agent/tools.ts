/**
 * SCAD agent tool implementations.
 *
 * Each tool is a pure function over the session — the agent loop applies
 * the returned mutations. Implementations stay framework-free so they
 * unit-test without a server context.
 *
 * The `render` and `read_dfm` tools delegate to host adapters injected at
 * construction time — that lets us run real OpenSCAD on the server and
 * mock it in tests / dev without a dependency on the route handler.
 */
import type {
  AgentSession,
  ToolExecutor,
  ToolExecutorMap,
  ToolResult,
  WriteScadArgs,
  ApplyDiffArgs,
  AddFeatureIntentArgs,
  SearchBosl2Args,
  ReadDfmArgs,
  RenderState,
  GeometryStats,
  PlanDesignArgs,
  WriteModuleArgs,
  ComposeAssemblyArgs,
  AssemblyPlacement,
  ViewRenderArgs,
  BrepExportDrawingArgs,
  SheetMetalBendAllowanceArgs,
  SheetMetalBoxFlatArgs,
  AddGdtFrameArgs,
  GdtFrame,
  BrepPrimitiveArgs,
  BrepBooleanArgs,
  BrepFilletArgs,
  BrepChamferArgs,
  BrepShellArgs,
  BrepToMeshArgs,
  BrepExportStepArgs,
  BrepSweepArgs,
  BrepLoftArgs,
  BrepDraftArgs,
  BrepHelixArgs,
  SketchCreateArgs,
  SketchAddConstraintArgs,
  SketchSolveArgs,
  SketchToBrepExtrudeArgs,
  AddMateArgs,
  BrepToDrawingArgs,
} from './types';
import { applyUnifiedDiff, DiffApplyError } from './diff';
import { intentToScad } from '../../openscad-render/intentToScad';
import { searchBosl2 } from './bosl2Index';
import { effectiveScadSource } from './composeSource';

// ─── Host adapters (DI) ─────────────────────────────────────────────────────

/**
 * Render adapter signature — takes SCAD text, returns render state.
 * Production wires this to /api/nexyfab/openscad-render; tests pass a mock.
 */
export type RenderAdapter = (scad: string) => Promise<RenderState>;

/**
 * Geometry adapter — given the last STL bytes (or a render handle), return
 * geometry stats. Production parses STL on server; tests mock.
 */
export type GeometryAdapter = (render: RenderState) => Promise<GeometryStats>;

/**
 * DFM adapter — runs DFM analysis on the most recent geometry.
 */
export type DfmAdapter = (
  render: RenderState,
  processes: string[],
) => Promise<{ summary: string; issuesCount: number; meta?: Record<string, unknown> }>;

/**
 * Stage 2 — render the SCAD source to PNGs and pipe them through a
 * vision-capable LLM. Returns the model's textual analysis as the tool
 * output the agent reads next turn. `views` lets the agent pick fewer
 * angles to save cost; defaults to iso + front + right.
 */
export type VisionAdapter = (
  scad: string,
  prompt: string,
  opts?: { views?: import('../../openscad-render/renderPng').CameraView[] },
) => Promise<
  | { ok: true; analysis: string; provider: string; model: string; tokens: number; pngBytes: number; viewCount: number }
  | { ok: false; reason: string }
>;

/**
 * A (Stage 3) — OCCT B-rep adapter. Wraps the existing
 * `features/occtEngine.ts` so the agent never touches the real OCCT
 * registry directly. Returns handles the agent passes between calls.
 *
 * Each method returns a typed result rather than throwing — agent
 * loops fail more predictably when adapters surface errors as data.
 */
type Ok<T = Record<string, never>> = { ok: true } & T;
type Err = { ok: false; reason: string };
type BrepResult = Ok<{ handle: string; kind: string }> | Err;

export interface BrepAdapter {
  ensureReady(): Promise<void>;
  primitive(args: import('./types').BrepPrimitiveArgs): Promise<BrepResult>;
  boolean(args: import('./types').BrepBooleanArgs): Promise<BrepResult>;
  fillet(args: import('./types').BrepFilletArgs): Promise<BrepResult>;
  chamfer(args: import('./types').BrepChamferArgs): Promise<BrepResult>;
  shell(args: import('./types').BrepShellArgs): Promise<BrepResult>;
  toMesh(args: import('./types').BrepToMeshArgs): Promise<Ok<{ triangleCount: number; bbox?: { min: [number, number, number]; max: [number, number, number] } }> | Err>;
  exportStep(args: import('./types').BrepExportStepArgs): Promise<Ok<{ bytes: number }> | Err>;
  // ─── G (Stage 4) — sweep / loft / draft / helix ───────────────────────
  sweep?(args: import('./types').BrepSweepArgs): Promise<BrepResult>;
  loft?(args: import('./types').BrepLoftArgs): Promise<BrepResult>;
  draft?(args: import('./types').BrepDraftArgs): Promise<BrepResult>;
  helix?(args: import('./types').BrepHelixArgs): Promise<BrepResult>;
}

/**
 * H (Stage 4) — 2D constraint solver adapter (Solvespace-shaped).
 *
 * The agent constructs a sketch (entities + constraints), then asks the
 * solver to find a configuration that satisfies all constraints. The
 * adapter is intentionally narrow so we can swap the underlying solver
 * (Solvespace WASM, custom JS, etc.) without touching agent code.
 */
export interface SolverAdapter {
  /** True iff a solver backend is available in this environment. */
  isAvailable(): boolean;
  /** Solve the sketch in place. Returns updated entity geometry. */
  solve(sketch: import('./types').SketchState): Promise<
    | { ok: true; updatedEntities: import('./types').SketchEntity[]; residual: number }
    | { ok: false; reason: string }
  >;
}

/**
 * I (Stage 4) — Assembly mate solver adapter.
 *
 * Solves the system of mate constraints between B-rep handles.
 * In v1 we just check feasibility and return suggested transforms;
 * applying them to the B-rep registry is a follow-up.
 */
export interface MateAdapter {
  isAvailable(): boolean;
  solve(mates: import('./types').AssemblyMate[]): Promise<
    | { ok: true; transforms: Record<string, [number, number, number]>; residual: number }
    | { ok: false; reason: string }
  >;
}

/**
 * J (Stage 4) — Drawing studio adapter (HLR-driven).
 *
 * Generates 2D projection lines (visible + hidden) from a B-rep handle.
 * Called by brep_to_drawing; the agent receives metadata (line counts,
 * paper-fit) and the user gets a stored drawing artifact.
 */
export interface DrawingStudioAdapter {
  isAvailable(): boolean;
  generate(args: import('./types').BrepToDrawingArgs): Promise<
    | { ok: true; lineCount: { visible: number; hidden: number; center: number }; dimensionCount: number; sheetSize: { w: number; h: number } }
    | { ok: false; reason: string }
  >;
  /** J* 후속 — single-view SVG export so the client can render or download. */
  exportSvg?(args: import('./types').BrepExportDrawingArgs): Promise<
    | { ok: true; svg: string; bytes: number; viewBox: { x: number; y: number; w: number; h: number } }
    | { ok: false; reason: string }
  >;
}

export interface ToolHostAdapters {
  render: RenderAdapter;
  geometry: GeometryAdapter;
  dfm: DfmAdapter;
  /** Stage 2 — optional. When omitted, view_render returns a typed error. */
  vision?: VisionAdapter;
  /** A (Stage 3) — optional. When omitted, brep_* tools return NO_BREP. */
  brep?: BrepAdapter;
  /** H (Stage 4) — optional. When omitted, sketch_solve returns NO_SOLVER. */
  solver?: SolverAdapter;
  /** I (Stage 4) — optional. When omitted, solve_mates returns NO_MATE_SOLVER. */
  mateSolver?: MateAdapter;
  /** J (Stage 4) — optional. When omitted, brep_to_drawing returns NO_DRAWING. */
  drawingStudio?: DrawingStudioAdapter;
  /** K (Stage 4) — defaults to SOLO_COLLAB_ADAPTER when omitted. */
  collab?: import('./collab').CollabAdapter;
  /** R (Stage 4) — optional. Resolves an external doc reference into
   *  a B-rep handle or SCAD source. When omitted, import_doc_ref returns NO_DOC_REF. */
  docRefs?: DocRefAdapter;
  /** T (Stage 4) — optional. Linear-static FEA via CalculiX or another
   *  solver. When omitted, fea_* tools return NO_FEA. */
  fea?: FeaAdapter;
}

/**
 * T — FEA adapter (CalculiX-shaped). Same setup/solve/post pattern works
 * for FrontISTR or commercial solvers behind the same interface.
 *
 * v1 covers static linear only. Modal / buckling / nonlinear analyses
 * return UNSUPPORTED for now — those need a real solver wiring.
 */
export interface FeaAdapter {
  setup(args: import('./types').FeaSetupArgs): Promise<
    | { ok: true; studyId: string; nodeCount: number; elementCount: number }
    | { ok: false; reason: string }
  >;
  solve(args: import('./types').FeaSolveArgs): Promise<
    | { ok: true; converged: boolean; iterations: number; elapsedMs: number }
    | { ok: false; reason: string }
  >;
  stress(args: import('./types').FeaStressArgs): Promise<
    | { ok: true; maxStressMPa: number; locationMm: [number, number, number]; safetyFactor: number }
    | { ok: false; reason: string }
  >;
}

/**
 * R — Resolves external CAD references (STEP/IGES/STL/SCAD URLs or paths)
 * into agent-usable artifacts. Production wiring fetches the file, runs
 * STEP through OCCT importSTEP / SCAD through intentToScad — but the
 * adapter is intentionally narrow so we can swap fetch path (CDN, R2,
 * git LFS) without touching agent code.
 */
export interface DocRefAdapter {
  /** Fetch + parse the source. Returns brepHandle (geometry) or scadSource. */
  resolve(args: import('./types').ImportDocRefArgs): Promise<
    | { ok: true; brepHandle?: string; scadSource?: string; format: 'step' | 'iges' | 'stl' | 'scad' }
    | { ok: false; reason: string }
  >;
}

// ─── Tool factory ──────────────────────────────────────────────────────────

export function makeTools(host: ToolHostAdapters): ToolExecutorMap {
  const write_scad: ToolExecutor = async (args, session) => {
    const a = args as unknown as WriteScadArgs;
    if (typeof a.code !== 'string') {
      return { ok: false, error: 'write_scad requires { code: string }', code: 'BAD_ARGS' };
    }
    if (a.code.length > 100_000) {
      return { ok: false, error: 'SCAD source exceeds 100KB cap', code: 'TOO_LARGE' };
    }
    session.scadSource = a.code;
    // Invalidate render — caller must render again to get fresh stats.
    session.render = { ok: null, errors: [] };
    session.geometry = {};
    return {
      ok: true,
      output: `OK. SCAD source replaced (${a.code.length} bytes). Call render to verify.`,
    };
  };

  const apply_diff: ToolExecutor = async (args, session) => {
    const a = args as unknown as ApplyDiffArgs;
    if (typeof a.diff !== 'string') {
      return { ok: false, error: 'apply_diff requires { diff: string }', code: 'BAD_ARGS' };
    }
    try {
      const next = applyUnifiedDiff(session.scadSource, a.diff);
      session.scadSource = next;
      session.render = { ok: null, errors: [] };
      session.geometry = {};
      return {
        ok: true,
        output: `OK. Diff applied (source now ${next.length} bytes). Call render to verify.`,
      };
    } catch (e) {
      const err = e as DiffApplyError;
      return {
        ok: false,
        error: `Diff did not apply: ${err.message}. Re-emit with corrected line numbers / context, or use write_scad to replace the whole file.`,
        code: 'DIFF_FAILED',
      };
    }
  };

  const render: ToolExecutor = async (_args, session) => {
    // Multi-module path: render whatever effectiveScadSource computes
    // (modules + composition), falling back to scadSource for single-file.
    const source = effectiveScadSource(session);
    if (!source.trim()) {
      return {
        ok: false,
        error: 'No SCAD source to render. Use write_scad / write_module / add_feature_intent first.',
        code: 'EMPTY',
      };
    }
    try {
      const state = await host.render(source);
      session.render = state;
      // On render success, also refresh geometry so the model can read it
      // without spending a separate tool call.
      if (state.ok) {
        try {
          session.geometry = await host.geometry(state);
        } catch {
          /* geometry failure is non-fatal — model can call get_geometry explicitly */
        }
        // B2 — Auto-checkpoint after every successful render. Capture
        // the SCAD state so the agent can roll back without losing
        // a long session's progress. Capped at 8 entries (FIFO) to
        // bound memory.
        captureCheckpoint(session, deriveCheckpointLabel(session));
      }
      // S — broadcast every render outcome so peers see the live preview.
      await broadcastOp(session, { type: 'render_completed', ok: state.ok === true, triangleCount: state.triangles });
      const summary = state.ok
        ? `OK. Rendered ${state.stlBytes ?? 0} bytes, ${state.triangles ?? 0} triangles. (checkpoint #${session.checkpoints.length} saved)`
        : `FAILED with ${state.errors.length} error(s):\n${state.errors.slice(0, 5).map(e => `  line ${e.line ?? '?'}: ${e.message}`).join('\n')}`;
      return { ok: true, output: summary, meta: { renderOk: state.ok } };
    } catch (e) {
      return {
        ok: false,
        error: `render adapter threw: ${(e as Error).message}`,
        code: 'RENDER_THREW',
      };
    }
  };

  const get_geometry: ToolExecutor = async (_args, session) => {
    if (session.render.ok !== true) {
      return {
        ok: false,
        error: 'No successful render available. Call render first.',
        code: 'NO_RENDER',
      };
    }
    if (Object.keys(session.geometry).length === 0) {
      try {
        session.geometry = await host.geometry(session.render);
      } catch (e) {
        return { ok: false, error: `geometry adapter threw: ${(e as Error).message}`, code: 'GEO_THREW' };
      }
    }
    const g = session.geometry;
    const lines = [
      g.bbox ? `bbox: [${g.bbox.min.join(',')}] → [${g.bbox.max.join(',')}]` : 'bbox: <unknown>',
      g.volume_mm3 !== undefined ? `volume: ${g.volume_mm3.toFixed(2)} mm³` : '',
      g.surfaceArea_mm2 !== undefined ? `surface: ${g.surfaceArea_mm2.toFixed(2)} mm²` : '',
      g.manifold !== undefined ? `manifold: ${g.manifold}` : '',
      g.triangleCount !== undefined ? `triangles: ${g.triangleCount}` : '',
    ].filter(Boolean);
    return { ok: true, output: lines.join('\n') };
  };

  const add_feature_intent: ToolExecutor = async (args, session) => {
    const a = args as unknown as AddFeatureIntentArgs;
    if (!a.intent || typeof a.intent !== 'object') {
      return { ok: false, error: 'add_feature_intent requires { intent: { shapeId, params, features? } }', code: 'BAD_ARGS' };
    }
    const result = intentToScad(a.intent);
    if (!result.ok) {
      return {
        ok: false,
        error: `intent rejected: ${result.reason}. Use write_scad to author SCAD by hand if shape isn't supported.`,
        code: 'INTENT_REJECTED',
      };
    }
    // Replace source; downstream may use apply_diff to layer customizations.
    session.scadSource = result.scad;
    session.render = { ok: null, errors: [] };
    session.geometry = {};
    return {
      ok: true,
      output: `OK. SCAD generated from intent (${result.scad.length} bytes${result.warnings.length > 0 ? `, ${result.warnings.length} warnings` : ''}). Call render to verify.`,
      meta: { warnings: result.warnings },
    };
  };

  const search_bosl2_tool: ToolExecutor = async (args) => {
    const a = args as unknown as SearchBosl2Args;
    if (typeof a.query !== 'string' || !a.query.trim()) {
      return { ok: false, error: 'search_bosl2 requires { query: string }', code: 'BAD_ARGS' };
    }
    const limit = Math.max(1, Math.min(10, a.limit ?? 5));
    const hits = searchBosl2(a.query, limit);
    if (hits.length === 0) {
      return { ok: true, output: `No BOSL2 entries matched "${a.query}". Try simpler keywords (e.g. "gear", "thread", "screw").` };
    }
    const body = hits.map(h => `${h.name} — ${h.summary}\n  signature: ${h.signature}`).join('\n');
    return { ok: true, output: `${hits.length} match(es):\n${body}` };
  };

  const read_dfm: ToolExecutor = async (args, session) => {
    const a = args as unknown as ReadDfmArgs;
    if (session.render.ok !== true) {
      return { ok: false, error: 'No successful render. Call render first.', code: 'NO_RENDER' };
    }
    const processes = (a.processes ?? ['cnc_milling', '3d_printing']).slice(0, 4);
    try {
      const dfm = await host.dfm(session.render, processes);
      return {
        ok: true,
        output: `${dfm.issuesCount} DFM issue(s) flagged.\n${dfm.summary}`,
        meta: dfm.meta,
      };
    } catch (e) {
      return { ok: false, error: `DFM adapter threw: ${(e as Error).message}`, code: 'DFM_THREW' };
    }
  };

  // ─── Stage 1 — assembly composition tools ───────────────────────────────

  /** Pure scratchpad — agent records its breakdown so subsequent turns
   *  can follow it instead of improvising. Stored on session.designPlan;
   *  the system layer surfaces it back to the model on the next turn. */
  const plan_design: ToolExecutor = async (args, session) => {
    const a = args as unknown as PlanDesignArgs;
    if (typeof a.goal !== 'string' || !a.goal.trim()) {
      return { ok: false, error: 'plan_design requires { goal: string }', code: 'BAD_ARGS' };
    }
    const goal = a.goal.trim().slice(0, 4000);
    session.designPlan = goal;
    return {
      ok: true,
      output: `Plan recorded (${goal.length} chars). Now use write_module per part, then compose_assembly to place them.`,
    };
  };

  /** Add or replace a named SCAD module. Module names must match
   *  OpenSCAD identifier rules (start with letter/underscore, then
   *  letters/digits/underscores). */
  const write_module: ToolExecutor = async (args, session) => {
    const a = args as unknown as WriteModuleArgs;
    if (typeof a.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(a.name)) {
      return {
        ok: false,
        error: 'write_module requires { name: identifier (letters/digits/underscore, ≤64) }',
        code: 'BAD_ARGS',
      };
    }
    if (typeof a.code !== 'string') {
      return { ok: false, error: 'write_module requires { code: string }', code: 'BAD_ARGS' };
    }
    if (a.code.length > 50_000) {
      return { ok: false, error: 'module body exceeds 50KB cap', code: 'TOO_LARGE' };
    }
    // Ensure the body actually defines `module name() { ... }`. If the model
    // just emitted statements, wrap them automatically so the composition
    // can call `name()` later.
    const trimmed = a.code.trim();
    const declaresModule = new RegExp(`module\\s+${a.name}\\s*\\(`).test(trimmed);
    const body = declaresModule ? trimmed : `module ${a.name}() {\n${trimmed}\n}`;
    session.modules[a.name] = body;
    // Invalidate render — caller must render again to verify.
    session.render = { ok: null, errors: [] };
    session.geometry = {};
    return {
      ok: true,
      output: `OK. Module "${a.name}" stored (${body.length} bytes). Total modules: ${Object.keys(session.modules).length}.`,
    };
  };

  /** Returns the module roster — names, sizes, whether composition is set. */
  const list_modules: ToolExecutor = async (_args, session) => {
    const names = Object.keys(session.modules);
    if (names.length === 0) {
      return { ok: true, output: 'No modules yet. Use write_module to add the first one.' };
    }
    const rows = names.map(n => `  ${n} — ${session.modules[n].length} bytes`).join('\n');
    const compStatus = session.composition && session.composition.trim()
      ? `composition: ${session.composition.length} bytes`
      : 'composition: NOT SET (call compose_assembly to place modules)';
    return {
      ok: true,
      output: `${names.length} module(s):\n${rows}\n${compStatus}`,
    };
  };

  /** Set the top-level composition: a list of module placements with
   *  optional translate / rotate / array. Replaces any prior composition. */
  const compose_assembly: ToolExecutor = async (args, session) => {
    const a = args as unknown as ComposeAssemblyArgs;
    if (!Array.isArray(a.parts) || a.parts.length === 0) {
      return {
        ok: false,
        error: 'compose_assembly requires { parts: [{ moduleName, position?, rotation?, count?, spacing? }, ...] }',
        code: 'BAD_ARGS',
      };
    }
    if (a.parts.length > 200) {
      return { ok: false, error: 'too many parts (>200) — split into sub-assemblies', code: 'TOO_LARGE' };
    }

    const moduleSet = new Set(Object.keys(session.modules));
    const errors: string[] = [];
    for (const p of a.parts) {
      if (typeof p.moduleName !== 'string' || !moduleSet.has(p.moduleName)) {
        errors.push(`unknown module "${p.moduleName}" (call write_module first)`);
      }
    }
    if (errors.length > 0) {
      return { ok: false, error: errors.slice(0, 5).join('; '), code: 'UNKNOWN_MODULE' };
    }

    const lines: string[] = [];
    if (a.includes && Array.isArray(a.includes)) {
      for (const inc of a.includes) {
        if (typeof inc === 'string' && inc.length < 256) {
          // Sanitize path-traversal in the include literal.
          const safe = inc.replace(/[^\w/.\-<>]/g, '');
          lines.push(`include <${safe}>`);
        }
      }
      if (lines.length > 0) lines.push('');
    }
    for (const p of a.parts) lines.push(emitPlacement(p));
    session.composition = lines.join('\n');
    session.render = { ok: null, errors: [] };
    session.geometry = {};
    return {
      ok: true,
      output: `OK. Composition set with ${a.parts.length} placement(s). Call render to verify the assembly.`,
    };
  };

  // ─── Stage 2 — multimodal visual verification ──────────────────────────

  /** Render the current SCAD into multi-angle PNGs and ask a vision model
   *  to critique it. Use after a successful render when the design is
   *  visually load-bearing (assemblies, organic shapes, anything where
   *  geometric correctness alone isn't enough). Costs 5-20× more than a
   *  text-only round — agent should not call every turn. */
  const view_render: ToolExecutor = async (args, session) => {
    if (!host.vision) {
      return {
        ok: false,
        error: 'view_render is unavailable in this environment (no vision adapter).',
        code: 'NO_VISION',
      };
    }
    if (session.render.ok !== true) {
      return {
        ok: false,
        error: 'No successful render to view. Call render first and ensure it succeeds.',
        code: 'NO_RENDER',
      };
    }
    // Stage 2 — vision budget. Independent of toolCallsCap so a wedged
    // model that loops on view_render can't bankrupt the user even when
    // text-only tool budget is plentiful.
    if (session.budget.visionCallsUsed >= session.budget.visionCallsCap) {
      return {
        ok: false,
        error: `view_render budget exhausted (${session.budget.visionCallsUsed}/${session.budget.visionCallsCap}). `
          + 'Use the geometric tools (get_geometry, read_dfm) or hand back to the user.',
        code: 'BUDGET_VISION',
      };
    }
    const a = args as unknown as ViewRenderArgs;
    const userPrompt = (typeof a.prompt === 'string' && a.prompt.trim())
      ? a.prompt.trim().slice(0, 1500)
      : 'You are a CAD reviewer. Critique the rendered geometry: does it match a typical instance of what was requested? '
        + 'Are the proportions, placements and visible features correct? Be concise (3–6 bullet points). '
        + 'If something is wrong, suggest a concrete fix the SCAD agent can apply.';
    const cameraViews = mapCameraViews(a.views);
    try {
      const source = effectiveScadSource(session);
      const result = await host.vision(source, userPrompt, cameraViews ? { views: cameraViews } : undefined);
      if (!result.ok) {
        return { ok: false, error: result.reason, code: 'VISION_FAILED' };
      }
      // Charge the vision budget on success only — a failed call
      // shouldn't burn the user's credits.
      session.budget = { ...session.budget, visionCallsUsed: session.budget.visionCallsUsed + 1 };
      return {
        ok: true,
        output: `[vision: ${result.provider}/${result.model}, ${result.viewCount} views, ~${Math.round(result.pngBytes / 1024)}KB]\n${result.analysis}`,
        meta: { tokens: result.tokens, pngBytes: result.pngBytes, viewCount: result.viewCount },
      };
    } catch (e) {
      return { ok: false, error: `view_render threw: ${(e as Error).message}`, code: 'VISION_THREW' };
    }
  };

  // ─── Ω3 — Design pattern retrieval (RAG-lite for seeds) ────────────────
  //
  // Returns relevant past designs as starter prompts. Agent extends the
  // matched seed prompt rather than designing from scratch — saves tokens
  // and guarantees the result is anchored to a known-good shape.
  const find_design_patterns: ToolExecutor = async (args) => {
    const { findPatterns } = await import('./designPatternLibrary');
    const a = args as { query?: unknown; k?: unknown };
    const query = typeof a.query === 'string' ? a.query : '';
    const k = typeof a.k === 'number' && a.k > 0 && a.k <= 10 ? a.k : 3;
    const hits = findPatterns(query, k);
    if (hits.length === 0) {
      return { ok: true, output: `No matching design patterns for "${query}".`, meta: { patterns: [] } };
    }
    const lines = hits.map(p => `### ${p.title} (${p.id}, complexity ${p.complexity}/5)\n${p.description}\n  Tags: ${p.tags.join(', ')}\n  Seed: ${p.seedPrompt}\n  Source: ${p.source}`);
    return {
      ok: true,
      output: `${hits.length} match(es) for "${query}":\n\n${lines.join('\n\n')}`,
      meta: { patterns: hits },
    };
  };

  // ─── Ω2 — ML auto-mesh (FEA mesh sizing heuristic) ─────────────────────
  const auto_mesh: ToolExecutor = async (args) => {
    const { autoMesh } = await import('./autoMesh');
    const a = args as Partial<import('./autoMesh').AutoMeshInput>;
    if (!a.bboxMm || typeof a.faceCount !== 'number' || !a.goal) {
      return { ok: false, error: "auto_mesh requires { bboxMm:{w,h,d}, faceCount, goal:'accuracy|balanced|speed', minFeatureMm?, elementType? }", code: 'BAD_ARGS' };
    }
    const r = autoMesh(a as import('./autoMesh').AutoMeshInput);
    return {
      ok: true,
      output: `Mesh: ${r.expectedElements.toLocaleString()} elements, base ${r.baseSizeMm.toFixed(2)}mm, ~${r.estimatedSolveTimeS.toFixed(1)}s solve, quality ${(r.qualityScore * 100).toFixed(0)}%. ${r.notes}`,
      meta: { mesh: r },
    };
  };

  // ─── Ω1 — Topology optimization (generative design) ────────────────────
  //
  // Produces N candidate geometries on the Pareto front of mass-vs-strength
  // for a given load case. Returns voxelMask per candidate; the agent can
  // pick one and convert to B-rep (sketch_to_brep_extrude on a voxel-derived
  // outline, or future direct mesh import). Mock SIMP heuristic; swap to
  // ToPy/OpenLSTO Docker via dockerSolverAdapter pattern when ready.
  const topology_optimize: ToolExecutor = async (args) => {
    const { optimizeTopology } = await import('./topologyOptimizer');
    const a = args as Partial<import('./topologyOptimizer').TopOptInput>;
    if (!a.domain || !a.material || typeof a.maxStressMPa !== 'number'
        || !Array.isArray(a.loads) || !Array.isArray(a.supports)) {
      return { ok: false, error: 'topology_optimize requires { domain:{w,h,d}, material, maxStressMPa, loads:[{location,force}], supports:[{location}], candidateCount?, resolution?, seed? }', code: 'BAD_ARGS' };
    }
    try {
      const r = optimizeTopology(a as import('./topologyOptimizer').TopOptInput);
      // Strip voxelMask from output to keep history slim — agent only needs
      // the summary; voxelMask retained in meta for UI / downstream use.
      const summary = r.candidates.map(c => ({
        id: c.id, massG: c.massG, maxStressMPa: c.maxStressMPa, safetyFactor: c.safetyFactor,
      }));
      return {
        ok: true,
        output: `${r.candidates.length} candidate(s); ${r.paretoFront.length} feasible. ${r.notes}`,
        meta: { candidates: summary, paretoFront: r.paretoFront, fullCandidates: r.candidates },
      };
    } catch (e) {
      return { ok: false, error: `topology_optimize threw: ${(e as Error).message}`, code: 'TOPOPT_THREW' };
    }
  };

  // ─── Σ — Simulation suite (CFD/MBD/CAM/mold/optics/thermal) ────────────
  //
  // Each tool enqueues a job with the corresponding mock adapter and
  // awaits completion (timeouts cap inline). Production replaces the
  // adapter with a Docker fetch — agent surface stays identical.
  const runSim = async <TIn, TOut>(kind: string, input: TIn): Promise<{ ok: true; output: string; meta: { result: TOut; jobId: string } } | { ok: false; error: string; code: string }> => {
    const sim = await import('./simulationQueue');
    const adapters = await import('./simulationAdapters');
    adapters.bootstrapMockSolvers();
    try {
      const job = await sim.enqueueJob<TIn, TOut>(kind, input);
      const finished = await sim.awaitJob<TIn, TOut>(kind, job.id, 30_000);
      if (finished.status === 'failed') {
        return { ok: false, error: `sim ${kind} failed: ${finished.error}`, code: 'SIM_FAILED' };
      }
      return {
        ok: true,
        output: `OK. ${kind} sim done in ${(finished.finishedAtMs! - finished.enqueuedAtMs)}ms.`,
        meta: { result: finished.result!, jobId: job.id },
      };
    } catch (e) {
      return { ok: false, error: `sim ${kind} threw: ${(e as Error).message}`, code: 'SIM_THREW' };
    }
  };

  const sim_cfd: ToolExecutor = async (args) => {
    const a = args as Partial<import('./simulationAdapters').CfdInput>;
    if (!a.brepHandle || typeof a.velocityMs !== 'number' || !a.fluid || typeof a.referenceLengthMm !== 'number') {
      return { ok: false, error: 'sim_cfd requires { brepHandle, velocityMs, fluid:"air"|"water"|"oil", referenceLengthMm }', code: 'BAD_ARGS' };
    }
    return runSim('cfd', a as import('./simulationAdapters').CfdInput);
  };

  const sim_mbd: ToolExecutor = async (args) => {
    const a = args as Partial<import('./simulationAdapters').MbdInput>;
    if (!Array.isArray(a.bodies) || !Array.isArray(a.joints) || typeof a.durationS !== 'number') {
      return { ok: false, error: 'sim_mbd requires { bodies, joints, durationS, dtS?, initial? }', code: 'BAD_ARGS' };
    }
    return runSim('mbd', a as import('./simulationAdapters').MbdInput);
  };

  const sim_cam: ToolExecutor = async (args) => {
    const a = args as Partial<import('./simulationAdapters').CamInput>;
    if (!a.brepHandle || typeof a.toolDiameterMm !== 'number' || typeof a.stepoverPct !== 'number' || !a.operation || !a.stockBboxMm) {
      return { ok: false, error: 'sim_cam requires { brepHandle, toolDiameterMm, stepoverPct, operation:"rough|finish|part", stockBboxMm }', code: 'BAD_ARGS' };
    }
    return runSim('cam', a as import('./simulationAdapters').CamInput);
  };

  const sim_mold_fill: ToolExecutor = async (args) => {
    const a = args as Partial<import('./simulationAdapters').MoldFillInput>;
    if (!a.brepHandle || !a.material || typeof a.meltTempC !== 'number' || typeof a.pressureMPa !== 'number' || typeof a.wallThicknessMm !== 'number' || typeof a.volumeCm3 !== 'number') {
      return { ok: false, error: 'sim_mold_fill requires { brepHandle, material, meltTempC, pressureMPa, wallThicknessMm, volumeCm3 }', code: 'BAD_ARGS' };
    }
    return runSim('mold_fill', a as import('./simulationAdapters').MoldFillInput);
  };

  const sim_optics: ToolExecutor = async (args) => {
    const a = args as Partial<import('./simulationAdapters').OpticsInput>;
    if (!Array.isArray(a.surfaces) || !a.source) {
      return { ok: false, error: 'sim_optics requires { surfaces:[{kind, focalLengthMm?, zMm, diameterMm}], source:"parallel"|{distanceMm} }', code: 'BAD_ARGS' };
    }
    return runSim('optics', a as import('./simulationAdapters').OpticsInput);
  };

  const sim_thermal: ToolExecutor = async (args) => {
    const a = args as Partial<import('./simulationAdapters').ThermalInput>;
    if (!a.brepHandle || typeof a.powerW !== 'number' || typeof a.conductivityWmK !== 'number' || typeof a.ambientC !== 'number' || typeof a.surfaceAreaCm2 !== 'number') {
      return { ok: false, error: 'sim_thermal requires { brepHandle, powerW, conductivityWmK, ambientC, surfaceAreaCm2, convectionWm2K? }', code: 'BAD_ARGS' };
    }
    return runSim('thermal', a as import('./simulationAdapters').ThermalInput);
  };

  // ─── Z6 — Engineering catalog RAG-lite ─────────────────────────────────
  //
  // Lookup engineering knowledge by topic + free-text query. The agent
  // calls this when picking materials, seals, surface treatments, fits,
  // or fastener guidance — the result is injected into the next turn so
  // the model can cite + apply concrete spec values instead of inventing.
  const query_engineering_catalog: ToolExecutor = async (args) => {
    const { queryCatalog, listTopics } = await import('./engineeringCatalog');
    const a = args as { topic?: unknown; query?: unknown; k?: unknown };
    const validTopics = listTopics();
    const topic = typeof a.topic === 'string' ? a.topic : '';
    if (!validTopics.includes(topic as typeof validTopics[number])) {
      return { ok: false, error: `topic must be one of: ${validTopics.join(', ')}`, code: 'BAD_ARGS' };
    }
    const query = typeof a.query === 'string' ? a.query : '';
    const k = typeof a.k === 'number' && a.k > 0 && a.k <= 10 ? a.k : 3;
    const hits = queryCatalog(topic as typeof validTopics[number], query, k);
    if (hits.length === 0) {
      return { ok: true, output: `No catalog entries matched "${query}" in ${topic}.`, meta: { entries: [] } };
    }
    const lines = hits.map(h => `### ${h.title} (${h.id})\n${h.body}\n  Source: ${h.source}`);
    return {
      ok: true,
      output: `${hits.length} match(es) for "${query}" in ${topic}:\n\n${lines.join('\n\n')}`,
      meta: { entries: hits },
    };
  };

  // ─── Z5 — PMI full spec (Y14.5 / Y14.41) + MBD export ──────────────────
  //
  // Extends the GD&T tools with the rest of the model-based-definition
  // surface: datum targets, surface finishes, basic/reference dims, and
  // an AP242-flavored STEP supplement for downstream MBD viewers.
  const add_datum_target: ToolExecutor = async (args, session) => {
    const a = args as Partial<import('./types').DatumTarget>;
    if (!a.letter || typeof a.index !== 'number' || !a.type || !Array.isArray(a.location) || a.location.length !== 3) {
      return { ok: false, error: "add_datum_target requires { letter, index, type:'point|line|area', location:[x,y,z], sizeMm? }", code: 'BAD_ARGS' };
    }
    if (!session.datumTargets) session.datumTargets = [];
    const target: import('./types').DatumTarget = {
      letter: a.letter, index: a.index, type: a.type,
      location: a.location as [number, number, number],
      sizeMm: typeof a.sizeMm === 'number' ? a.sizeMm : undefined,
    };
    session.datumTargets.push(target);
    return { ok: true, output: `OK. Added datum target ${a.letter}${a.index} (${a.type}) at [${a.location.join(',')}].`, meta: { target } };
  };

  const add_surface_finish: ToolExecutor = async (args, session) => {
    const a = args as Partial<import('./types').SurfaceFinish> & { id?: string };
    if (!a.featureRef || !a.roughnessRaUm || typeof a.roughnessRaUm.upper !== 'number') {
      return { ok: false, error: 'add_surface_finish requires { featureRef, roughnessRaUm:{upper, lower?}, lay?, machining? }', code: 'BAD_ARGS' };
    }
    if (!session.surfaceFinishes) session.surfaceFinishes = [];
    const id = a.id ?? `sf_${session.surfaceFinishes.length + 1}`;
    const sf: import('./types').SurfaceFinish = {
      id, featureRef: a.featureRef,
      roughnessRaUm: a.roughnessRaUm,
      lay: a.lay,
      machining: a.machining,
    };
    session.surfaceFinishes.push(sf);
    const range = sf.roughnessRaUm.lower !== undefined
      ? `Ra ${sf.roughnessRaUm.lower}-${sf.roughnessRaUm.upper}μm`
      : `Ra ${sf.roughnessRaUm.upper}μm`;
    return { ok: true, output: `OK. Added surface finish ${id} on ${a.featureRef}: ${range}.`, meta: { surfaceFinish: sf } };
  };

  const add_annotated_dimension: ToolExecutor = async (args, session) => {
    const a = args as Partial<import('./types').AnnotatedDimension> & { id?: string };
    if (!a.featureRef || typeof a.valueMm !== 'number' || !a.kind) {
      return { ok: false, error: "add_annotated_dimension requires { featureRef, kind:'standard|basic|reference|auxiliary', valueMm, tolerance? }", code: 'BAD_ARGS' };
    }
    if (!session.annotatedDimensions) session.annotatedDimensions = [];
    const id = a.id ?? `dim_${session.annotatedDimensions.length + 1}`;
    const dim: import('./types').AnnotatedDimension = {
      id, featureRef: a.featureRef,
      kind: a.kind, valueMm: a.valueMm,
      tolerance: a.tolerance,
    };
    session.annotatedDimensions.push(dim);
    return { ok: true, output: `OK. Added ${a.kind} dimension ${id}: ${a.valueMm}mm on ${a.featureRef}.`, meta: { dimension: dim } };
  };

  const export_pmi_step_ap242: ToolExecutor = async (args, session) => {
    const { exportPmi } = await import('./pmiExport');
    const a = args as { partName?: unknown; brepHandle?: unknown };
    const partName = typeof a.partName === 'string' ? a.partName : 'part';
    const brepHandle = typeof a.brepHandle === 'string' ? a.brepHandle : undefined;
    const result = exportPmi({
      partName,
      gdtFrames: session.gdtFrames ?? [],
      datumTargets: session.datumTargets ?? [],
      surfaceFinishes: session.surfaceFinishes ?? [],
      annotatedDimensions: session.annotatedDimensions ?? [],
      brepHandle,
    });
    return {
      ok: true,
      output: `OK. PMI exported: ${result.byteCounts.json} B JSON + ${result.byteCounts.step} B AP242 supplement. Use both alongside the geometry STEP.`,
      meta: {
        companionJson: result.companionJson,
        stepSupplement: result.stepSupplement,
        bytes: result.byteCounts,
      },
    };
  };

  // ─── Z4 — Standards library lookups ─────────────────────────────────────
  //
  // Catalogs the agent can query when the user says "use a 6204 bearing"
  // or "1/4-20 bolt" — returns dimensional + load data so the agent can
  // size the geometry without inventing numbers.
  const lookup_imperial_fastener: ToolExecutor = async (args) => {
    const { lookupImperial } = await import('../../openscad-render/standardsLibrary');
    const a = args as { designation?: unknown };
    const desig = typeof a.designation === 'string' ? a.designation : '';
    if (!desig) return { ok: false, error: 'lookup_imperial_fastener requires { designation: e.g. "1/4-20" }', code: 'BAD_ARGS' };
    const f = lookupImperial(desig);
    if (!f) return { ok: false, error: `unknown imperial fastener "${desig}"`, code: 'NOT_FOUND' };
    return {
      ok: true,
      output: `${f.designation}: Ø${f.dInch}" (${(f.dInch * 25.4).toFixed(2)}mm), ${f.tpi} tpi, ${f.series}, hex ${f.hexAcrossFlatsInch}"`,
      meta: { fastener: f },
    };
  };

  const select_bearing: ToolExecutor = async (args) => {
    const { selectBearing, lookupBearing } = await import('../../openscad-render/standardsLibrary');
    const a = args as { designation?: unknown; loadN?: unknown; rpm?: unknown; minBoreMm?: unknown };
    if (typeof a.designation === 'string') {
      const b = lookupBearing(a.designation);
      if (!b) return { ok: false, error: `unknown bearing "${a.designation}"`, code: 'NOT_FOUND' };
      return { ok: true, output: `${b.designation}: bore ${b.boreMm}, OD ${b.odMm}, w ${b.widthMm}, dyn ${b.dynamicLoadN}N`, meta: { bearing: b } };
    }
    if (typeof a.loadN !== 'number' || typeof a.rpm !== 'number') {
      return { ok: false, error: 'select_bearing requires { designation } OR { loadN, rpm, minBoreMm? }', code: 'BAD_ARGS' };
    }
    const b = selectBearing(a.loadN, a.rpm, { minBoreMm: typeof a.minBoreMm === 'number' ? a.minBoreMm : undefined });
    if (!b) return { ok: false, error: `no catalog bearing meets ${a.loadN}N @ ${a.rpm}rpm`, code: 'NOT_FOUND' };
    return { ok: true, output: `Selected ${b.designation}: bore ${b.boreMm}, OD ${b.odMm}, w ${b.widthMm}`, meta: { bearing: b } };
  };

  const select_key: ToolExecutor = async (args) => {
    const { selectKey } = await import('../../openscad-render/standardsLibrary');
    const a = args as { shaftDiameterMm?: unknown };
    const d = typeof a.shaftDiameterMm === 'number' ? a.shaftDiameterMm : NaN;
    if (!Number.isFinite(d)) return { ok: false, error: 'select_key requires { shaftDiameterMm }', code: 'BAD_ARGS' };
    const k = selectKey(d);
    if (!k) return { ok: false, error: `no DIN 6885 key fits Ø${d}mm shaft`, code: 'NOT_FOUND' };
    return { ok: true, output: `${k.bMm}×${k.hMm} key (lengths ${k.lengthsMm.join(',')}mm)`, meta: { key: k } };
  };

  const select_retaining_ring: ToolExecutor = async (args) => {
    const { selectRetainingRing } = await import('../../openscad-render/standardsLibrary');
    const a = args as { type?: unknown; diameterMm?: unknown };
    const type = a.type === 'external' || a.type === 'internal' ? a.type : null;
    const d = typeof a.diameterMm === 'number' ? a.diameterMm : NaN;
    if (!type || !Number.isFinite(d)) {
      return { ok: false, error: "select_retaining_ring requires { type: 'external'|'internal', diameterMm }", code: 'BAD_ARGS' };
    }
    const r = selectRetainingRing(type, d);
    if (!r) return { ok: false, error: `no ${type} retaining ring at Ø${d}`, code: 'NOT_FOUND' };
    return { ok: true, output: `DIN ${type === 'external' ? '471' : '472'} Ø${r.nominalDiameterMm}: t=${r.thicknessMm}, groove Ø${r.grooveDiameterMm}, w=${r.grooveWidthMm}`, meta: { ring: r } };
  };

  const select_drill: ToolExecutor = async (args) => {
    const { selectDrillForHole } = await import('../../openscad-render/standardsLibrary');
    const a = args as { diameterMm?: unknown };
    const d = typeof a.diameterMm === 'number' ? a.diameterMm : NaN;
    if (!Number.isFinite(d)) return { ok: false, error: 'select_drill requires { diameterMm }', code: 'BAD_ARGS' };
    const drill = selectDrillForHole(d);
    if (!drill) return { ok: false, error: `no catalog drill ≥ ${d}mm`, code: 'NOT_FOUND' };
    return { ok: true, output: `${drill.designation} drill: Ø${drill.diameterMm.toFixed(3)}mm (${drill.diameterInch}\")`, meta: { drill } };
  };

  // A3 — additional standards library lookups
  const lookup_socket_head_cap: ToolExecutor = async (args) => {
    const { lookupSocketHeadCap } = await import('../../openscad-render/standardsLibrary');
    const a = args as { size?: unknown };
    const size = typeof a.size === 'string' ? a.size : '';
    if (!size) return { ok: false, error: 'lookup_socket_head_cap requires { size: "M3"|"M4"|... }', code: 'BAD_ARGS' };
    const s = lookupSocketHeadCap(size);
    if (!s) return { ok: false, error: `unknown ISO 4762 size "${size}"`, code: 'NOT_FOUND' };
    return {
      ok: true,
      output: `ISO 4762 ${s.designation}: head Ø${s.headDiameterMm}×${s.headHeightMm}h, hex ${s.hexSocketAfMm} AF, lengths ${s.lengthsMm.join(',')}`,
      meta: { screw: s },
    };
  };

  const lookup_countersunk_screw: ToolExecutor = async (args) => {
    const { lookupCountersunk } = await import('../../openscad-render/standardsLibrary');
    const a = args as { size?: unknown };
    const size = typeof a.size === 'string' ? a.size : '';
    if (!size) return { ok: false, error: 'lookup_countersunk_screw requires { size: "M3"|"M4"|... }', code: 'BAD_ARGS' };
    const s = lookupCountersunk(size);
    if (!s) return { ok: false, error: `unknown ISO 10642 size "${size}"`, code: 'NOT_FOUND' };
    return {
      ok: true,
      output: `ISO 10642 ${s.designation}: 90° head Ø${s.headDiameterMm}×${s.headHeightMm} sink, hex ${s.hexSocketAfMm} AF`,
      meta: { screw: s },
    };
  };

  const lookup_dowel_pin: ToolExecutor = async (args) => {
    const { lookupDowelPin } = await import('../../openscad-render/standardsLibrary');
    const a = args as { diameterMm?: unknown };
    const d = typeof a.diameterMm === 'number' ? a.diameterMm : NaN;
    if (!Number.isFinite(d)) return { ok: false, error: 'lookup_dowel_pin requires { diameterMm }', code: 'BAD_ARGS' };
    const p = lookupDowelPin(d);
    if (!p) return { ok: false, error: `no DIN 7 dowel pin at Ø${d}mm`, code: 'NOT_FOUND' };
    return {
      ok: true,
      output: `DIN 7 dowel Ø${p.diameterMm} (${p.toleranceClass}), lengths ${p.lengthsMm.join(',')}mm`,
      meta: { pin: p },
    };
  };

  const select_tapered_bearing: ToolExecutor = async (args) => {
    const { selectTaperedBearing, lookupTaperedBearing } = await import('../../openscad-render/standardsLibrary');
    const a = args as { designation?: unknown; loadN?: unknown; minBoreMm?: unknown };
    if (typeof a.designation === 'string') {
      const b = lookupTaperedBearing(a.designation);
      if (!b) return { ok: false, error: `unknown tapered bearing "${a.designation}"`, code: 'NOT_FOUND' };
      return { ok: true, output: `${b.designation}: bore ${b.boreMm}, OD ${b.odMm}, T ${b.widthMm}, dyn ${b.dynamicLoadN}N`, meta: { bearing: b } };
    }
    if (typeof a.loadN !== 'number') {
      return { ok: false, error: 'select_tapered_bearing requires { designation } OR { loadN, minBoreMm? }', code: 'BAD_ARGS' };
    }
    const b = selectTaperedBearing(a.loadN, { minBoreMm: typeof a.minBoreMm === 'number' ? a.minBoreMm : undefined });
    if (!b) return { ok: false, error: `no tapered bearing meets ${a.loadN}N`, code: 'NOT_FOUND' };
    return { ok: true, output: `Selected ${b.designation}: bore ${b.boreMm}, OD ${b.odMm}, T ${b.widthMm}`, meta: { bearing: b } };
  };

  // ─── Z1 — Parametric feature tree ──────────────────────────────────────
  //
  // Inspect and edit the design intent graph. The brep_* tools register
  // nodes automatically when the tree is enabled; these tools let the
  // agent (or user) navigate, mutate parameters, or remove subtrees and
  // see what's downstream-affected without re-running the whole sequence.
  const tree_summary: ToolExecutor = async (_args, session) => {
    const { summarizeTree } = await import('./featureTree');
    const tree = session.featureTree;
    if (!tree || Object.keys(tree.nodes).length === 0) {
      return { ok: true, output: 'Feature tree is empty.' };
    }
    return { ok: true, output: `Feature tree (${Object.keys(tree.nodes).length} nodes):\n${summarizeTree(tree)}` };
  };

  const tree_set_param: ToolExecutor = async (args, session) => {
    const { updateParam } = await import('./featureTree');
    const a = args as { nodeId?: unknown; key?: unknown; value?: unknown };
    const nodeId = typeof a.nodeId === 'string' ? a.nodeId : '';
    const key = typeof a.key === 'string' ? a.key : '';
    if (!nodeId || !key) {
      return { ok: false, error: 'tree_set_param requires { nodeId, key, value }', code: 'BAD_ARGS' };
    }
    if (!session.featureTree) {
      return { ok: false, error: 'feature tree not initialized for this session', code: 'NO_TREE' };
    }
    const r = updateParam(session.featureTree, nodeId, key, a.value);
    if (!r.ok) return { ok: false, error: r.reason, code: 'NOT_FOUND' };
    return {
      ok: true,
      output: `OK. ${r.dirty.length} node(s) marked dirty: ${r.dirty.join(', ')}. Call render or rebuild_tree to materialize.`,
      meta: { dirty: r.dirty },
    };
  };

  const tree_remove_node: ToolExecutor = async (args, session) => {
    const { removeNode } = await import('./featureTree');
    const a = args as { nodeId?: unknown };
    const nodeId = typeof a.nodeId === 'string' ? a.nodeId : '';
    if (!nodeId) return { ok: false, error: 'tree_remove_node requires { nodeId }', code: 'BAD_ARGS' };
    if (!session.featureTree) return { ok: false, error: 'feature tree not initialized', code: 'NO_TREE' };
    const newRoots = removeNode(session.featureTree, nodeId);
    return {
      ok: true,
      output: `OK. Removed ${nodeId}. ${newRoots.length} child(ren) became orphan/dirty: ${newRoots.join(', ') || '(none)'}.`,
      meta: { newRoots },
    };
  };

  // ─── Y3 — Multi-turn user preferences ──────────────────────────────────
  //
  // Tiny key/value scratchpad the agent can write to remember user
  // habits across turns. Keys MUST be short, lowercase ASCII (no PII).
  // Values capped to 200 chars. The next session.userPrefs lookup is
  // surfaced verbatim in the system prompt so the model can honor the
  // preference without the user re-stating it.
  const set_user_pref: ToolExecutor = async (args, session) => {
    const a = args as { key?: unknown; value?: unknown };
    const key = typeof a.key === 'string' ? a.key.trim().toLowerCase() : '';
    const value = typeof a.value === 'string' ? a.value.trim().slice(0, 200) : '';
    if (!/^[a-z0-9_]{1,40}$/.test(key)) {
      return { ok: false, error: 'set_user_pref requires { key: string (a-z0-9_, ≤40), value: string }', code: 'BAD_ARGS' };
    }
    if (!value) {
      return { ok: false, error: 'value must be non-empty (use forget_user_pref to remove)', code: 'BAD_ARGS' };
    }
    if (!session.userPrefs) session.userPrefs = {};
    session.userPrefs[key] = value;
    return { ok: true, output: `OK. Saved preference ${key}=${value}. Will apply to future turns.`, meta: { key, value } };
  };

  const get_user_prefs: ToolExecutor = async (_args, session) => {
    const prefs = session.userPrefs ?? {};
    const entries = Object.entries(prefs);
    if (entries.length === 0) {
      return { ok: true, output: 'No saved preferences yet. Call set_user_pref to remember a setting.' };
    }
    const lines = entries.map(([k, v]) => `  ${k} = ${v}`);
    return { ok: true, output: `${entries.length} preference(s):\n${lines.join('\n')}`, meta: { prefs } };
  };

  const forget_user_pref: ToolExecutor = async (args, session) => {
    const a = args as { key?: unknown };
    const key = typeof a.key === 'string' ? a.key.trim().toLowerCase() : '';
    if (!key) return { ok: false, error: 'forget_user_pref requires { key }', code: 'BAD_ARGS' };
    if (!session.userPrefs || !(key in session.userPrefs)) {
      return { ok: true, output: `No preference named ${key} — nothing to forget.` };
    }
    delete session.userPrefs[key];
    return { ok: true, output: `OK. Forgot ${key}.` };
  };

  // ─── Y1 — Clarification turn ────────────────────────────────────────────
  //
  // Lets the agent pause and ask the user a question instead of guessing
  // when intent is ambiguous (e.g. "make a bracket" → cast vs sheet vs
  // 3D-printed?). The runner detects this tool call and terminates the
  // turn with status='awaiting_user'; the next user prompt is treated
  // as the answer and resumes the loop.
  //
  // The result.meta carries `question` and optional `options` so the
  // panel UI can render a quick-reply chip strip.
  const ask_user: ToolExecutor = async (args, session) => {
    const a = args as { question?: unknown; options?: unknown };
    const question = typeof a.question === 'string' ? a.question.trim() : '';
    if (!question) {
      return { ok: false, error: 'ask_user requires { question: string, options?: string[] }', code: 'BAD_ARGS' };
    }
    const options = Array.isArray(a.options)
      ? a.options.filter((o): o is string => typeof o === 'string').slice(0, 6)
      : undefined;
    // The runner reads status to decide whether to loop again. Setting it
    // here is the cleanest signal — the check happens right after this
    // tool's result is appended to history.
    session.status = 'awaiting_user';
    return {
      ok: true,
      output: `Asked user: ${question}${options ? `\nOptions: ${options.join(' | ')}` : ''}`,
      meta: { question, options },
    };
  };

  // ─── B2 — Checkpoint / revert tools ────────────────────────────────────

  /** List the checkpoints captured during this session. Each entry is
   *  the state we held after a successful render. */
  const list_checkpoints: ToolExecutor = async (_args, session) => {
    if (session.checkpoints.length === 0) {
      return { ok: true, output: 'No checkpoints yet — they appear after each successful render.' };
    }
    const lines = session.checkpoints.map(c =>
      `#${c.index} — ${c.label} (${new Date(c.ts).toISOString().slice(11, 19)})`,
    );
    return { ok: true, output: `${session.checkpoints.length} checkpoint(s):\n${lines.join('\n')}` };
  };

  /** Restore the named checkpoint into the live session. */
  const revert_to_checkpoint: ToolExecutor = async (args, session) => {
    const a = args as unknown as { index?: unknown };
    const idx = typeof a.index === 'number' ? a.index : NaN;
    if (!Number.isFinite(idx) || idx < 1) {
      return { ok: false, error: 'revert_to_checkpoint requires { index: positive integer }', code: 'BAD_ARGS' };
    }
    const cp = session.checkpoints.find(c => c.index === idx);
    if (!cp) {
      const avail = session.checkpoints.map(c => c.index).join(', ') || '(none)';
      return { ok: false, error: `checkpoint #${idx} not found. Available: ${avail}`, code: 'NOT_FOUND' };
    }
    session.scadSource = cp.scadSource;
    session.modules = { ...cp.modules };
    session.composition = cp.composition;
    session.designPlan = cp.designPlan;
    // Restoring invalidates the live render — caller should re-render.
    session.render = { ok: null, errors: [] };
    session.geometry = {};
    return {
      ok: true,
      output: `OK. Reverted to checkpoint #${idx} (${cp.label}). Call render to verify.`,
    };
  };

  // ─── A (Stage 3) — OCCT B-rep tools ────────────────────────────────────

  /** Common helper: register the result of a B-rep op on the session
   *  so list_breps and downstream tools can find it. Also broadcasts
   *  the op to collab subscribers so multi-user sessions stay in sync. */
  const recordBrep = (handle: string, kind: string, label?: string) => {
    // Note: caller pushes the entry into session.brepEntries; we just
    // build it here. Broadcast happens in a sidecar helper below.
    return { handle, kind, label, ts: Date.now() };
  };

  // Z1 — Lazy-init the feature tree on first brep op + register a node
  // for this op. `op` mirrors the brep_* tool name minus the prefix.
  // Lazy import keeps the module dep light when tools are tree-shaken.
  const registerNode = async (
    session: AgentSession,
    op: import('./featureTree').FeatureNode['op'],
    handle: string,
    params: Record<string, unknown>,
    parents: string[],
    name?: string,
  ): Promise<void> => {
    const { createFeatureTree, addFeatureNode } = await import('./featureTree');
    if (!session.featureTree) session.featureTree = createFeatureTree();
    addFeatureNode(session.featureTree, {
      id: handle, op, params, parents, name, resultHandle: handle,
    });
  };

  /** S — Best-effort broadcast helper called after every successful
   *  geometry-mutating op. Skipped silently when no collab adapter. */
  const broadcastOp = async (session: AgentSession, op: import('./collab').AgentOp): Promise<void> => {
    if (!host.collab) return;
    try { await host.collab.applyOp(session, op); } catch { /* swallow */ }
  };

  const brepGuard = (s: AgentSession): ToolResult | null => {
    if (!host.brep) {
      return {
        ok: false,
        error: 'B-rep is unavailable in this environment (OCCT not configured).',
        code: 'NO_BREP',
      };
    }
    void s;
    return null;
  };

  const brep_primitive: ToolExecutor = async (args, session) => {
    const guard = brepGuard(session); if (guard) return guard;
    const a = args as unknown as BrepPrimitiveArgs;
    if (!a.shape || !a.params || typeof a.params !== 'object') {
      return { ok: false, error: 'brep_primitive requires { shape, params }', code: 'BAD_ARGS' };
    }
    await host.brep!.ensureReady();
    const r = await host.brep!.primitive(a);
    if (!r.ok) return { ok: false, error: r.reason, code: 'BREP_FAILED' };
    session.brepEntries.push(recordBrep(r.handle, r.kind));
    await registerNode(session, 'primitive', r.handle, a.params as Record<string, unknown>, []);
    await broadcastOp(session, { type: 'brep_added', handle: r.handle, kind: r.kind });
    return {
      ok: true,
      output: `OK. Created ${r.kind} as handle ${r.handle}. Total B-reps: ${session.brepEntries.length}.`,
      meta: { handle: r.handle },
    };
  };

  const brep_boolean: ToolExecutor = async (args, session) => {
    const guard = brepGuard(session); if (guard) return guard;
    const a = args as unknown as BrepBooleanArgs;
    if (!a.op || !a.hostHandle || !a.toolHandle) {
      return { ok: false, error: 'brep_boolean requires { op, hostHandle, toolHandle }', code: 'BAD_ARGS' };
    }
    if (!['union', 'subtract', 'intersect'].includes(a.op)) {
      return { ok: false, error: `op must be union/subtract/intersect, got "${a.op}"`, code: 'BAD_ARGS' };
    }
    await host.brep!.ensureReady();
    const r = await host.brep!.boolean(a);
    if (!r.ok) return { ok: false, error: r.reason, code: 'BREP_FAILED' };
    session.brepEntries.push(recordBrep(r.handle, r.kind));
    await registerNode(session, 'boolean', r.handle, { op: a.op }, [a.hostHandle, a.toolHandle]);
    await broadcastOp(session, { type: 'brep_added', handle: r.handle, kind: r.kind });
    return { ok: true, output: `OK. ${a.op} → handle ${r.handle}.`, meta: { handle: r.handle } };
  };

  const brep_fillet: ToolExecutor = async (args, session) => {
    const guard = brepGuard(session); if (guard) return guard;
    const a = args as unknown as BrepFilletArgs;
    if (!a.hostHandle || typeof a.radius !== 'number' || a.radius <= 0) {
      return { ok: false, error: 'brep_fillet requires { hostHandle, radius:>0 }', code: 'BAD_ARGS' };
    }
    await host.brep!.ensureReady();
    const r = await host.brep!.fillet(a);
    if (!r.ok) return { ok: false, error: r.reason, code: 'BREP_FAILED' };
    session.brepEntries.push(recordBrep(r.handle, r.kind));
    await registerNode(session, 'fillet', r.handle, { radius: a.radius }, [a.hostHandle]);
    await broadcastOp(session, { type: 'brep_added', handle: r.handle, kind: r.kind });
    return { ok: true, output: `OK. fillet r=${a.radius} → handle ${r.handle}.`, meta: { handle: r.handle } };
  };

  const brep_chamfer: ToolExecutor = async (args, session) => {
    const guard = brepGuard(session); if (guard) return guard;
    const a = args as unknown as BrepChamferArgs;
    if (!a.hostHandle || typeof a.distance !== 'number' || a.distance <= 0) {
      return { ok: false, error: 'brep_chamfer requires { hostHandle, distance:>0 }', code: 'BAD_ARGS' };
    }
    await host.brep!.ensureReady();
    const r = await host.brep!.chamfer(a);
    if (!r.ok) return { ok: false, error: r.reason, code: 'BREP_FAILED' };
    session.brepEntries.push(recordBrep(r.handle, r.kind));
    await registerNode(session, 'chamfer', r.handle, { distance: a.distance }, [a.hostHandle]);
    await broadcastOp(session, { type: 'brep_added', handle: r.handle, kind: r.kind });
    return { ok: true, output: `OK. chamfer d=${a.distance} → handle ${r.handle}.`, meta: { handle: r.handle } };
  };

  const brep_shell: ToolExecutor = async (args, session) => {
    const guard = brepGuard(session); if (guard) return guard;
    const a = args as unknown as BrepShellArgs;
    if (!a.hostHandle || typeof a.thickness !== 'number' || a.thickness <= 0) {
      return { ok: false, error: 'brep_shell requires { hostHandle, thickness:>0, openFace? }', code: 'BAD_ARGS' };
    }
    await host.brep!.ensureReady();
    const r = await host.brep!.shell(a);
    if (!r.ok) return { ok: false, error: r.reason, code: 'BREP_FAILED' };
    session.brepEntries.push(recordBrep(r.handle, r.kind));
    await registerNode(session, 'shell', r.handle, { thickness: a.thickness, openFace: a.openFace }, [a.hostHandle]);
    await broadcastOp(session, { type: 'brep_added', handle: r.handle, kind: r.kind });
    return { ok: true, output: `OK. shell t=${a.thickness} → handle ${r.handle}.`, meta: { handle: r.handle } };
  };

  const brep_to_mesh: ToolExecutor = async (args, session) => {
    const guard = brepGuard(session); if (guard) return guard;
    const a = args as unknown as BrepToMeshArgs;
    if (!a.hostHandle) return { ok: false, error: 'brep_to_mesh requires { hostHandle }', code: 'BAD_ARGS' };
    await host.brep!.ensureReady();
    const r = await host.brep!.toMesh(a);
    if (!r.ok) return { ok: false, error: r.reason, code: 'BREP_FAILED' };
    const bbox = r.bbox ? `bbox: [${r.bbox.min.join(',')}] → [${r.bbox.max.join(',')}]` : 'bbox: <none>';
    return {
      ok: true,
      output: `OK. Tessellated ${a.hostHandle}: ${r.triangleCount} triangles. ${bbox}`,
      meta: { handle: a.hostHandle, triangleCount: r.triangleCount, bbox: r.bbox },
    };
  };

  const brep_export_step: ToolExecutor = async (args, session) => {
    const guard = brepGuard(session); if (guard) return guard;
    const a = args as unknown as BrepExportStepArgs;
    if (!a.hostHandle) return { ok: false, error: 'brep_export_step requires { hostHandle }', code: 'BAD_ARGS' };
    await host.brep!.ensureReady();
    const r = await host.brep!.exportStep(a);
    if (!r.ok) return { ok: false, error: r.reason, code: 'BREP_FAILED' };
    return {
      ok: true,
      output: `OK. STEP exported (${r.bytes} bytes). Real B-rep — opens cleanly in any CAD viewer.`,
      meta: { handle: a.hostHandle, bytes: r.bytes },
    };
  };

  const list_breps: ToolExecutor = async (_args, session) => {
    if (session.brepEntries.length === 0) {
      return { ok: true, output: 'No B-reps yet. Use brep_primitive to create the first one.' };
    }
    const lines = session.brepEntries.map(e => `  ${e.handle} — ${e.kind}${e.label ? ` (${e.label})` : ''}`);
    return { ok: true, output: `${session.brepEntries.length} B-rep(s):\n${lines.join('\n')}` };
  };

  // ─── G (Stage 4) — sweep / loft / draft / helix ────────────────────────

  const brepCallable = <T extends keyof BrepAdapter>(
    method: T,
    args: unknown,
    session: AgentSession,
    kindLabel: string,
  ): Promise<ToolResult> => {
    return (async () => {
      const guard = brepGuard(session); if (guard) return guard;
      const fn = host.brep![method] as ((a: unknown) => Promise<BrepResult>) | undefined;
      if (!fn) {
        return { ok: false, error: `${kindLabel} not implemented in this brep adapter`, code: 'BREP_NOT_IMPL' };
      }
      try {
        await host.brep!.ensureReady();
        const r = await fn.call(host.brep, args);
        if (!r.ok) return { ok: false, error: r.reason, code: 'BREP_FAILED' };
        session.brepEntries.push(recordBrep(r.handle, r.kind));
        await broadcastOp(session, { type: 'brep_added', handle: r.handle, kind: r.kind });
        return { ok: true, output: `OK. ${kindLabel} → handle ${r.handle}.`, meta: { handle: r.handle } };
      } catch (e) {
        return { ok: false, error: `${kindLabel} threw: ${(e as Error).message}`, code: 'BREP_THREW' };
      }
    })();
  };

  const brep_sweep: ToolExecutor = async (args, session) => {
    const a = args as unknown as BrepSweepArgs;
    if (!Array.isArray(a.profile) || a.profile.length < 3) {
      return { ok: false, error: 'brep_sweep requires { profile: Point2D[] (≥3), path: Point3D[] (≥2) }', code: 'BAD_ARGS' };
    }
    if (!Array.isArray(a.path) || a.path.length < 2) {
      return { ok: false, error: 'brep_sweep requires path with ≥2 points', code: 'BAD_ARGS' };
    }
    return brepCallable('sweep', a, session, 'sweep');
  };

  const brep_loft: ToolExecutor = async (args, session) => {
    const a = args as unknown as BrepLoftArgs;
    if (!Array.isArray(a.sections) || a.sections.length < 2) {
      return { ok: false, error: 'brep_loft requires { sections: ≥2 cross-sections }', code: 'BAD_ARGS' };
    }
    return brepCallable('loft', a, session, 'loft');
  };

  const brep_draft: ToolExecutor = async (args, session) => {
    const a = args as unknown as BrepDraftArgs;
    if (!a.hostHandle || typeof a.angleDeg !== 'number') {
      return { ok: false, error: 'brep_draft requires { hostHandle, angleDeg, direction? }', code: 'BAD_ARGS' };
    }
    return brepCallable('draft', a, session, `draft(${a.angleDeg}°)`);
  };

  const brep_helix: ToolExecutor = async (args, session) => {
    const a = args as unknown as BrepHelixArgs;
    if (typeof a.pitch !== 'number' || typeof a.height !== 'number' || typeof a.radius !== 'number') {
      return { ok: false, error: 'brep_helix requires { pitch, height, radius, profileDiameter?, handedness? }', code: 'BAD_ARGS' };
    }
    return brepCallable('helix', a, session, 'helix');
  };

  // ─── H (Stage 4) — sketch + 2D constraint solver ───────────────────────

  const sketch_create: ToolExecutor = async (args, session) => {
    const a = args as unknown as SketchCreateArgs;
    if (typeof a.name !== 'string' || !a.name.trim()) {
      return { ok: false, error: 'sketch_create requires { name: string, entities: SketchEntity[] }', code: 'BAD_ARGS' };
    }
    if (!Array.isArray(a.entities)) {
      return { ok: false, error: 'sketch_create requires entities array', code: 'BAD_ARGS' };
    }
    session.sketches[a.name] = {
      name: a.name,
      entities: a.entities,
      constraints: [],
      solved: false,
    };
    return { ok: true, output: `OK. Sketch "${a.name}" created with ${a.entities.length} entit(ies). Add constraints, then sketch_solve.` };
  };

  const sketch_add_constraint: ToolExecutor = async (args, session) => {
    const a = args as unknown as SketchAddConstraintArgs;
    const sk = session.sketches[a.sketchName];
    if (!sk) return { ok: false, error: `sketch "${a.sketchName}" not found`, code: 'NOT_FOUND' };
    if (!a.constraint || !a.constraint.kind || !Array.isArray(a.constraint.entityIds)) {
      return { ok: false, error: 'constraint requires { id, kind, entityIds[], value? }', code: 'BAD_ARGS' };
    }
    sk.constraints.push(a.constraint);
    sk.solved = false;
    return { ok: true, output: `OK. Constraint ${a.constraint.kind} added (sketch now has ${sk.constraints.length} constraint(s)).` };
  };

  const sketch_solve: ToolExecutor = async (args, session) => {
    if (!host.solver) {
      return { ok: false, error: 'sketch_solve requires a constraint solver (Solvespace WASM not loaded).', code: 'NO_SOLVER' };
    }
    const a = args as unknown as SketchSolveArgs;
    const sk = session.sketches[a.sketchName];
    if (!sk) return { ok: false, error: `sketch "${a.sketchName}" not found`, code: 'NOT_FOUND' };
    try {
      const r = await host.solver.solve(sk);
      if (!r.ok) {
        return { ok: false, error: `solver: ${r.reason}`, code: 'SOLVE_FAILED' };
      }
      sk.entities = r.updatedEntities;
      sk.solved = true;
      await broadcastOp(session, { type: 'sketch_updated', sketchName: a.sketchName });
      return {
        ok: true,
        output: `OK. ${sk.constraints.length} constraints satisfied (residual ${r.residual.toExponential(2)}).`,
        meta: { residual: r.residual },
      };
    } catch (e) {
      return { ok: false, error: `solve threw: ${(e as Error).message}`, code: 'SOLVE_THREW' };
    }
  };

  const sketch_to_brep_extrude: ToolExecutor = async (args, session) => {
    const guard = brepGuard(session); if (guard) return guard;
    const a = args as unknown as SketchToBrepExtrudeArgs;
    const sk = session.sketches[a.sketchName];
    if (!sk) return { ok: false, error: `sketch "${a.sketchName}" not found`, code: 'NOT_FOUND' };
    if (!sk.solved) {
      return { ok: false, error: 'sketch must be solved first (call sketch_solve)', code: 'NOT_SOLVED' };
    }
    if (typeof a.height !== 'number' || a.height === 0) {
      return { ok: false, error: 'sketch_to_brep_extrude requires { sketchName, height: nonzero }', code: 'BAD_ARGS' };
    }
    // v1 — extrude only the first closed polygon of points/lines.
    // For now we approximate: just collect all entity points in order.
    const profile: import('./types').Point2D[] = sk.entities
      .flatMap(e => e.points);
    if (profile.length < 3) {
      return { ok: false, error: 'sketch needs ≥3 profile points to extrude', code: 'NOT_EXTRUDABLE' };
    }
    // Synthesize a sweep along Z by `height`.
    return brepCallable(
      'sweep',
      { profile, path: [[0, 0, 0], [0, 0, a.height]] } satisfies BrepSweepArgs,
      session,
      `extrude(${a.height}mm)`,
    );
  };

  // ─── I (Stage 4) — assembly mate connectors ────────────────────────────

  const add_mate: ToolExecutor = async (args, session) => {
    const a = args as unknown as AddMateArgs;
    if (!a.kind || !a.handleA || !a.handleB) {
      return { ok: false, error: 'add_mate requires { kind, handleA, handleB, faceTagA?|faceA?, faceTagB?|faceB?, value? }', code: 'BAD_ARGS' };
    }
    const id = `mate_${session.mates.length + 1}`;
    session.mates.push({
      id, kind: a.kind, handleA: a.handleA, handleB: a.handleB,
      faceA: a.faceA, faceB: a.faceB,
      faceTagA: a.faceTagA, faceTagB: a.faceTagB,
      value: a.value,
    });
    await broadcastOp(session, { type: 'mate_added', mateId: id });
    return { ok: true, output: `OK. Mate ${id} added (${a.kind} between ${a.handleA} and ${a.handleB}). Total: ${session.mates.length}.` };
  };

  // A3 — Stable face-tag listing for a B-rep handle.
  //
  // Resolves the handle's current face topology and returns role-based
  // tags so the agent can call add_mate with `faceTagA`/`faceTagB` instead
  // of brittle face indices that renumber across boolean ops. For host
  // adapters that don't expose face metadata, falls back to a fixed
  // primitive-role mapping based on `kind`.
  const list_face_tags: ToolExecutor = async (args, session) => {
    const a = args as { hostHandle?: unknown };
    const handle = typeof a.hostHandle === 'string' ? a.hostHandle : '';
    if (!handle) return { ok: false, error: 'list_face_tags requires { hostHandle }', code: 'BAD_ARGS' };
    const entry = session.brepEntries.find(e => e.handle === handle);
    if (!entry) return { ok: false, error: `unknown handle ${handle}`, code: 'NOT_FOUND' };

    // Static mapping by primitive kind. Booleans / fillets keep parent
    // tags conceptually but resolution to current face index requires
    // host-side topology info we don't have here yet.
    const kind = entry.kind.toLowerCase();
    let tags: string[] = [];
    if (kind.startsWith('cube') || kind.startsWith('box')) tags = ['x+', 'x-', 'y+', 'y-', 'z+', 'z-'];
    else if (kind.startsWith('cylinder')) tags = ['top', 'bottom', 'side'];
    else if (kind.startsWith('sphere')) tags = ['surf'];
    else if (kind.startsWith('helix') || kind.startsWith('helical')) tags = ['side'];
    else tags = []; // boolean/fillet/chamfer/sweep/loft — caller must use faceA/faceB

    if (tags.length === 0) {
      return {
        ok: true,
        output: `${handle} (${entry.kind}) has no canonical face tags. Use faceA/faceB indices from brep_to_mesh meta.`,
        meta: { handle, tags: [] },
      };
    }
    return {
      ok: true,
      output: `${handle} face tags: ${tags.join(', ')}. Use faceTagA/faceTagB in add_mate for boolean-stable refs.`,
      meta: { handle, tags },
    };
  };

  const list_mates: ToolExecutor = async (_args, session) => {
    if (session.mates.length === 0) return { ok: true, output: 'No mates yet.' };
    const lines = session.mates.map(m => `  ${m.id}: ${m.kind} ${m.handleA} ↔ ${m.handleB}${m.value !== undefined ? ` (${m.value})` : ''}`);
    return { ok: true, output: `${session.mates.length} mate(s):\n${lines.join('\n')}` };
  };

  const solve_mates: ToolExecutor = async (_args, session) => {
    if (!host.mateSolver) {
      return { ok: false, error: 'solve_mates requires a mate solver (Solvespace 3D not loaded).', code: 'NO_MATE_SOLVER' };
    }
    if (session.mates.length === 0) {
      return { ok: true, output: 'No mates to solve.' };
    }
    try {
      const r = await host.mateSolver.solve(session.mates);
      if (!r.ok) return { ok: false, error: `mate solver: ${r.reason}`, code: 'SOLVE_FAILED' };
      const moved = Object.keys(r.transforms).length;
      return {
        ok: true,
        output: `OK. ${session.mates.length} mates satisfied; ${moved} part(s) repositioned (residual ${r.residual.toExponential(2)}).`,
        meta: { transforms: r.transforms, residual: r.residual },
      };
    } catch (e) {
      return { ok: false, error: `solve_mates threw: ${(e as Error).message}`, code: 'SOLVE_THREW' };
    }
  };

  // ─── J (Stage 4) — drawing studio v1 ───────────────────────────────────

  const brep_to_drawing: ToolExecutor = async (args, session) => {
    const guard = brepGuard(session); if (guard) return guard;
    if (!host.drawingStudio) {
      return { ok: false, error: 'brep_to_drawing requires a drawing studio adapter (HLR not configured).', code: 'NO_DRAWING' };
    }
    const a = args as unknown as BrepToDrawingArgs;
    if (!a.hostHandle) return { ok: false, error: 'brep_to_drawing requires { hostHandle }', code: 'BAD_ARGS' };
    try {
      const r = await host.drawingStudio.generate(a);
      if (!r.ok) return { ok: false, error: `drawing studio: ${r.reason}`, code: 'DRAWING_FAILED' };
      return {
        ok: true,
        output: `OK. Drawing generated on ${r.sheetSize.w}×${r.sheetSize.h}mm: `
          + `${r.lineCount.visible} visible / ${r.lineCount.hidden} hidden / ${r.lineCount.center} center lines, `
          + `${r.dimensionCount} dimensions auto-placed.`,
        meta: { lineCount: r.lineCount, dimensionCount: r.dimensionCount, sheetSize: r.sheetSize },
      };
    } catch (e) {
      return { ok: false, error: `brep_to_drawing threw: ${(e as Error).message}`, code: 'DRAWING_THREW' };
    }
  };

  /** J* 후속 — exports a single view as SVG bytes. The agent uses this
   *  when the user wants a downloadable / displayable drawing artifact
   *  rather than just the metadata count brep_to_drawing returns. */
  const brep_export_drawing: ToolExecutor = async (args, session) => {
    const guard = brepGuard(session); if (guard) return guard;
    if (!host.drawingStudio?.exportSvg) {
      return { ok: false, error: 'brep_export_drawing requires drawing studio with exportSvg support.', code: 'NO_DRAWING_EXPORT' };
    }
    const a = args as unknown as BrepExportDrawingArgs;
    if (!a.hostHandle) return { ok: false, error: 'brep_export_drawing requires { hostHandle, view? }', code: 'BAD_ARGS' };
    try {
      const r = await host.drawingStudio.exportSvg(a);
      if (!r.ok) return { ok: false, error: `drawing export: ${r.reason}`, code: 'DRAWING_FAILED' };
      return {
        ok: true,
        output: `OK. SVG exported (${r.bytes} bytes, viewBox ${r.viewBox.w.toFixed(1)}×${r.viewBox.h.toFixed(1)}mm).`,
        meta: { svg: r.svg, bytes: r.bytes, viewBox: r.viewBox },
      };
    } catch (e) {
      return { ok: false, error: `brep_export_drawing threw: ${(e as Error).message}`, code: 'DRAWING_THREW' };
    }
  };

  // ─── U (Stage 4) — sheet metal unfold (multi-bend) ───────────────────

  const sheet_metal_unfold: ToolExecutor = async (args) => {
    const a = args as unknown as import('./types').SheetMetalUnfoldArgs;
    if (typeof a.partLengthMm !== 'number' || typeof a.widthMm !== 'number'
        || typeof a.thicknessMm !== 'number' || !Array.isArray(a.bends)) {
      return { ok: false, error: 'sheet_metal_unfold requires { partLengthMm, widthMm, thicknessMm, bends:[{positionMm, angleDeg, innerRadiusMm?}], kFactor? }', code: 'BAD_ARGS' };
    }
    const k = typeof a.kFactor === 'number' ? a.kFactor : 0.44;
    const t = a.thicknessMm;
    let totalDeduction = 0;
    const perBend: { positionMm: number; angleDeg: number; allowanceMm: number; deductionMm: number; flatPositionMm: number }[] = [];
    let flatCursor = 0;
    let lastFolded = 0;
    for (const b of a.bends) {
      const r = b.innerRadiusMm ?? t;
      const segment = b.positionMm - lastFolded;
      flatCursor += segment;
      const allowance = Math.PI * (r + k * t) * (b.angleDeg / 180);
      const deduction = 2 * (r + t) * Math.tan((b.angleDeg / 2) * Math.PI / 180) - allowance;
      perBend.push({
        positionMm: b.positionMm,
        angleDeg: b.angleDeg,
        allowanceMm: allowance,
        deductionMm: deduction,
        flatPositionMm: flatCursor,
      });
      flatCursor += allowance;
      totalDeduction += deduction;
      lastFolded = b.positionMm;
    }
    flatCursor += a.partLengthMm - lastFolded;
    return {
      ok: true,
      output: `Flat blank ${flatCursor.toFixed(1)} × ${a.widthMm}mm (k=${k}, ${a.bends.length} bends, total deduction ${totalDeduction.toFixed(2)}mm).`,
      meta: { flatLengthMm: flatCursor, widthMm: a.widthMm, totalDeductionMm: totalDeduction, perBend, kFactor: k },
    };
  };

  // ─── T (Stage 4) — FEA tools ──────────────────────────────────────────

  const fea_setup: ToolExecutor = async (args) => {
    if (!host.fea) {
      return { ok: false, error: 'fea_setup requires an FEA adapter (CalculiX not configured).', code: 'NO_FEA' };
    }
    const a = args as unknown as import('./types').FeaSetupArgs;
    if (!a.hostHandle || !a.material || !Array.isArray(a.constraints) || !Array.isArray(a.loads)) {
      return { ok: false, error: 'fea_setup requires { hostHandle, material, constraints[], loads[], meshSizeMm? }', code: 'BAD_ARGS' };
    }
    try {
      const r = await host.fea.setup(a);
      if (!r.ok) return { ok: false, error: `fea setup: ${r.reason}`, code: 'FEA_FAILED' };
      return {
        ok: true,
        output: `OK. FEA study ${r.studyId} prepared: ${r.nodeCount} nodes, ${r.elementCount} elements.`,
        meta: { studyId: r.studyId, nodeCount: r.nodeCount, elementCount: r.elementCount },
      };
    } catch (e) {
      return { ok: false, error: `fea_setup threw: ${(e as Error).message}`, code: 'FEA_THREW' };
    }
  };

  const fea_solve: ToolExecutor = async (args) => {
    if (!host.fea) return { ok: false, error: 'fea_solve requires an FEA adapter.', code: 'NO_FEA' };
    const a = args as unknown as import('./types').FeaSolveArgs;
    if (!a.studyId) return { ok: false, error: 'fea_solve requires { studyId, mode? }', code: 'BAD_ARGS' };
    try {
      const r = await host.fea.solve(a);
      if (!r.ok) return { ok: false, error: `fea solve: ${r.reason}`, code: 'FEA_FAILED' };
      return {
        ok: true,
        output: `${r.converged ? 'OK' : 'WARN'}: solver ${r.converged ? 'converged' : 'did NOT converge'} in ${r.iterations} iters (${r.elapsedMs}ms).`,
        meta: { converged: r.converged, iterations: r.iterations, elapsedMs: r.elapsedMs },
      };
    } catch (e) {
      return { ok: false, error: `fea_solve threw: ${(e as Error).message}`, code: 'FEA_THREW' };
    }
  };

  const fea_stress: ToolExecutor = async (args) => {
    if (!host.fea) return { ok: false, error: 'fea_stress requires an FEA adapter.', code: 'NO_FEA' };
    const a = args as unknown as import('./types').FeaStressArgs;
    if (!a.studyId) return { ok: false, error: 'fea_stress requires { studyId, measure? }', code: 'BAD_ARGS' };
    try {
      const r = await host.fea.stress(a);
      if (!r.ok) return { ok: false, error: `fea stress: ${r.reason}`, code: 'FEA_FAILED' };
      const measure = a.measure ?? 'von_mises';
      const safetyHint = r.safetyFactor < 1 ? '⚠ FAIL' : r.safetyFactor < 2 ? '⚠ marginal' : 'OK';
      return {
        ok: true,
        output: `${safetyHint}: max ${measure} = ${r.maxStressMPa.toFixed(1)} MPa at [${r.locationMm.map(v => v.toFixed(1)).join(', ')}], safety factor ${r.safetyFactor.toFixed(2)}.`,
        meta: r,
      };
    } catch (e) {
      return { ok: false, error: `fea_stress threw: ${(e as Error).message}`, code: 'FEA_THREW' };
    }
  };

  // ─── R (Stage 4) — multi-document refs ────────────────────────────────

  let docRefSeq = 0;
  const import_doc_ref: ToolExecutor = async (args, session) => {
    if (!host.docRefs) {
      return { ok: false, error: 'import_doc_ref requires a doc-ref adapter (no STEP/IGES importer wired).', code: 'NO_DOC_REF' };
    }
    const a = args as unknown as import('./types').ImportDocRefArgs;
    if (typeof a.source !== 'string' || a.source.length < 1) {
      return { ok: false, error: 'import_doc_ref requires { source: URL or path, format?, label? }', code: 'BAD_ARGS' };
    }
    try {
      const r = await host.docRefs.resolve(a);
      if (!r.ok) return { ok: false, error: `import failed: ${r.reason}`, code: 'IMPORT_FAILED' };
      const id = `doc_${++docRefSeq}`;
      const ref: import('./types').DocRef = {
        id,
        source: a.source,
        format: r.format,
        brepHandle: r.brepHandle,
        scadSource: r.scadSource,
        label: a.label,
        ts: Date.now(),
      };
      session.docRefs.push(ref);
      // If it produced a B-rep handle, also register it in brepEntries so
      // brep_* tools can use the handle without an extra step.
      if (r.brepHandle) {
        session.brepEntries.push(recordBrep(r.brepHandle, `imported(${r.format})`, a.label));
      }
      const summary = r.brepHandle
        ? `OK. ${id} imported as ${r.format} → handle ${r.brepHandle}.`
        : `OK. ${id} imported as ${r.format} SCAD source (${r.scadSource?.length ?? 0} bytes).`;
      return { ok: true, output: summary, meta: { id, format: r.format, brepHandle: r.brepHandle } };
    } catch (e) {
      return { ok: false, error: `import_doc_ref threw: ${(e as Error).message}`, code: 'IMPORT_THREW' };
    }
  };

  const list_doc_refs: ToolExecutor = async (_args, session) => {
    if (session.docRefs.length === 0) {
      return { ok: true, output: 'No external docs imported. Use import_doc_ref to bring in STEP/IGES/STL/SCAD.' };
    }
    const lines = session.docRefs.map(d => `  ${d.id}: ${d.format} from "${d.source}"${d.label ? ` (${d.label})` : ''}${d.brepHandle ? ` → ${d.brepHandle}` : ''}`);
    return { ok: true, output: `${session.docRefs.length} doc ref(s):\n${lines.join('\n')}` };
  };

  // ─── Q (Stage 4) — kinematics checks ──────────────────────────────────

  const check_gear_mesh: ToolExecutor = async (args) => {
    const a = args as unknown as { gearA?: { module?: number; teeth?: number }; gearB?: { module?: number; teeth?: number }; centerDistanceMm?: number; toleranceFrac?: number };
    if (!a.gearA?.module || !a.gearA?.teeth || !a.gearB?.module || !a.gearB?.teeth || typeof a.centerDistanceMm !== 'number') {
      return { ok: false, error: 'check_gear_mesh requires { gearA: {module, teeth}, gearB: {module, teeth}, centerDistanceMm, toleranceFrac? }', code: 'BAD_ARGS' };
    }
    const { checkGearMesh } = await import('./kinematics');
    const r = checkGearMesh({
      gearA: { module: a.gearA.module, teeth: a.gearA.teeth },
      gearB: { module: a.gearB.module, teeth: a.gearB.teeth },
      centerDistanceMm: a.centerDistanceMm,
      toleranceFrac: a.toleranceFrac,
    });
    return {
      ok: true,
      output: `${r.ok ? 'OK' : 'WARN'}: ${r.message}`,
      meta: { ok: r.ok, idealCenterDistanceMm: r.idealCenterDistanceMm, errorMm: r.errorMm, gearRatio: r.gearRatio },
    };
  };

  const check_interference: ToolExecutor = async (args) => {
    type Bbox = { min: [number, number, number]; max: [number, number, number] };
    const a = args as unknown as { bboxA?: Bbox; bboxB?: Bbox; positionA?: [number, number, number]; positionB?: [number, number, number] };
    if (!a.bboxA?.min || !a.bboxA?.max || !a.bboxB?.min || !a.bboxB?.max) {
      return { ok: false, error: 'check_interference requires { bboxA: {min,max}, bboxB: {min,max}, positionA?, positionB? }', code: 'BAD_ARGS' };
    }
    const { checkInterference } = await import('./kinematics');
    const r = checkInterference({
      bboxA: a.bboxA, bboxB: a.bboxB,
      positionA: a.positionA, positionB: a.positionB,
    });
    return {
      ok: true,
      output: r.message,
      meta: { collides: r.collides, overlap: r.overlap },
    };
  };

  // ─── P (Stage 4) — GD&T frames ────────────────────────────────────────

  let gdtSeq = 0;
  const add_gdt_frame: ToolExecutor = async (args, session) => {
    const a = args as unknown as AddGdtFrameArgs;
    if (!a.featureRef || !a.symbol || typeof a.tolerance !== 'number') {
      return { ok: false, error: 'add_gdt_frame requires { featureRef, symbol, tolerance, diameter?, modifier?, datums?, note? }', code: 'BAD_ARGS' };
    }
    if (a.tolerance <= 0 || a.tolerance > 50) {
      return { ok: false, error: `tolerance ${a.tolerance}mm out of practical range (0, 50]mm`, code: 'BAD_ARGS' };
    }
    const id = `gdt_${++gdtSeq}`;
    const frame: GdtFrame = {
      id, featureRef: a.featureRef, symbol: a.symbol, tolerance: a.tolerance,
      diameter: a.diameter, modifier: a.modifier, datums: a.datums, note: a.note,
    };
    session.gdtFrames.push(frame);
    const text = renderGdtFrameText(frame);
    return {
      ok: true,
      output: `OK. ${id} on "${a.featureRef}": ${text}`,
      meta: { id, frameText: text },
    };
  };

  const list_gdt_frames: ToolExecutor = async (_args, session) => {
    if (session.gdtFrames.length === 0) return { ok: true, output: 'No GD&T frames yet.' };
    const lines = session.gdtFrames.map(f => `  ${f.id} (on ${f.featureRef}): ${renderGdtFrameText(f)}`);
    return { ok: true, output: `${session.gdtFrames.length} frame(s):\n${lines.join('\n')}` };
  };

  // ─── N (Stage 4 wired) — sheet metal calculations ─────────────────────

  /** Compute the bend allowance (arc length of the neutral axis through
   *  the bend) — fundamental sheet-metal number. Used when the agent
   *  needs to size the flat blank for a bent part. */
  const sheet_metal_bend_allowance: ToolExecutor = async (args) => {
    const a = args as unknown as SheetMetalBendAllowanceArgs;
    if (typeof a.angleDeg !== 'number' || typeof a.innerRadiusMm !== 'number' || typeof a.thicknessMm !== 'number') {
      return { ok: false, error: 'sheet_metal_bend_allowance requires { angleDeg, innerRadiusMm, thicknessMm, kFactor? }', code: 'BAD_ARGS' };
    }
    const k = typeof a.kFactor === 'number' ? a.kFactor : 0.44;
    const ba = Math.PI * (a.innerRadiusMm + k * a.thicknessMm) * (a.angleDeg / 180);
    const bd = 2 * (a.innerRadiusMm + a.thicknessMm) * Math.tan((a.angleDeg / 2) * Math.PI / 180) - ba;
    return {
      ok: true,
      output: `Bend allowance ${ba.toFixed(3)}mm, bend deduction ${bd.toFixed(3)}mm (k=${k}, R=${a.innerRadiusMm}, t=${a.thicknessMm}, ${a.angleDeg}°).`,
      meta: { bendAllowanceMm: ba, bendDeductionMm: bd, kFactor: k },
    };
  };

  /** Estimate the flat-blank dimensions for a 5-sided sheet metal box
   *  (open-top enclosure with 4 vertical walls). Sums box footprint +
   *  unfolded wall heights, accounting for bend allowance. */
  const sheet_metal_box_flat: ToolExecutor = async (args) => {
    const a = args as unknown as SheetMetalBoxFlatArgs;
    const required = ['width', 'depth', 'height', 'thicknessMm'] as const;
    for (const k of required) {
      if (typeof (a as unknown as Record<string, unknown>)[k] !== 'number') {
        return { ok: false, error: `sheet_metal_box_flat requires { width, depth, height, thicknessMm, innerRadiusMm?, kFactor? }`, code: 'BAD_ARGS' };
      }
    }
    const t = a.thicknessMm;
    const r = typeof a.innerRadiusMm === 'number' ? a.innerRadiusMm : t;
    const k = typeof a.kFactor === 'number' ? a.kFactor : 0.44;
    // 90° bend allowance per wall.
    const bendAllowance = Math.PI * (r + k * t) * 0.5;
    // Flat blank: footprint expanded by 2× (wall height − bend deduction)
    // along both axes, where bend deduction = 2(r+t)·tan45 − BA.
    const bendDeduction = 2 * (r + t) - bendAllowance;
    const flatLength = a.width + 2 * (a.height - bendDeduction);
    const flatWidth = a.depth + 2 * (a.height - bendDeduction);
    return {
      ok: true,
      output: `Flat blank ${flatLength.toFixed(1)} × ${flatWidth.toFixed(1)}mm (BA=${bendAllowance.toFixed(2)}mm × 4 bends).`,
      meta: { flatLength, flatWidth, bendAllowance, bendDeduction, kFactor: k },
    };
  };

  // ─── K (Stage 4) — collab presence + lock ──────────────────────────────

  const collab_presence: ToolExecutor = async (_args, session) => {
    const collab = host.collab ?? (await import('./collab')).SOLO_COLLAB_ADAPTER;
    if (!collab.isCollaborative(session)) {
      return { ok: true, output: 'Solo session — no collaborators. Edit freely.' };
    }
    try {
      const peers = await collab.presence(session);
      const lines = peers.map(p => `  ${p.self ? '*' : ' '} ${p.id} (${p.label})`);
      return { ok: true, output: `${peers.length} participant(s) (* = you):\n${lines.join('\n')}` };
    } catch (e) {
      return { ok: false, error: `presence query failed: ${(e as Error).message}`, code: 'COLLAB_THREW' };
    }
  };

  const collab_lock: ToolExecutor = async (args, session) => {
    const a = args as { resource?: unknown; ttlMs?: unknown };
    const resource = typeof a.resource === 'string' ? a.resource : '';
    const ttlMs = typeof a.ttlMs === 'number' ? a.ttlMs : 60_000;
    if (!resource) return { ok: false, error: 'collab_lock requires { resource: string, ttlMs? }', code: 'BAD_ARGS' };
    const collab = host.collab ?? (await import('./collab')).SOLO_COLLAB_ADAPTER;
    try {
      const r = await collab.acquireLock(session, resource, ttlMs);
      if (!r.acquired) {
        return {
          ok: false,
          error: `lock for "${resource}" held by ${r.holder ?? 'another participant'}. Retry or coordinate.`,
          code: 'LOCK_HELD',
        };
      }
      return { ok: true, output: `OK. Lock acquired on ${resource} for ${ttlMs}ms.` };
    } catch (e) {
      return { ok: false, error: `lock acquire failed: ${(e as Error).message}`, code: 'COLLAB_THREW' };
    }
  };

  return {
    ask_user,
    set_user_pref,
    get_user_prefs,
    forget_user_pref,
    tree_summary,
    tree_set_param,
    tree_remove_node,
    lookup_imperial_fastener,
    select_bearing,
    select_key,
    select_retaining_ring,
    select_drill,
    lookup_socket_head_cap,
    lookup_countersunk_screw,
    lookup_dowel_pin,
    select_tapered_bearing,
    add_datum_target,
    add_surface_finish,
    add_annotated_dimension,
    export_pmi_step_ap242,
    query_engineering_catalog,
    sim_cfd,
    sim_mbd,
    sim_cam,
    sim_mold_fill,
    sim_optics,
    sim_thermal,
    topology_optimize,
    auto_mesh,
    find_design_patterns,
    write_scad,
    apply_diff,
    render,
    get_geometry,
    add_feature_intent,
    search_bosl2: search_bosl2_tool,
    read_dfm,
    plan_design,
    write_module,
    list_modules,
    compose_assembly,
    view_render,
    list_checkpoints,
    revert_to_checkpoint,
    brep_primitive,
    brep_boolean,
    brep_fillet,
    brep_chamfer,
    brep_shell,
    brep_to_mesh,
    brep_export_step,
    list_breps,
    // Stage 4 G
    brep_sweep,
    brep_loft,
    brep_draft,
    brep_helix,
    // Stage 4 H
    sketch_create,
    sketch_add_constraint,
    sketch_solve,
    sketch_to_brep_extrude,
    // Stage 4 I
    add_mate,
    list_mates,
    list_face_tags,
    solve_mates,
    // Stage 4 J
    brep_to_drawing,
    brep_export_drawing,
    // Stage 4 K
    collab_presence,
    collab_lock,
    // Stage 4 N — sheet metal calculations
    sheet_metal_bend_allowance,
    sheet_metal_box_flat,
    // Stage 4 P — GD&T
    add_gdt_frame,
    list_gdt_frames,
    // Stage 4 Q — kinematics
    check_gear_mesh,
    check_interference,
    // Stage 4 R — multi-doc refs
    import_doc_ref,
    list_doc_refs,
    // Stage 4 T — FEA
    fea_setup,
    fea_solve,
    fea_stress,
    // Stage 4 U — sheet metal multi-bend unfold
    sheet_metal_unfold,
  };
}

// ─── P (Stage 4) — GD&T render helpers ─────────────────────────────────

/** Render a GD&T frame to its standard ASME Y14.5 short-form text.
 *  Example: { position, ⌀0.05, M, [A, B, C] } → "⌖ ⌀0.05 M | A | B | C". */
export function renderGdtFrameText(f: GdtFrame): string {
  const symbolMap: Record<string, string> = {
    position: '⌖', flatness: '⏥', perpendicularity: '⊥',
    parallelism: '∥', circularity: '○', cylindricity: '⌭',
    surface_profile: '⌓', concentricity: '◎', symmetry: '⌯',
    angularity: '∠',
  };
  const sym = symbolMap[f.symbol] ?? f.symbol;
  const dia = f.diameter ? '⌀' : '';
  const mod = f.modifier ? ` ${f.modifier}` : '';
  const datums = f.datums?.length
    ? ' | ' + f.datums.map(d => `${d.letter}${d.modifier ? ` ${d.modifier}` : ''}`).join(' | ')
    : '';
  return `${sym} ${dia}${f.tolerance}${mod}${datums}`;
}

const MAX_CHECKPOINTS = 8;

function deriveCheckpointLabel(session: AgentSession): string {
  const moduleNames = Object.keys(session.modules);
  if (moduleNames.length > 0) {
    return moduleNames.length === 1
      ? `module:${moduleNames[0]}`
      : `${moduleNames.length} modules`;
  }
  // Single-file path: pick the first SCAD identifier on a line.
  const m = session.scadSource.match(/(?:module|cube|cylinder|sphere|cone|cuboid|cyl|threaded_rod|spur_gear|screw)\s*\(/);
  return m ? m[0].replace(/\s*\($/, '') : `step ${session.checkpoints.length + 1}`;
}

function captureCheckpoint(session: AgentSession, label: string): void {
  const next = (session.checkpoints[session.checkpoints.length - 1]?.index ?? 0) + 1;
  session.checkpoints.push({
    index: next,
    ts: Date.now(),
    label,
    scadSource: session.scadSource,
    modules: { ...session.modules },
    composition: session.composition,
    designPlan: session.designPlan,
  });
  if (session.checkpoints.length > MAX_CHECKPOINTS) {
    session.checkpoints.splice(0, session.checkpoints.length - MAX_CHECKPOINTS);
  }
}

/**
 * Translate a friendly view label set ("iso", "front", ...) to the
 * underlying CameraView records. Returns undefined to fall through to
 * `DEFAULT_VIEWS` when the agent didn't specify any.
 */
function mapCameraViews(labels?: ('iso' | 'front' | 'right' | 'left' | 'top' | 'back')[]):
  import('../../openscad-render/renderPng').CameraView[] | undefined {
  if (!labels || labels.length === 0) return undefined;
  const lookup: Record<string, { label: string; camera: string }> = {
    iso:   { label: 'Isometric',  camera: '0,0,0,55,0,25,140' },
    front: { label: 'Front',      camera: '0,0,0,90,0,0,140' },
    right: { label: 'Right side', camera: '0,0,0,90,0,90,140' },
    left:  { label: 'Left side',  camera: '0,0,0,90,0,-90,140' },
    top:   { label: 'Top',        camera: '0,0,0,0,0,0,140' },
    back:  { label: 'Back',       camera: '0,0,0,90,0,180,140' },
  };
  // Cap at 4 views — vision payloads grow fast and cost balloons past that.
  const out: { label: string; camera: string }[] = [];
  const seen = new Set<string>();
  for (const k of labels) {
    if (seen.has(k) || !lookup[k]) continue;
    seen.add(k);
    out.push(lookup[k]);
    if (out.length >= 4) break;
  }
  return out.length > 0 ? out : undefined;
}

function emitPlacement(p: AssemblyPlacement): string {
  const lines: string[] = [];
  const count = Math.max(1, Math.min(50, Math.round(p.count ?? 1)));
  const spacing = p.spacing ?? [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const pos: [number, number, number] = [
      (p.position?.[0] ?? 0) + spacing[0] * i,
      (p.position?.[1] ?? 0) + spacing[1] * i,
      (p.position?.[2] ?? 0) + spacing[2] * i,
    ];
    let stmt = `${p.moduleName}();`;
    if (p.rotation && p.rotation.some(v => v !== 0)) {
      stmt = `rotate([${p.rotation.join(', ')}]) ${stmt}`;
    }
    if (pos.some(v => v !== 0)) {
      stmt = `translate([${pos.join(', ')}]) ${stmt}`;
    }
    lines.push(stmt);
  }
  return lines.join('\n');
}

// ─── Server defaults (production wiring is in /api/nexyfab/scad-agent) ─────

/**
 * No-op host adapters used when the agent is run without a real backend
 * (e.g. unit tests that don't exercise rendering).
 */
export const STUB_HOST: ToolHostAdapters = {
  render: async () => ({ ok: false, errors: [{ message: 'render stubbed' }] }),
  geometry: async () => ({}),
  dfm: async () => ({ summary: 'dfm stubbed', issuesCount: 0 }),
  // vision: undefined → view_render returns NO_VISION error in stubbed env.
};
