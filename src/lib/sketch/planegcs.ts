/**
 * planegcs WASM init wrapper.
 *
 * Wraps `@salusoft89/planegcs` (LGPL-2.1+, WASM port of FreeCAD's planegcs).
 * Lazy-loads the WASM module; first call is ~200-500ms, subsequent calls reuse the instance.
 *
 * LGPL compliance: see NOTICE at repo root. The WASM is dynamically loaded
 * via npm package import, satisfying the dynamic-linking exemption.
 */

import { init_planegcs_module, GcsWrapper } from '@salusoft89/planegcs';

type GcsModule = Awaited<ReturnType<typeof init_planegcs_module>>;

let modulePromise: Promise<GcsModule> | null = null;

export async function loadPlanegcsModule(): Promise<GcsModule> {
  if (!modulePromise) {
    modulePromise = init_planegcs_module();
  }
  return modulePromise;
}

export async function createGcsWrapper(): Promise<GcsWrapper> {
  const mod = await loadPlanegcsModule();
  const gcs = new mod.GcsSystem();
  return new GcsWrapper(gcs);
}

export { GcsWrapper };
export type { GcsModule };
