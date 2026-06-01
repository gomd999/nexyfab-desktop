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
    planegcsModulePromise = import(
      /* webpackChunkName: "planegcs" */ '@salusoft89/planegcs'
    );
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
