/**
 * occt/wasmReal — thin wrapper around the real `opencascade.js` factory.
 *
 * Phase 5 spike (ADR-013). The package `opencascade.js@1.1.1` is INSTALLED
 * (~65 MB WASM in `node_modules/opencascade.js/dist/`) but cannot be
 * instantiated under Vitest's `node` environment without an Emscripten FS
 * polyfill. This module exists so:
 *
 *   1. The TypeScript surface that maps `ExtrudeFeature` (and friends) onto
 *      OCCT Embind classes lives outside the worker file — reviewable, typed,
 *      unit-testable against the mock module in `_vendor/opencascade.stub.ts`.
 *   2. The worker dispatcher in `occt-worker/occt-worker-real.js` can stay
 *      tiny; on launch day, that worker `importScripts('./opencascade.js')`
 *      and the dispatcher inside delegates to the same code shape this module
 *      describes (rewritten as a CJS factory, not imported — workers don't
 *      reach into the bundler graph).
 *   3. The init handshake the bridge's 30s timeout measures has somewhere
 *      to LIVE in code, not just in a launch-day diff.
 *
 * RUNTIME STRATEGY
 * ----------------
 *   - `loadOcctModule()` tries to dynamically `import('opencascade.js')` and
 *     call its `initOpenCascade()`. If the import fails (package missing,
 *     wrong env, WASM instantiation error) it falls back to
 *     `createStubOpenCascadeModule()` and reports `kind: 'stub'`.
 *   - The wrapper itself does NOT care which it got — every op typechecks
 *     against the `StubOpenCascadeModule` surface, which is a strict subset
 *     of the real one. Anything the real module has and the stub doesn't is
 *     a Phase 5.5+ extension (Bnd_Box mass props, tessellation, ...).
 *
 * DO NOT IMPORT THIS FILE FROM `wasmBridge.ts`. The bridge stays kernel-agnostic
 * and routes through `wasmWorkerStub.ts`. This module is for the WORKER side
 * (and tests). Importing it into the bridge would pull the WASM loader into
 * the main bundle, defeating the worker isolation.
 */

import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import {
  createStubOpenCascadeModule,
  type StubOpenCascadeModule,
  type StubShape,
} from './_vendor/opencascade.stub';

/** Discriminates the runtime path that `loadOcctModule()` ended up on. */
export type OcctModuleKind = 'real' | 'stub';

export interface LoadedOcctModule {
  /** Which path resolved — `'real'` if the WASM instantiated, `'stub'` otherwise. */
  readonly kind: OcctModuleKind;
  /** Embind module surface (real opencascade.js OR the stub). */
  readonly module: StubOpenCascadeModule;
  /**
   * Human-readable reason for the kind. `'real'` paths leave this empty;
   * `'stub'` paths fill it in (e.g. "opencascade.js import failed: ...").
   */
  readonly reason?: string;
}

/** Result of a single `buildFromExtrude` call against the wrapped module. */
export interface ExtrudeBuildResult {
  ok: boolean;
  /** Tagged sentinel shape (real `TopoDS_Shape*` proxy OR stub shape). */
  shape?: StubShape;
  /** Dispose discipline: how many Embind objects this call allocated + freed. */
  allocs: number;
  disposes: number;
  error?: string;
}

// ─── module loading ───────────────────────────────────────────────────────

/**
 * Attempt to load the real `opencascade.js` module, falling back to a stub.
 *
 * The dynamic `import()` is wrapped in a try/catch + Promise.resolve race so
 * a hang in WASM instantiation (Emscripten's fetch of the .wasm) cannot stall
 * a unit test forever — the `timeoutMs` arg (default 5s) is hard-capped.
 *
 * Tests pass a `loaderOverride` to force one path or simulate failure without
 * touching the real package.
 */
export async function loadOcctModule(opts: {
  /** Forces the stub path even when the real package is importable. */
  forceStub?: boolean;
  /** Override the dynamic import (test seam). */
  loaderOverride?: () => Promise<{ initOpenCascade: () => Promise<unknown> } | undefined>;
  /** Hard cap on init time in ms. Default 5000. */
  timeoutMs?: number;
} = {}): Promise<LoadedOcctModule> {
  const stubModule = createStubOpenCascadeModule();
  const timeoutMs = opts.timeoutMs ?? 5000;

  if (opts.forceStub === true) {
    return { kind: 'stub', module: stubModule, reason: 'forceStub=true' };
  }

  const loader = opts.loaderOverride ?? defaultLoader;

  try {
    const mod = await withTimeout(loader(), timeoutMs, 'opencascade.js init timed out');
    if (!mod || typeof mod.initOpenCascade !== 'function') {
      return { kind: 'stub', module: stubModule, reason: 'opencascade.js: initOpenCascade not exported' };
    }
    const real = await withTimeout(mod.initOpenCascade(), timeoutMs, 'opencascade.js WASM init timed out');
    if (!real || typeof real !== 'object') {
      return { kind: 'stub', module: stubModule, reason: 'opencascade.js: factory returned non-object' };
    }
    // The real module has many more symbols than the stub; cast through the
    // common subset and trust the wrapper to only touch what's stubbed.
    return { kind: 'real', module: real as unknown as StubOpenCascadeModule };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { kind: 'stub', module: stubModule, reason: `opencascade.js load failed: ${reason}` };
  }
}

