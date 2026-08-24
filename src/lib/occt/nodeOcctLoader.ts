/**
 * nodeOcctLoader — load the REAL opencascade.js Emscripten module headless in
 * Node (no Worker), for the server-side OCCT engine + CI harness (K1b-real of
 * ADR-014). Browser code must keep using the worker bridge.
 *
 * opencascade.js@1.1.1's dist glue is an ESM module that nonetheless references
 * the CJS globals `__dirname` / `require`, and its default loader tries to
 * `fetch` the wasm. Three fixes make it run under Node:
 *   1. shim `globalThis.__dirname` to the packaged dist directory,
 *   2. pass the wasm bytes via `wasmBinary` (bypasses locateFile/fetch),
 *   3. runtime `import()` (not static) so bundlers don't choke on the 330 KB
 *      glue (same trick as planegcs — see feedback_webpack_emscripten_wasm).
 *
 * Proven: loads + builds real B-rep in ~700 ms (probe, 2026-06-04).
 */

import path from 'node:path';
import {
  assertNodeOcctRuntimeSnapshotUnchanged,
  readNodeOcctRuntimeSnapshot,
  type NodeOcctRuntimeIdentity,
} from './nodeOcctRuntimeIdentity';

/** Minimal surface we touch; the real embind module has thousands of symbols. */
export type OcctModule = Record<string, unknown>;

export interface NodeOcctLoadResult {
  ok: boolean;
  oc?: OcctModule;
  reason?: string;
  loadMs?: number;
  identity?: NodeOcctRuntimeIdentity;
}

let cached: { oc: OcctModule; identity: NodeOcctRuntimeIdentity; distKey: string } | null = null;
let pending: { distKey: string; promise: Promise<NodeOcctLoadResult> } | null = null;

function distKey(distDir: string): string {
  const resolved = path.resolve(distDir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Load (and cache) the real OCCT module in Node. Returns `{ ok:false }` with a
 * reason when not in Node or the package/wasm is unavailable — callers fall
 * back to the worker bridge or the stub.
 */
export async function loadOcctNode(opts: { distDir?: string } = {}): Promise<NodeOcctLoadResult> {
  const isNode = typeof process === 'object' && !!process.versions?.node;
  if (!isNode) return { ok: false, reason: 'not a Node runtime (use the worker bridge in the browser)' };
  const requestedDist = opts.distDir ?? path.join(process.cwd(), 'node_modules', 'opencascade.js', 'dist');
  const requestedKey = distKey(requestedDist);
  if (cached) {
    if (cached.distKey !== requestedKey) return { ok: false, reason: 'OCCT_RUNTIME_DIST_MISMATCH' };
    return { ok: true, oc: cached.oc, identity: cached.identity, loadMs: 0 };
  }
  // Exact assembly verification builds every part in parallel. Without an
  // in-flight cache, the first request instantiated one ~65 MB Emscripten
  // runtime per part before any caller could populate `cached`, leaking
  // process listeners and wasting memory. All concurrent first loads must
  // share the same factory promise.
  if (pending) {
    if (pending.distKey !== requestedKey) return { ok: false, reason: 'OCCT_RUNTIME_DIST_MISMATCH' };
    return pending.promise;
  }
  pending = { distKey: requestedKey, promise: loadOcctNodeUncached({ distDir: requestedDist }, requestedKey) };
  try { return await pending.promise; }
  finally { pending = null; }
}

async function loadOcctNodeUncached(opts: { distDir: string }, requestedKey: string): Promise<NodeOcctLoadResult> {
  const t0 = Date.now();
  try {
    // Do not use createRequire(...).resolve here. Next's production optimizer
    // removed the createRequire call while retaining `req.resolve`, producing
    // an undefined receiver only in the standalone server chunk. The runtime
    // package is deliberately copied to this fixed application-root location
    // by Dockerfile, which is also where npm installs it for local/CI runs.
    const distDir = opts.distDir;

    const snapshot = readNodeOcctRuntimeSnapshot(distDir);
    assertNodeOcctRuntimeSnapshotUnchanged(snapshot);

    // The old Emscripten glue reads __dirname during module initialization.
    // `require` is not needed because wasmBinary bypasses its Node fs loader.
    const g = globalThis as unknown as { __dirname?: string };
    const hadGlobalDirname = Object.hasOwn(g, '__dirname');
    const previousGlobalDirname = g.__dirname;
    g.__dirname = path.dirname(snapshot.gluePath);

    // Dynamic import (server-only module — never bundled for the browser, which
    // uses the worker bridge). A plain import() works under both Node and the
    // vitest runner; the Function('import') trick is blocked in vitest's vm.
    // `webpackIgnore` keeps webpack from treating the variable specifier as a
    // fully-dynamic context module ("Critical dependency: the request of a
    // dependency is an expression" in every route chunk importing this file).
    // At runtime nothing changes: Node resolves the bare specifier from
    // node_modules, and when the package is absent this returns { ok:false }
    // exactly as before (webpack could never bundle a variable request either).
    try {
      // Import the exact bytes already hashed above. Importing the source path
      // would leave a check/use race where a same-path swap could execute bytes
      // different from the recorded identity.
      const specifier = `data:text/javascript;base64,${snapshot.glueSource.toString('base64')}`;
      const mod = (await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier)) as { default?: (cfg: unknown) => Promise<OcctModule> };
      const glue = mod.default;
      if (typeof glue !== 'function') return { ok: false, reason: 'opencascade.js dist glue has no default factory' };
      assertNodeOcctRuntimeSnapshotUnchanged(snapshot);
      const oc = await glue({ wasmBinary: Buffer.from(snapshot.wasmBinary), locateFile: (p: string) => p });
      cached = { oc, identity: snapshot.identity, distKey: requestedKey };
      return { ok: true, oc, identity: snapshot.identity, loadMs: Date.now() - t0 };
    } finally {
      if (hadGlobalDirname) g.__dirname = previousGlobalDirname;
      else delete g.__dirname;
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Test seam: drop the cached module so a test can force a fresh load. */
export function __resetOcctNodeCache(): void {
  cached = null;
  pending = null;
}
