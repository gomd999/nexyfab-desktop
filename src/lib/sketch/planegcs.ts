/**
 * planegcs WASM init wrapper.
 *
 * Wraps `@salusoft89/planegcs` (LGPL-2.1+, WASM port of FreeCAD's planegcs).
 * Lazy-loads the WASM module; first call is ~200-500ms, subsequent calls reuse the instance.
 *
 * LGPL compliance: see NOTICE at repo root. The WASM is dynamically loaded
 * via npm package import, satisfying the dynamic-linking exemption.
 *
 * Why dynamic import (not top-level `import`)?
 *   planegcs's Emscripten output contains `require('fs')`, `require('path')`,
 *   `require('url')` calls for Node-side init. Webpack's static analyzer
 *   walks those even though they never execute in the browser, and fails to
 *   resolve them despite the next.config.ts fallbacks (the `./` literal
 *   inside `da="./this.program"` confuses the resolver). Dynamic import
 *   puts planegcs in its own async chunk, which webpack tolerates: the
 *   bundle compiles and the chunk loads lazily at runtime, in the
 *   browser, where it works correctly via fetch + WASM streaming.
 */

import type { GcsWrapper as GcsWrapperType } from '@salusoft89/planegcs';

type PlanegcsModule = typeof import('@salusoft89/planegcs');
type GcsModule = Awaited<ReturnType<PlanegcsModule['init_planegcs_module']>>;

let planegcsModulePromise: Promise<PlanegcsModule> | null = null;
let wasmInitPromise: Promise<GcsModule> | null = null;

async function loadPlanegcsPackage(): Promise<PlanegcsModule> {
  if (!planegcsModulePromise) {
    planegcsModulePromise = import('@salusoft89/planegcs');
  }
  return planegcsModulePromise;
}

export async function loadPlanegcsModule(): Promise<GcsModule> {
  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      const pkg = await loadPlanegcsPackage();
      return pkg.init_planegcs_module();
    })();
  }
  return wasmInitPromise;
}

export async function createGcsWrapper(): Promise<GcsWrapperType> {
  const pkg = await loadPlanegcsPackage();
  const mod = await loadPlanegcsModule();
  const gcs = new mod.GcsSystem();
  return new pkg.GcsWrapper(gcs);
}

export type { GcsWrapperType as GcsWrapper, GcsModule };
