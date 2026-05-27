/**
 * Main-thread OCCT worker pool — W11 D1-2 (ADR-007).
 *
 * Why a pool, not a single shared kernel?
 *   - OCCT WASM can corrupt its heap on degenerate input (e.g. a
 *     zero-volume cut). Sharing one kernel across requests means one
 *     bad request poisons every subsequent one.
 *   - replicad / occt-import-js are not concurrent — multiple ops on
 *     one kernel handle serialise anyway. A pool gives real parallelism.
 *
 * Design:
 *   - Boot N threads (default = min(cpuCount-1, 3); env: OCCT_POOL_SIZE).
 *   - Each thread loads WASM lazily and posts {type:'ready'} when done.
 *   - Bounded FIFO queue (default cap = pool size × 4; env:
 *     OCCT_QUEUE_MAX). Overflow throws QueueFullError → 503.
 *   - Worker thread crash / exit → respawn its slot, fail the in-flight
 *     job with WorkerCrashError.
 *   - Op timeout (env: OCCT_OP_TIMEOUT_MS, default 30 s) → terminate
 *     the slot (its kernel state is suspect) and respawn.
 *   - drain() returns after all in-flight jobs settle + all threads
 *     terminate. Called from SIGTERM handler.
 *   - Op-count recycling (W12 D1-2): after a slot completes
 *     OCCT_MAX_OPS_PER_SLOT (default 50) ops it is recycled — even if
 *     healthy — so OCCT WASM heap fragmentation can't accumulate.
 *     Recycling happens AFTER the op's result is delivered to the
 *     caller; in-flight jobs never see the rotation. The replacement
 *     slot is spawned eagerly so the pool capacity stays at `size`.
 */

import { Worker } from 'node:worker_threads';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type {
  OcctOp,
  OcctOpRequest,
  WorkerToParent,
} from './protocol.js';

const DEFAULT_POOL_SIZE = Math.max(1, Math.min(os.cpus().length - 1, 3));
const DEFAULT_QUEUE_MULT = 4;
const DEFAULT_OP_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OPS_PER_SLOT = 50;

interface PendingJob {
  jobId: string;
  op: OcctOp;
  /** Params shape is op-dependent. Pool keeps it opaque — the worker
   *  entry's switch narrows by op (see protocol.OcctParamsByOp). */
  params: unknown;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  enqueuedAt: number;
  /** Set once dispatched to a slot. */
  slot?: WorkerSlot;
  timer?: NodeJS.Timeout;
}

interface WorkerSlot {
  id: number;
  worker: Worker;
  ready: boolean;
  /** Job currently running on this slot, or null when idle. */
  inFlight: PendingJob | null;
  opsCompleted: number;
  /** Set when the slot is being torn down — no new jobs assigned. */
  draining: boolean;
}

export class QueueFullError extends Error {
  override readonly name = 'QueueFullError';
  constructor(public readonly capacity: number) {
    super(`occt-worker queue full (capacity ${capacity})`);
  }
}

export class WorkerCrashError extends Error {
  override readonly name = 'WorkerCrashError';
  constructor(message: string) {
    super(message);
  }
}

export class OpTimeoutError extends Error {
  override readonly name = 'OpTimeoutError';
  constructor(public readonly timeoutMs: number) {
    super(`OCCT op exceeded ${timeoutMs} ms`);
  }
}

export interface PoolOptions {
  size?: number;
  queueMax?: number;
  opTimeoutMs?: number;
  /** Op-count threshold for healthy-slot recycling. Default 50; env
   *  OCCT_MAX_OPS_PER_SLOT. Setting to 0 disables recycling — only
   *  use for tests / debugging since OCCT WASM heap grows unbounded. */
  maxOpsPerSlot?: number;
  /** Override the worker entry path — tests pass a fixture. Default
   *  resolves to compiled `dist/pool/occtThreadEntry.js`. */
  entryUrl?: URL | string;
}

export interface PoolStatus {
  size: number;
  readyCount: number;
  busyCount: number;
  queueDepth: number;
  queueCapacity: number;
  totalOpsCompleted: number;
  /** Number of slot recycles since pool start (op-count + crashes +
   *  timeouts all count). Used by soak tests to verify the rotation
   *  policy is firing as expected. */
  totalRecycles: number;
}

