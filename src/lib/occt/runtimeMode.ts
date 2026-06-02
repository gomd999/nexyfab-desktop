/**
 * occt/runtimeMode — runtime detection: stub vs real OCCT WASM.
 *
 * NexyFab Pro own-CAD (ADR-013). The worker bundle at `/occt-worker/` is
 * either the Phase 4 stub (synthetic bboxes, fake STEP envelope) or the
 * Phase 5 real OCCT WASM (real BREP, real STEP). The bridge does NOT care —
 * the wire protocol is identical. But the UI does:
 *
 *   - Render mode badge ("CAD kernel: simulated" vs "OCCT 7.7")
 *   - Block STEP export → "stub STEP files have no geometry" warning
 *   - Block design-partner shipping for stub kernels
 *   - Enable / disable advanced features that need real BREP (mesh, GD&T snap)
 *
 * DETECTION
 * ---------
 * The presence of `opencascade.wasm` at `/occt-worker/` is the signal. We
 * HEAD the URL once, cache the result for the lifetime of the page, and
 * return `'stub'` or `'wasm'`. On Node/jsdom (no `window`, no `fetch`) we
 * return `'stub'` — there's no browser to render WASM, so the in-process
 * stub bridge is the only option anyway.
 *
 * The cache is single-shot: subsequent calls reuse the first answer. Tests
 * that need to re-detect (e.g. simulating a deployment) can call
 * `resetOcctModeCache()`.
 *
 * NOT A FEATURE FLAG
 * ------------------
 * This function reports the CURRENT runtime situation. It does NOT decide
 * which worker the bridge loads — that's the bridge's job, and the bridge
 * always loads `/occt-worker/occt-worker.js`. The stub at that URL is the
 * one that may or may not re-`importScripts` the real binary based on its
 * own internal probe (see PHASE_5_INTEGRATION.md Step 2).
 */

export type OcctRuntimeMode = 'stub' | 'wasm';

/** URL probed to determine if the real OCCT WASM is shipped alongside the worker. */
export const OCCT_WASM_PROBE_URL = '/occt-worker/opencascade.wasm';

let cached: OcctRuntimeMode | null = null;
let pending: Promise<OcctRuntimeMode> | null = null;

/**
 * Detect the OCCT runtime mode. Cached after the first resolution.
 *
 * - `'wasm'` — `/occt-worker/opencascade.wasm` responds 2xx; the real OCCT
 *   binary ships and the worker will use it.
 * - `'stub'` — anywhere else: 4xx response, network failure, no `fetch`
 *   global, or running under Node/jsdom (no `window`).
 *
 * The probe runs at most once; concurrent callers share the in-flight
 * promise so we never issue duplicate HEAD requests.
 */
export async function detectOcctMode(): Promise<OcctRuntimeMode> {
  if (cached !== null) return cached;
  if (pending !== null) return pending;

  // No DOM → no browser → no WASM path. The bridge already falls back to the
  // in-process stub via `createWasmWorkerStub`. Report `'stub'` and cache.
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    cached = 'stub';
    return cached;
  }

  pending = (async (): Promise<OcctRuntimeMode> => {
    try {
      const res = await fetch(OCCT_WASM_PROBE_URL, { method: 'HEAD', cache: 'no-store' });
      cached = res.ok ? 'wasm' : 'stub';
    } catch {
      // Network failure, CSP block, CORS, abort — treat as stub.
      cached = 'stub';
    } finally {
      pending = null;
    }
    return cached;
  })();

  return pending;
}

/**
 * Reset the cached detection result. Intended for tests that need to
 * exercise different deployment scenarios within a single suite.
 */
export function resetOcctModeCache(): void {
  cached = null;
  pending = null;
}

/**
 * Synchronous accessor — returns the cached mode if already resolved, or
 * `null` if `detectOcctMode()` hasn't completed. UIs that mount synchronously
 * can render a "detecting…" badge while awaiting the async probe.
 */
export function getCachedOcctMode(): OcctRuntimeMode | null {
  return cached;
}
