/** NexyFab commercial OCCT launcher: real WASM only, never loads the stub. */
/* global self, importScripts */
(function () {
  'use strict';
  try {
    importScripts('./opencascade.js');
    importScripts('./occt-worker-real.js');
  } catch (error) {
    const reason = error && typeof error.message === 'string' ? error.message : String(error);
    try { self.postMessage({ event: 'mode', mode: 'failed', reason: `commercial-wasm-required: ${reason}` }); } catch (_ignored) { void _ignored; }
    self.onmessage = function (event) {
      const reqId = event && event.data && event.data.reqId;
      self.postMessage({ reqId: reqId, ok: false, error: `commercial-wasm-required: ${reason}`, warnings: [] });
    };
  }
})();
