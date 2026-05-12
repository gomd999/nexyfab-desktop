/**
 * Σ — Simulation queue + adapter pattern (shared across CFD/MBD/CAM/etc).
 *
 * Each Σi solver follows the same shape:
 *   1. Client POSTs an input spec → server enqueues a job, returns jobId.
 *   2. The adapter (Docker container in production, mock in dev/test)
 *      processes the job asynchronously.
 *   3. Client polls GET /job/:id → status (queued/running/done/failed) +
 *      result body once done.
 *
 * The runtime ships with mock adapters that return canned-but-shape-correct
 * results in 50-200ms. Swapping in a real OpenFOAM/Chrono container is a
 * matter of replacing one function, not rewriting the agent surface.
 */

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Job<TIn, TOut> {
  id: string;
  kind: string;
  status: JobStatus;
  input: TIn;
  result?: TOut;
  error?: string;
  /** Solver-reported progress 0-1. Updated mid-run when the adapter supports it. */
  progress: number;
  /** Wall-clock timestamps. */
  enqueuedAtMs: number;
  startedAtMs?: number;
  finishedAtMs?: number;
}

export interface SolverAdapter<TIn, TOut> {
  /** Human label for telemetry. */
  name: string;
  /** Process one input. Throw → job 'failed' with error message. */
  solve: (input: TIn, onProgress?: (p: number) => void) => Promise<TOut>;
  /** True for the mocked dev adapter; false when wired to real Docker. */
  isMock: boolean;
}

interface KindRegistration<TIn, TOut> {
  adapter: SolverAdapter<TIn, TOut>;
  jobs: Map<string, Job<TIn, TOut>>;
}

const REGISTRY = new Map<string, KindRegistration<unknown, unknown>>();
const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_JOBS_PER_KIND = 100;

export function registerSolver<TIn, TOut>(kind: string, adapter: SolverAdapter<TIn, TOut>): void {
  REGISTRY.set(kind, { adapter, jobs: new Map() } as unknown as KindRegistration<unknown, unknown>);
}

export function newJobId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function gc(reg: KindRegistration<unknown, unknown>): void {
  const now = Date.now();
  for (const [id, j] of reg.jobs) {
    const dead = j.finishedAtMs && now - j.finishedAtMs > JOB_TTL_MS;
    if (dead) reg.jobs.delete(id);
  }
  while (reg.jobs.size > MAX_JOBS_PER_KIND) {
    const oldest = reg.jobs.keys().next().value;
    if (oldest === undefined) break;
    reg.jobs.delete(oldest);
  }
}

export async function enqueueJob<TIn, TOut>(kind: string, input: TIn): Promise<Job<TIn, TOut>> {
  const reg = REGISTRY.get(kind) as KindRegistration<TIn, TOut> | undefined;
  if (!reg) throw new Error(`no solver registered for kind=${kind}`);
  gc(reg as unknown as KindRegistration<unknown, unknown>);

  const job: Job<TIn, TOut> = {
    id: newJobId(),
    kind,
    status: 'queued',
    input,
    progress: 0,
    enqueuedAtMs: Date.now(),
  };
  reg.jobs.set(job.id, job);

  // Run in the background. We don't await — caller polls.
  void (async () => {
    job.status = 'running';
    job.startedAtMs = Date.now();
    try {
      const result = await reg.adapter.solve(input, (p) => {
        job.progress = Math.max(0, Math.min(1, p));
      });
      job.result = result;
      job.progress = 1;
      job.status = 'done';
    } catch (e) {
      job.error = (e as Error).message;
      job.status = 'failed';
    } finally {
      job.finishedAtMs = Date.now();
    }
  })();

  return job;
}

export function getJob<TIn, TOut>(kind: string, jobId: string): Job<TIn, TOut> | null {
  const reg = REGISTRY.get(kind) as KindRegistration<TIn, TOut> | undefined;
  if (!reg) return null;
  return reg.jobs.get(jobId) ?? null;
}

/** Synchronously await a job's completion. Useful for tests + simple agent
 *  flows where polling overhead isn't worth it. */
export async function awaitJob<TIn, TOut>(
  kind: string, jobId: string, timeoutMs = 30_000,
): Promise<Job<TIn, TOut>> {
  const start = Date.now();
   
  while (true) {
    const job = getJob<TIn, TOut>(kind, jobId);
    if (!job) throw new Error(`job ${jobId} not found`);
    if (job.status === 'done' || job.status === 'failed') return job;
    if (Date.now() - start > timeoutMs) throw new Error(`job ${jobId} timed out after ${timeoutMs}ms`);
    await new Promise(r => setTimeout(r, 25));
  }
}

/** Reset registry (test isolation). */
export function _resetSolvers(): void {
  REGISTRY.clear();
}

/** Inspect registered kinds (telemetry / debug). */
export function listSolverKinds(): Array<{ kind: string; isMock: boolean; jobCount: number }> {
  const out: Array<{ kind: string; isMock: boolean; jobCount: number }> = [];
  for (const [kind, reg] of REGISTRY) {
    out.push({ kind, isMock: reg.adapter.isMock, jobCount: reg.jobs.size });
  }
  return out;
}
