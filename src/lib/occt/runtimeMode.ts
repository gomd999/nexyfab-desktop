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

/**
 * Three-state runtime mode (Phase 5 spike):
 *
 *  - `'stub'`     — Phase 4 baseline. No `opencascade.js` package, no WASM
 *                   blob in `/occt-worker/`. Bridge runs `createStubBridge`
 *                   for all geometry.
 *  - `'wasm-stub'`— Phase 5 spike: `opencascade.js` is INSTALLED in
 *                   `node_modules/` and `wasmReal.ts` can wrap it, but the
 *                   WASM blob has NOT been copied into `public/occt-worker/`
 *                   yet (or we're running outside a browser context). The
 *                   wrapper's stub-fallback path is active.
 *  - `'wasm'`     — Phase 5 launch: WASM blob is at
 *                   `/occt-worker/opencascade.wasm`. Real BREP runs.
 */
export type OcctRuntimeMode = 'stub' | 'wasm-stub' | 'wasm';

/** URL probed to determine if the real OCCT WASM is shipped alongside the worker. */
export const OCCT_WASM_PROBE_URL = '/occt-worker/opencascade.wasm';

/**
 * The two worker URLs the bridge can be pointed at.
 *
 *  - `WORKER_URL_STUB` — Phase 4 baseline. Loads `occt-worker/occt-worker.js`
 *    directly; no real-OCCT attempt. Safest default; bridge has used this
 *    since Phase 3. Always responds (synthetic bbox) so the UI never hangs.
 *  - `WORKER_URL_LAUNCHER` — Phase 5 feature-detection wrapper. Loads
 *    `occt-worker/occt-worker-launcher.js`, which `importScripts`-probes the
 *    real `opencascade.js` + `occt-worker-real.js` and falls back to the
 *    stub when either is missing. Posts a `{event:'mode',mode}` event so the
 *    UI badge can read "OCCT 7.7" vs "simulated".
 *
 * The bridge does not branch on these — they're just string constants
 * callers pass into `createWasmBridge({ workerUrl })`. Use `pickWorkerUrl`
 * below when you have an `OcctRuntimeMode` in hand and want the right URL
 * without writing a switch yourself.
 */
export const WORKER_URL_STUB = '/occt-worker/occt-worker.js';
export const WORKER_URL_LAUNCHER = '/occt-worker/occt-worker-launcher.js';

/**
 * Pick the recommended `workerUrl` for a given runtime mode.
 *
 *   - `'stub'`      → `WORKER_URL_STUB` (direct stub load, fastest path)
 *   - `'wasm-stub'` → `WORKER_URL_STUB` (no WASM blob, launcher would just
 *                     fall back to stub anyway; skip the extra round-trip)
 *   - `'wasm'`      → `WORKER_URL_LAUNCHER` (probe + fallback; safer than
 *                     hard-coding the real path because a 404 on the WASM
 *                     blob silently degrades instead of hanging the bridge)
 *
 * Phase 5 launch wires this into the bridge construction site so the worker
 * URL adapts to whichever deployment shape is live without a config flip.
 */
export function pickWorkerUrl(mode: OcctRuntimeMode): string {
  return mode === 'wasm' ? WORKER_URL_LAUNCHER : WORKER_URL_STUB;
}

let cached: OcctRuntimeMode | null = null;
let pending: Promise<OcctRuntimeMode> | null = null;

/**
 * Synchronous check for the `opencascade.js` package presence. Used as the
 * tie-breaker between `'stub'` (nothing) and `'wasm-stub'` (package present,
 * blob absent). The detection is best-effort:
 *
 *  - In Node (Vitest), `require.resolve` works directly. We probe lazily via
 *    a try/catch around `createRequire` so we don't crash in browsers where
 *    `module` is undefined.
 *  - In the browser, the bundler typically bakes the answer in at build time
 *    via tree-shaking. We expose a `packagePresenceOverride` for tests + UIs
 *    that want to declare their environment explicitly.
 */
function hasOpenCascadePackage(): boolean {
  // Browser short-circuit — no require, no node_modules.
  if (typeof window !== 'undefined' && typeof process === 'undefined') {
    return false;
  }
  try {
    // Avoid bundler static analysis: indirect require via Function.
    const indirect = new Function('m', 'return require.resolve(m)') as (m: string) => string;
    indirect('opencascade.js');
    return true;
  } catch {
    return false;
  }
}

/** Test seam — when set, overrides `hasOpenCascadePackage()`. */
let packagePresenceOverride: boolean | null = null;

/**
 * Force the package-presence answer (tests only). Pass `null` to clear.
 */
export function setOcctPackagePresenceOverride(value: boolean | null): void {
  packagePresenceOverride = value;
}

/**
 * Detect the OCCT runtime mode. Cached after the first resolution.
 *
 * - `'wasm'`      — `/occt-worker/opencascade.wasm` responds 2xx; the real
 *                   OCCT binary ships and the worker will use it.
 * - `'wasm-stub'` — No WASM blob, but the `opencascade.js` package is in
 *                   `node_modules/` so `wasmReal.ts` can wrap a mock. Phase 5
 *                   spike state.
 * - `'stub'`      — Neither WASM blob nor package present: the Phase 4
 *                   baseline. Bridge uses `createStubBridge` end-to-end.
 *
 * The probe runs at most once; concurrent callers share the in-flight
 * promise so we never issue duplicate HEAD requests.
 */
export async function detectOcctMode(): Promise<OcctRuntimeMode> {
  if (cached !== null) return cached;
  if (pending !== null) return pending;

  const pkgPresent = packagePresenceOverride !== null ? packagePresenceOverride : hasOpenCascadePackage();

  // No DOM → no browser → no WASM-fetch path. Differentiate stub vs wasm-stub
  // on package presence so the dev-machine readout is informative.
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    cached = pkgPresent ? 'wasm-stub' : 'stub';
    return cached;
  }

  pending = (async (): Promise<OcctRuntimeMode> => {
    try {
      const res = await fetch(OCCT_WASM_PROBE_URL, { method: 'HEAD', cache: 'no-store' });
      if (res.ok) {
        cached = 'wasm';
      } else {
        cached = pkgPresent ? 'wasm-stub' : 'stub';
      }
    } catch {
      // Network failure, CSP block, CORS, abort — treat as stub-family,
      // package presence picks the variant.
      cached = pkgPresent ? 'wasm-stub' : 'stub';
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
