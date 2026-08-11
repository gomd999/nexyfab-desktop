/**
 * nodeOcctLoader — load the REAL opencascade.js Emscripten module headless in
 * Node (no Worker), for the server-side OCCT engine + CI harness (K1b-real of
 * ADR-014). Browser code must keep using the worker bridge.
 *
 * opencascade.js@1.1.1's dist glue is an ESM module that nonetheless references
 * the CJS globals `__dirname` / `require`, and its default loader tries to
 * `fetch` the wasm. Three fixes make it run under Node:
 *   1. shim `globalThis.__dirname` (dist dir) + `globalThis.require`,
 *   2. pass the wasm bytes via `wasmBinary` (bypasses locateFile/fetch),
 *   3. runtime `import()` (not static) so bundlers don't choke on the 330 KB
 *      glue (same trick as planegcs — see feedback_webpack_emscripten_wasm).
 *
 * Proven: loads + builds real B-rep in ~700 ms (probe, 2026-06-04).
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Minimal surface we touch; the real embind module has thousands of symbols. */
export type OcctModule = Record<string, unknown>;

export interface NodeOcctLoadResult {
  ok: boolean;
  oc?: OcctModule;
  reason?: string;
  loadMs?: number;
}

let cached: OcctModule | null = null;

/**
 * Load (and cache) the real OCCT module in Node. Returns `{ ok:false }` with a
 * reason when not in Node or the package/wasm is unavailable — callers fall
 * back to the worker bridge or the stub.
 */
export async function loadOcctNode(opts: { distDir?: string } = {}): Promise<NodeOcctLoadResult> {
  if (cached) return { ok: true, oc: cached, loadMs: 0 };
  const isNode = typeof process === 'object' && !!process.versions?.node;
  if (!isNode) return { ok: false, reason: 'not a Node runtime (use the worker bridge in the browser)' };

  const t0 = Date.now();
  try {
    // `import.meta.url` is rewritten when this module is bundled into a Next
    // standalone chunk. Anchor createRequire to the deployed application root
    // so bare package resolution is identical in source, tests, and Docker.
    const req = createRequire(path.join(process.cwd(), 'package.json'));
    // Resolve the dist dir from the installed package (or an override).
    const distDir =
      opts.distDir ??
      path.dirname(req.resolve('opencascade.js/dist/opencascade.wasm.js'));

    // Shim the CJS globals the ESM glue references at instantiation time.
    const g = globalThis as unknown as { __dirname?: string; require?: unknown };
    if (g.__dirname === undefined) g.__dirname = distDir;
    if (g.require === undefined) g.require = req;

    // Dynamic import (server-only module — never bundled for the browser, which
    // uses the worker bridge). A plain import() works under both Node and the
    // vitest runner; the Function('import') trick is blocked in vitest's vm.
    // `webpackIgnore` keeps webpack from treating the variable specifier as a
    // fully-dynamic context module ("Critical dependency: the request of a
    // dependency is an expression" in every route chunk importing this file).
    // At runtime nothing changes: Node resolves the bare specifier from
    // node_modules, and when the package is absent this returns { ok:false }
    // exactly as before (webpack could never bundle a variable request either).
    const specifier = 'opencascade.js/dist/opencascade.wasm.js';
    const mod = (await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier)) as { default?: (cfg: unknown) => Promise<OcctModule> };
    const glue = mod.default;
    if (typeof glue !== 'function') return { ok: false, reason: 'opencascade.js dist glue has no default factory' };

    const wasmBinary = fs.readFileSync(path.join(distDir, 'opencascade.wasm.wasm'));
    const oc = await glue({ wasmBinary, locateFile: (p: string) => p });
    cached = oc;
    return { ok: true, oc, loadMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Test seam: drop the cached module so a test can force a fresh load. */
export function __resetOcctNodeCache(): void {
  cached = null;
}