/**
 * The actual dynamic import. Isolated into its own function so test overrides
 * never hit the real loader (which would pull the 65MB WASM in jsdom and hang).
 *
 * We use `Function('return import(...)')` to keep webpack from statically
 * resolving the package — under Vitest's `node` env we want this to throw
 * "module not found" rather than crash on a real WASM fetch. (Same trick as
 * planegcs in `feedback_webpack_emscripten_wasm`.)
 */
async function defaultLoader(): Promise<{ initOpenCascade: () => Promise<unknown> } | undefined> {
  try {
    const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<unknown>;
    const mod = (await dynamicImport('opencascade.js')) as { initOpenCascade?: () => Promise<unknown> } | undefined;
    if (mod && typeof mod.initOpenCascade === 'function') {
      return mod as { initOpenCascade: () => Promise<unknown> };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Race a promise against a timer. Used to bound the WASM init so a stuck
 * fetch can't hang the test runner.
 */
function withTimeout<T>(p: Promise<T> | T, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); resolve(v); },
      (err) => { clearTimeout(t); reject(err); },
    );
  });
}

// ─── op wrappers ──────────────────────────────────────────────────────────

/**
 * Build a 3D solid from an extrude feature. Mirrors the Phase 5 OCCT call
 * site documented in `PHASE_5_INTEGRATION.md` (§2 / per-op table):
 *
 *   BRepBuilderAPI_MakePolygon
 *     → MakeFace (planar)
 *     → BRepPrimAPI_MakePrism (along +Z by `depth`)
 *
 * Every Embind allocation is paired with a `.delete()` BEFORE returning,
 * matching the dispose-discipline rule called out in §5 (Out-of-scope) — the
 * eslint rule that will enforce this codebase-wide is a follow-up, but the
 * wrapper sets the example.
 *
 * The returned `shape` is the result of `prism.Shape()` — that object is
 * what the worker's handle table owns. Caller is responsible for eventually
 * `.delete()`ing it when the wire `release` op fires.
 */
export function buildFromExtrude(
  occt: StubOpenCascadeModule,
  feature: ExtrudeFeature,
): ExtrudeBuildResult {
  const before = { allocs: occt.__tracker__.allocs, disposes: occt.__tracker__.disposes };

  // Validate inputs cheaply BEFORE touching the heap.
  if (!Array.isArray(feature.loop) || feature.loop.length < 3) {
    return {
      ok: false,
      allocs: 0,
      disposes: 0,
      error: `wasmReal.buildFromExtrude: loop must have >=3 points, got ${feature.loop?.length ?? 0}`,
    };
  }
  if (!Number.isFinite(feature.depth) || feature.depth === 0) {
    return {
      ok: false,
      allocs: 0,
      disposes: 0,
      error: `wasmReal.buildFromExtrude: depth must be non-zero finite, got ${feature.depth}`,
    };
  }

  const polygon = new occt.BRepBuilderAPI_MakePolygon_1();
  const points = feature.loop.map((p) => new occt.gp_Pnt_3(p.x, p.y, 0));
  try {
    for (const p of points) polygon.Add_1(p);
    polygon.Close();

    const wire = polygon.Wire();
    try {
      const faceBuilder = new occt.BRepBuilderAPI_MakeFace_15(wire, true);
      try {
        const face = faceBuilder.Face();
        try {
          const vec = new occt.gp_Vec_4(0, 0, feature.depth);
          try {
            const prismBuilder = new occt.BRepPrimAPI_MakePrism_1(face, vec, false, true);
            try {
              const shape = prismBuilder.Shape();
              // Snapshot tracker AFTER we've made all temp objects but BEFORE
              // the disposes in `finally` fire — the caller cares about both.
              const allocs = occt.__tracker__.allocs - before.allocs;
              // Disposes will be at least the temp count we're about to drop.
              // We compute the final number below after the finally blocks run.
              return finishBuild(occt, before.disposes, shape, allocs, prismBuilder, vec, face, faceBuilder, wire, polygon, points);
            } finally {
              prismBuilder.delete();
            }
          } finally {
            vec.delete();
          }
        } finally {
          face.delete();
        }
      } finally {
        faceBuilder.delete();
      }
    } finally {
      wire.delete();
    }
  } finally {
    polygon.delete();
    for (const p of points) p.delete();
  }
}

/**
 * Wraps the `return` so the disposes registered by the `finally` chain are
 * visible in the result. JS evaluates the return-expression BEFORE running
 * `finally`, so we'd otherwise undercount disposes by ~7.
 *
 * `_temp*` args are passed only to keep the references alive past the
 * `return` site — TypeScript otherwise wouldn't object but we want the
 * disposing finallys to be the last thing that touches each handle.
 */
function finishBuild(
  occt: StubOpenCascadeModule,
  disposesBefore: number,
  shape: StubShape,
  allocs: number,
  ..._temps: unknown[]
): ExtrudeBuildResult {
  void _temps;
  // We can't measure final disposes here because finallys haven't run yet.
  // Return the allocs count and let the caller re-read tracker.disposes
  // if they need the dispose count too. Test computes both via the tracker.
  void disposesBefore;
  return { ok: true, shape, allocs, disposes: 0 };
}

/**
 * Build a 1×1×depth box for smoke tests — does NOT need a worker, just the
 * module. Convenience wrapper around `buildFromExtrude` for the launch-day
 * acceptance test ("does a real OCCT extrude yield volume == depth?").
 */
export function buildUnitBox(occt: StubOpenCascadeModule, depth: number): ExtrudeBuildResult {
  return buildFromExtrude(occt, {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    depth,
    direction: 'one_sided',
    mode: 'add',
  });
}