export class OcctWorkerPool {
  private readonly size: number;
  private readonly queueCap: number;
  private readonly opTimeoutMs: number;
  private readonly maxOpsPerSlot: number;
  private readonly entryUrl: URL | string;
  private slots: WorkerSlot[] = [];
  private queue: PendingJob[] = [];
  private nextSlotId = 0;
  private nextJobId = 0;
  private totalRecycles = 0;
  /** Lifetime op count — kept separately from per-slot opsCompleted
   *  because slot recycling resets the per-slot counter. Soak tests
   *  read this for "did we actually do N ops since boot?" assertions. */
  private totalOpsLifetime = 0;
  private shuttingDown = false;

  constructor(opts: PoolOptions = {}) {
    this.size = opts.size
      ?? parseInt(process.env.OCCT_POOL_SIZE ?? `${DEFAULT_POOL_SIZE}`, 10);
    this.queueCap = opts.queueMax
      ?? parseInt(process.env.OCCT_QUEUE_MAX ?? `${this.size * DEFAULT_QUEUE_MULT}`, 10);
    this.opTimeoutMs = opts.opTimeoutMs
      ?? parseInt(process.env.OCCT_OP_TIMEOUT_MS ?? `${DEFAULT_OP_TIMEOUT_MS}`, 10);
    this.maxOpsPerSlot = opts.maxOpsPerSlot
      ?? parseInt(process.env.OCCT_MAX_OPS_PER_SLOT ?? `${DEFAULT_MAX_OPS_PER_SLOT}`, 10);
    // Default entry resolves to `./occtThreadEntry.js` next to this
    // file. In dev (tsx watch) tsx maps .js → .ts; in prod the file
    // is .js directly. Tests pass a fixture URL via opts.entryUrl.
    this.entryUrl = opts.entryUrl
      ?? new URL('./occtThreadEntry.js', import.meta.url);
  }

  /** Spawn all slots. Idempotent — calling twice is a no-op. */
  start(): void {
    if (this.slots.length > 0) return;
    for (let i = 0; i < this.size; i++) {
      this.spawnSlot();
    }
  }

  /** Submit an op. Resolves with the worker's `result`. */
  execute(op: OcctOp, params: unknown): Promise<unknown> {
    if (this.shuttingDown) {
      return Promise.reject(new Error('pool shutting down'));
    }
    if (this.queue.length + this.busyCount() >= this.queueCap + this.size) {
      return Promise.reject(new QueueFullError(this.queueCap));
    }
    return new Promise((resolve, reject) => {
      const job: PendingJob = {
        jobId: `j${++this.nextJobId}`,
        op,
        params,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      };
      this.queue.push(job);
      this.tryDispatch();
    });
  }

  status(): PoolStatus {
    return {
      size: this.size,
      readyCount: this.slots.filter(s => s.ready && !s.draining).length,
      busyCount: this.busyCount(),
      queueDepth: this.queue.length,
      queueCapacity: this.queueCap,
      totalOpsCompleted: this.totalOpsLifetime,
      totalRecycles: this.totalRecycles,
    };
  }

