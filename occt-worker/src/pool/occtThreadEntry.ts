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
import v8 from 'node:v8';
import { ensureOcctReady } from '../occt/lifecycle.js';
import { runBoolean, type BooleanParams } from '../occt/boolean.js';
import { runFillet, type FilletParams } from '../occt/fillet.js';
import { runChamfer, type ChamferParams } from '../occt/chamfer.js';
import { runShell, type ShellParams } from '../occt/shell.js';
import { runExtrude, type ExtrudeParams } from '../occt/extrude.js';
import { runRevolve, type RevolveParams } from '../occt/revolve.js';
import { runMirror, type MirrorParams } from '../occt/mirror.js';
import { runPattern, type PatternParams } from '../occt/pattern.js';
import { runSweep, type SweepParams } from '../occt/sweep.js';
import { runLoft, type LoftParams } from '../occt/loft.js';
import type { ParentToWorker, WorkerToParent } from './protocol.js';

if (!parentPort) {
  throw new Error('occtThreadEntry must be spawned via worker_threads (parentPort missing)');
}

const port = parentPort;

function post(msg: WorkerToParent): void {
  port.postMessage(msg);
}

/** Push a memory snapshot. Called after each op so the pool can
 *  observe per-slot heap growth without an extra RPC. v8.getHeapStatistics
 *  reports THIS thread's isolate (each worker has its own V8 instance).
 *  Bytes → MB with 1-decimal precision. */
function postMemUpdate(): void {
  const stats = v8.getHeapStatistics();
  const rss = process.memoryUsage().rss;
  const mb = (b: number): number => Math.round((b / 1024 / 1024) * 10) / 10;
  post({
    type: 'mem',
    heapUsedMb: mb(stats.used_heap_size),
    heapTotalMb: mb(stats.total_heap_size),
    rssMb: mb(rss),
  });
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
  const { jobId, op, params, userId } = raw;
  // Ctx is passed only to 3D-host ops that may resolve R2 input
  // (W16 D1-2). Pure-primitive ops ignore it. Future per-user quotas
  // / telemetry hooks can read ctx without changing handler signatures.
  const ctx = { userId };
  try {
    let result: unknown;
    switch (op) {
      case 'boolean':
        result = await runBoolean(params as BooleanParams, ctx);
        break;
      case 'fillet':
        result = await runFillet(params as FilletParams, ctx);
        break;
      case 'chamfer':
        result = await runChamfer(params as ChamferParams, ctx);
        break;
      case 'shell':
        result = await runShell(params as ShellParams, ctx);
        break;
      case 'extrude':
        result = await runExtrude(params as ExtrudeParams);
        break;
      case 'revolve':
        result = await runRevolve(params as RevolveParams);
        break;
      case 'mirror':
        result = await runMirror(params as MirrorParams, ctx);
        break;
      case 'pattern':
        result = await runPattern(params as PatternParams, ctx);
        break;
      case 'sweep':
        result = await runSweep(params as SweepParams);
        break;
      case 'loft':
        result = await runLoft(params as LoftParams);
        break;
      default: {
        // Exhaustiveness — adding a new op without handling it here
        // is a compile error thanks to OcctOp union narrowing.
        const _exhaustive: never = op;
        throw new Error(`unknown op in worker thread: ${_exhaustive as string}`);
      }
    }
    post({ type: 'result', jobId, ok: true, result });
    postMemUpdate();
  } catch (err) {
    post({
      type: 'result',
      jobId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    postMemUpdate();
  }
});
