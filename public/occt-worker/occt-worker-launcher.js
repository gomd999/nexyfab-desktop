/**
 * occt-worker-launcher.js — Phase 5 feature-detection wrapper.
 *
 * NexyFab Pro own-CAD (ADR-013). The bridge in `src/lib/occt/wasmBridge.ts`
 * loads ONE worker URL. This launcher is the URL deployments point at when
 * they want graceful real-or-stub fallback inside a single classic worker:
 *
 *   /occt-worker/occt-worker-launcher.js
 *
 *   1. Tries `importScripts('./opencascade.js')` + `'./occt-worker-real.js'`.
 *      If both succeed → real OCCT dispatcher takes over, posts
 *      `{ event: 'mode', mode: 'wasm' }` to the bridge.
 *   2. If EITHER import throws (404, MIME mismatch, WASM instantiation fail,
 *      CSP violation) → fall back to `importScripts('./occt-worker.js')`
 *      (the Phase 4 stub) and post `{ event: 'mode', mode: 'stub' }`.
 *
 * The bridge does not branch on the mode event — it's an informational
 * channel for the UI badge (CAD kernel: simulated / OCCT 7.7) and for
 * Sentry context tagging. The wire protocol (`{ reqId, ok, ... }`) is
 * identical in both modes (that's the whole point of the wrapper).
 *
 * EXECUTION ENVIRONMENT
 * ---------------------
 * Classic Web Worker (`importScripts` available, no ES modules at top level,
 * no DOM). `self` is `DedicatedWorkerGlobalScope`. Browsers run this file
 * in a separate thread.
 *
 * WHY A LAUNCHER, NOT INLINE IN occt-worker.js?
 * ---------------------------------------------
 * `occt-worker.js` is FROZEN (per task constraint + bridge contract). The
 * launcher pattern lets us:
 *   - Keep the stub byte-identical to `wasmWorkerStub.ts`.
 *   - Add real-binary detection WITHOUT touching the stub's IIFE.
 *   - Roll forward / back on the launcher URL via a single bridge config
 *     change (`workerUrl: '/occt-worker/occt-worker-launcher.js'`).
 *
 * MODE EVENT
 * ----------
 * The launcher posts a single, fire-and-forget message BEFORE delegating
 * to the loaded dispatcher:
 *
 *   { event: 'mode', mode: 'wasm' }  // real OCCT loaded ok
 *   { event: 'mode', mode: 'stub' }  // fell back to Phase 4 stub
 *
 * The bridge filters this on the receive side (event != null → don't try
 * to resolve a reqId). Stub mode also includes a `reason` string for the
 * Sentry breadcrumb and the readiness-debug overlay:
 *
 *   { event: 'mode', mode: 'stub', reason: 'importScripts opencascade.js: ...' }
 */
/* global self, importScripts */

(function () {
  'use strict';

  /**
   * Try to load the real OCCT dispatcher. Returns true if both scripts loaded
   * without throwing, false otherwise. The order matters — the real worker
   * dispatcher expects `globalThis.Module` (Emscripten factory) to be defined
   * already, so opencascade.js loader MUST land first.
   */
  function tryLoadReal() {
    try {
      importScripts('./opencascade.js');
    } catch (err) {
      return { ok: false, reason: 'importScripts opencascade.js: ' + errMsg(err) };
    }
    try {
      importScripts('./occt-worker-real.js');
    } catch (err) {
      return { ok: false, reason: 'importScripts occt-worker-real.js: ' + errMsg(err) };
    }
    return { ok: true };
  }

  /**
   * Load the Phase 4 stub. This MUST NOT throw under normal conditions — the
   * stub is a single ~10 KB file with no external deps and is the same file
   * the bridge loads directly when launcher is bypassed. If it does throw
   * (file missing in `public/`, CSP violation), we have no fallback to fall
   * back to; the worker is dead and the bridge will time out on init.
   */
  function loadStub() {
    try {
      importScripts('./occt-worker.js');
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'importScripts occt-worker.js: ' + errMsg(err) };
    }
  }

  /** Normalise an unknown thrown value to a short string. */
  function errMsg(err) {
    if (err && typeof err.message === 'string') return err.message;
    return String(err);
  }

  /**
   * Post the mode event. Wrapped so test environments that stub `postMessage`
   * with a non-function don't crash the launcher (the stub dispatcher would
   * then take over and the test asserts on its outputs).
   */
  function postMode(mode, reason) {
    try {
      if (typeof self.postMessage === 'function') {
        const msg = { event: 'mode', mode: mode };
        if (reason) msg.reason = reason;
        self.postMessage(msg);
      }
    } catch (_e) {
      // Best-effort; the dispatcher's reply path is what really matters.
    }
  }

  // ─── boot sequence ──────────────────────────────────────────────────────

  const realAttempt = tryLoadReal();
  if (realAttempt.ok) {
    postMode('wasm');
    // occt-worker-real.js has installed its own self.onmessage handler. We
    // are done — the dispatcher will service every subsequent request.
    return;
  }

  // Real path failed → stub fallback. Capture the reason so the UI can show
  // "CAD kernel: simulated (importScripts opencascade.js: 404)".
  const stubAttempt = loadStub();
  if (stubAttempt.ok) {
    postMode('stub', realAttempt.reason);
    return;
  }

  // Both paths failed. Post a mode event so the bridge can at least show
  // "kernel unavailable" instead of timing out silently. The worker thread
  // will still be alive (this IIFE simply returns) but no dispatcher is
  // installed, so every reqId from the bridge will hit a 30s timeout.
  postMode('stub', 'launcher: both real and stub paths failed (' +
    realAttempt.reason + '; ' + stubAttempt.reason + ')');
})();
