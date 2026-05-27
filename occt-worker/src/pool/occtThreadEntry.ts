/**
 * Worker-thread entry point for the OCCT pool.
 *
 * W11 D1-2 (ADR-007). Each spawned thread:
 *   1. Loads OCCT WASM in its OWN V8 heap (memory isolation — a kernel
 *      crash takes down one thread, not the whole worker process).
 *   2. Posts {type:'ready'} when WASM is up.
 *   3. Listens for {type:'op'} messages, dispatches by op kind, posts
 *      back {type:'result', ok}.
 *
 * The boolean op handler is reused as-is from `../occt/boolean.ts` —
 * it doesn't know it's running in a thread. That's the whole point of
 * the isolation boundary: existing op modules keep their imperative
 * style and the pool just hosts them.
 */

import { parentPort } from 'node:worker_threads';
import { ensureOcctReady } from '../occt/lifecycle.js';
import { runBoolean } from '../occt/boolean.js';
import type { ParentToWorker, WorkerToParent } from './protocol.js';

if (!parentPort) {
  throw new Error('occtThreadEntry must be spawned via worker_threads (parentPort missing)');
}

const port = parentPort;

function post(msg: WorkerToParent): void {
  port.postMessage(msg);
}

// Boot — load OCCT WASM, then signal readiness.
void (async () => {
  const t0 = Date.now();
  try {
    await ensureOcctReady();
    post({ type: 'ready', pid: process.pid, loadMs: Date.now() - t0 });
  } catch (err) {
    // Surface a fake init "result" so the pool can mark this slot dead
    // and respawn. jobId='__init__' is reserved.
    post({
      type: 'result',
      jobId: '__init__',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
})();

port.on('message', async (raw: ParentToWorker) => {
  if (raw.type !== 'op') return;
  const { jobId, op, params } = raw;
  try {
    let result: unknown;
    switch (op) {
      case 'boolean':
        result = await runBoolean(params);
        break;
      default: {
        // Exhaustiveness — adding a new op without handling it here
        // is a compile error thanks to OcctOp union narrowing.
        const _exhaustive: never = op;
        throw new Error(`unknown op in worker thread: ${_exhaustive as string}`);
      }
    }
    post({ type: 'result', jobId, ok: true, result });
  } catch (err) {
    post({
      type: 'result',
      jobId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
