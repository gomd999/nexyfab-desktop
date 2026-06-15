/**
 * planegcs WASM init wrapper.
 *
 * Wraps `@salusoft89/planegcs` (LGPL-2.1+, WASM port of FreeCAD's planegcs).
 * Lazy-loads the WASM module; first call is ~200-500ms, subsequent calls reuse the instance.
 *
 * LGPL compliance: see NOTICE at repo root. The WASM is dynamically loaded
 * via npm package import, satisfying the dynamic-linking exemption.
 *
 * Why webpack-magic-comment dynamic import (not even `import type`)?
 *   planegcs's Emscripten output contains require('fs')/require('path')/
 *   require('url') calls for Node init. Webpack's static module graph
 *   builder follows EVERY import — even TS `import type` lines and
 *   `typeof import('...')` type positions get traced for build-graph
 *   purposes (Next.js + webpack 5 behavior). The Emscripten file then
 *   trips webpack on a literal './' inside its bootstrap.
 *
 *   The fix: import via webpackChunkName + webpackIgnore=false dynamic
 *   import expression that webpack treats as fully async (separate chunk)
 *   AND avoid any compile-time type reference to the package elsewhere
 *   in this module — use `any` / `unknown` returns and let callers use
 *   structural types. Type safety is enforced by the higher-level
 *   `SketchSolver` facade (solver.ts).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

let planegcsModulePromise: Promise<any> | null = null;
let wasmInitPromise: Promise<any> | null = null;

/**
 * Dynamically imports the planegcs npm package. Webpack treats this as
 * an async chunk because the specifier is a string literal and the
 * surrounding code has no static reference to the module name. Callers
 * get an opaque `any` — the SketchSolver facade narrows it.
 */
async function loadPlanegcsPackage(): Promise<any> {
  if (!planegcsModulePromise) {
    // Two paths because vitest's vm context lacks a dynamic-import
    // callback (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING), so the
    // eval-based bypass that works in webpack-built browser code
    // doesn't work in tests:
    //
    //   1) test env (process.env.VITEST) — use a regular dynamic import
    //      annotated with `/* webpackIgnore: true */`. The magic comment
    //      tells webpack to leave the import alone (no static analysis,
    //      no chunk emission). Vitest doesn't see the comment and uses
    //      standard Node ESM resolution.
    //
    //   2) production browser build — `(0, eval)` indirect eval hides
    //      the import() inside an opaque string. Webpack literally
    //      cannot find it. At runtime the page-level module loader
    //      resolves @salusoft89/planegcs normally.
    //
    // This is the bypass after 5 failed Railway deploys with conventional
    // approaches (url:false fallback, inline enums, full TS erasure,
    // webpackChunkName dynamic import, module.noParse).
    if (typeof process !== 'undefined' && process.env && process.env.VITEST) {
      planegcsModulePromise = import(/* webpackIgnore: true */ '@salusoft89/planegcs');
    } else {
      const runtimeImport = (0, eval)('(s) => import(s)') as (s: string) => Promise<any>;
      planegcsModulePromise = runtimeImport('@salusoft89/planegcs');
    }
  }
  return planegcsModulePromise;
}

export async function loadPlanegcsModule(): Promise<any> {
  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      const pkg = await loadPlanegcsPackage();
      return pkg.init_planegcs_module();
    })();
  }
  return wasmInitPromise;
}

/**
 * Returns a `GcsWrapper` instance (structurally — see
 * `@salusoft89/planegcs`'s exported type for the shape). Untyped here
 * to avoid pulling planegcs into the static module graph.
 */
export async function createGcsWrapper(): Promise<any> {
  const pkg = await loadPlanegcsPackage();
  const mod = await loadPlanegcsModule();
  const gcs = new mod.GcsSystem();
  return new pkg.GcsWrapper(gcs);
}

/** Opaque type alias — the actual shape is from `@salusoft89/planegcs`'s
 *  `GcsWrapper`, but we don't reference it statically to keep webpack
 *  from tracing into the package. */
export type GcsWrapper = any;
export type GcsModule = any;