  /** Stop accepting new jobs and wait for in-flight to settle + all
   *  threads to exit. Caller may impose a hard deadline. */
  async drain(): Promise<void> {
    this.shuttingDown = true;
    // Reject queued jobs we never dispatched — fast-fail callers.
    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      job.reject(new Error('pool draining — job not dispatched'));
    }
    // Wait for in-flight to settle (each resolution clears slot.inFlight).
    await Promise.all(
      this.slots.map(s => new Promise<void>(resolve => {
        s.draining = true;
        const tick = (): void => {
          if (!s.inFlight) {
            s.worker.terminate().finally(() => resolve());
            return;
          }
          setTimeout(tick, 50);
        };
        tick();
      })),
    );
    this.slots = [];
  }

  // ─── internal ────────────────────────────────────────────────────

  private busyCount(): number {
    return this.slots.filter(s => s.inFlight !== null).length;
  }

  private spawnSlot(): WorkerSlot {
    const slot: WorkerSlot = {
      id: ++this.nextSlotId,
      worker: new Worker(typeof this.entryUrl === 'string'
        ? fileURLToPath(this.entryUrl)
        : this.entryUrl),
      ready: false,
      inFlight: null,
      opsCompleted: 0,
      draining: false,
    };

    slot.worker.on('message', (msg: WorkerToParent) => this.onMessage(slot, msg));
    slot.worker.on('error', err => this.onWorkerError(slot, err));
    slot.worker.on('exit', code => this.onWorkerExit(slot, code));

    this.slots.push(slot);
    return slot;
  }

  private tryDispatch(): void {
    while (this.queue.length > 0) {
      const slot = this.slots.find(s => s.ready && !s.draining && s.inFlight === null);
      if (!slot) return;
      const job = this.queue.shift()!;
      this.dispatchToSlot(slot, job);
    }
  }

  private dispatchToSlot(slot: WorkerSlot, job: PendingJob): void {
    slot.inFlight = job;
    job.slot = slot;
    const req: OcctOpRequest = { type: 'op', jobId: job.jobId, op: job.op, params: job.params };
    slot.worker.postMessage(req);

    // Per-op timeout — slot is suspect after a timeout (kernel could
    // be stuck in a WASM infinite loop), so we terminate + respawn.
    job.timer = setTimeout(() => {
      if (slot.inFlight !== job) return; // race — completed already
      const err = new OpTimeoutError(this.opTimeoutMs);
      this.failJob(job, err);
      this.recycleSlot(slot, `op timeout after ${this.opTimeoutMs} ms`);
    }, this.opTimeoutMs);
  }

  private onMessage(slot: WorkerSlot, msg: WorkerToParent): void {
    if (msg.type === 'ready') {
      slot.ready = true;
      this.tryDispatch();
      return;
    }
    // msg.type === 'result'
    if (msg.jobId === '__init__') {
      // Init-time failure — the worker couldn't load OCCT. Recycle.
      this.recycleSlot(slot, msg.ok ? 'init ok but unexpected job id' : `init failed: ${msg.error}`);
      return;
    }
    const job = slot.inFlight;
    if (!job || job.jobId !== msg.jobId) {
      // Stale result (timed-out or already failed). Ignore.
      return;
    }
    if (job.timer) clearTimeout(job.timer);
    slot.inFlight = null;
    slot.opsCompleted++;
    this.totalOpsLifetime++;
    if (msg.ok) {
      job.resolve(msg.result);
    } else {
      job.reject(new Error(msg.error));
    }
    // Op-count recycling: rotate the slot AFTER the result is delivered
    // so the caller never sees the cycle. We check before tryDispatch
    // so this slot won't pick up another job on its way out.
    if (
      this.maxOpsPerSlot > 0
      && !slot.draining
      && slot.opsCompleted >= this.maxOpsPerSlot
    ) {
      this.recycleSlot(slot, `op count threshold (${slot.opsCompleted}/${this.maxOpsPerSlot})`);
    }
    this.tryDispatch();
  }

  private onWorkerError(slot: WorkerSlot, err: Error): void {
    console.error(`[occt-pool] slot ${slot.id} worker error:`, err.message);
    const job = slot.inFlight;
    if (job) {
      this.failJob(job, new WorkerCrashError(`slot ${slot.id} crashed: ${err.message}`));
    }
    this.recycleSlot(slot, `error: ${err.message}`);
  }

  private onWorkerExit(slot: WorkerSlot, code: number): void {
    const job = slot.inFlight;
    if (job) {
      this.failJob(job, new WorkerCrashError(`slot ${slot.id} exited (code ${code}) mid-op`));
    }
    // Remove the dead slot from the registry regardless of why it
    // exited (crash, op-count recycle, drain). `draining` alone can't
    // distinguish "rotate me" from "pool shutting down" — we use
    // shuttingDown for that, set only by drain().
    this.slots = this.slots.filter(s => s !== slot);
    if (this.shuttingDown) return;
    console.warn(`[occt-pool] slot ${slot.id} exited (code ${code}) — respawning`);
    this.spawnSlot();
  }

  private failJob(job: PendingJob, err: Error): void {
    if (job.timer) clearTimeout(job.timer);
    if (job.slot && job.slot.inFlight === job) {
      job.slot.inFlight = null;
    }
    job.reject(err);
  }

  private recycleSlot(slot: WorkerSlot, reason: string): void {
    if (slot.draining) return; // idempotent — multiple recycle triggers OK
    console.warn(`[occt-pool] recycling slot ${slot.id} (ops=${slot.opsCompleted}): ${reason}`);
    slot.draining = true;
    this.totalRecycles++;
    slot.worker.terminate().catch(() => { /* already dead, fine */ });
    // The 'exit' handler removes + respawns.
  }
}

// ─── Singleton ───────────────────────────────────────────────────────

let _pool: OcctWorkerPool | null = null;

export function getPool(): OcctWorkerPool {
  if (!_pool) {
    _pool = new OcctWorkerPool();
    _pool.start();
  }
  return _pool;
}

export async function drainPool(): Promise<void> {
  if (!_pool) return;
  await _pool.drain();
  _pool = null;
}

/** Test-only — replace the singleton (e.g. with a fixture-driven
 *  pool). Callers must drainPool() first if needed. */
export function _setPoolForTests(pool: OcctWorkerPool | null): void {
  _pool = pool;
}
