/**
 * Fixture worker for OcctWorkerPool tests. Mimics the real
 * occtThreadEntry message protocol but doesn't load OCCT — it just
 * echoes params back with controllable behaviors.
 *
 * Behaviors are driven by `workerData.mode`:
 *   - 'ready'      → posts {type:'ready'} after `readyDelayMs` then
 *                    echoes ops as {ok:true, result:params}.
 *   - 'crash-init' → posts {type:'result', jobId:'__init__', ok:false}
 *                    so the pool recycles before any op runs.
 *   - 'crash-op'   → posts 'ready' but every op message kills the
 *                    thread (process.exit(1)) to simulate a WASM crash.
 *   - 'hang'       → posts 'ready' but never replies to ops; the pool
 *                    must time out the op.
 */

import { parentPort, workerData } from 'node:worker_threads';
import type { ParentToWorker, WorkerToParent } from '../protocol.js';

if (!parentPort) throw new Error('echoWorker requires parentPort');
const port = parentPort;
const mode = (workerData as { mode?: string } | undefined)?.mode ?? 'ready';
const readyDelayMs = (workerData as { readyDelayMs?: number } | undefined)?.readyDelayMs ?? 0;

function post(msg: WorkerToParent): void {
  port.postMessage(msg);
}

if (mode === 'crash-init') {
  post({ type: 'result', jobId: '__init__', ok: false, error: 'simulated init crash' });
} else {
  setTimeout(() => {
    post({ type: 'ready', pid: process.pid, loadMs: readyDelayMs });
  }, readyDelayMs);
}

port.on('message', (raw: ParentToWorker) => {
  if (raw.type !== 'op') return;
  if (mode === 'crash-op') {
    // Exit before responding. Pool's 'exit' handler should respawn.
    process.exit(1);
  }
  if (mode === 'hang') {
    // Intentionally do nothing — let the op timeout fire.
    return;
  }
  // Default: echo params back as the result.
  post({ type: 'result', jobId: raw.jobId, ok: true, result: { echoed: raw.params } });
  // Mimic the real worker's post-op memory snapshot. Numbers are
  // synthetic but deterministic enough for the aggregation test.
  post({ type: 'mem', heapUsedMb: 1.0, heapTotalMb: 2.0, rssMb: 10.0 });
});
