import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import {
  REMOTE_PRECISION_CAD_LIMITS,
  REMOTE_PRECISION_CAD_TOOL_SCOPES,
  validateRemotePrecisionCadBinding,
  type RemotePrecisionCadProjectBinding,
  type RemotePrecisionCadToolName,
} from './remoteCadContract';
import {
  verifyServerCadHydrationBinding,
  type ServerCadHydrationBinding,
} from './serverCadHydrationBinding';

/** Boundaries shared by browser-triggered calls and the isolated worker. */
export const PRECISION_CAD_WORKER_LIMITS = Object.freeze({
  maxArgumentBytes: REMOTE_PRECISION_CAD_LIMITS.maxToolArgumentsBytes,
  maxResultBytes: 512 * 1024,
  timeoutMs: 8_000,
  maxQueueDepth: 64,
  maxRetainedJobs: 512,
  maxIdempotencyKeyBytes: 128,
} as const);

export type PrecisionCadWorkerStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
export type PrecisionCadWorkerErrorCode =
  | 'INVALID_REQUEST' | 'ARGUMENTS_TOO_LARGE' | 'PATH_INPUT_FORBIDDEN'
  | 'SECRET_INPUT_FORBIDDEN' | 'QUEUE_FULL' | 'IDEMPOTENCY_CONFLICT'
  | 'WORKER_FAILED' | 'WORKER_TIMEOUT' | 'RESULT_TOO_LARGE' | 'CANCELLED'
  /** The isolated child has no authoritative CAD-session hydration adapter. */
  | 'CAD_RUNTIME_HYDRATION_REQUIRED';

export type PrecisionCadWorkerJob = {
  id: string;
  idempotencyKey: string;
  userId: string;
  binding: RemotePrecisionCadProjectBinding;
  tool: RemotePrecisionCadToolName;
  scope: (typeof REMOTE_PRECISION_CAD_TOOL_SCOPES)[RemotePrecisionCadToolName];
  status: PrecisionCadWorkerStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  result?: unknown;
  errorCode?: PrecisionCadWorkerErrorCode;
  auditId: string;
};

export type PrecisionCadWorkerInput = {
  idempotencyKey: string;
  userId: string;
  binding: RemotePrecisionCadProjectBinding;
  tool: RemotePrecisionCadToolName;
  arguments: Record<string, unknown>;
  /** Server-only CAS binding; never accepted from browser arguments. */
  cadHydrationBinding?: ServerCadHydrationBinding;
};

type TraceEvent = {
  event: 'queued' | 'started' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
  jobId: string;
  auditId: string;
  tool: RemotePrecisionCadToolName;
  status: PrecisionCadWorkerStatus;
  durationMs?: number;
};

type QueueOptions = {
  workerScript?: string;
  maxConcurrency?: number;
  timeoutMs?: number;
  maxQueueDepth?: number;
  maxRetainedJobs?: number;
  /** Test-only environment values. API callers cannot supply child env. */
  workerEnv?: Record<string, string>;
  trace?: (event: TraceEvent) => void;
};

type InternalJob = PrecisionCadWorkerJob & {
  arguments: Record<string, unknown>;
  cadHydrationBinding?: ServerCadHydrationBinding;
  requestHash: string;
  idempotencyLookupKey: string;
  child?: ChildProcess;
  resolvers?: Set<(job: PrecisionCadWorkerJob) => void>;
};
type WorkerResponse = { ok: true; result: unknown } | { ok: false; code?: string };

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$/;
const PATH_KEY = /(?:^|[_-])(?:path|file|files|dir|directory|folder|filename|url|uri|output|input)(?:$|[_-])/i;
const PATH_VALUE = /^(?:[a-z]:[\\/]|[\\/]{1,2}|~[\\/]|\\\\|\.\.?[\\/])|[\\/]|\u0000/i;
const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|credential|private[_-]?key)/i;

/**
 * The eight installer-core tools do not currently consume canonical CAD
 * ownership or process-local OCCT handles. Reject these keys recursively so a
 * client cannot hide a runtime reference below an assembly/options object.
 */
const CAD_OWNERSHIP_KEY = /^(?:cadOwnership|ownership|partId|partIds|canonicalPartId|canonicalPartIds|brepHandle|brepHandles|hostHandle|toolHandle|runtimeHandle|occtHandle|shapeHandle|featureId|featureIds|sketchId|sketchIds|entityId|entityIds|faceId|faceIds|edgeId|edgeIds|mateId|mateIds|cadHydrationBinding|canonicalMappingKey|mappingKey|sourceRecordId|sourceRecordIds)$/i;

export function hasPrecisionCadWorkerCadReference(value: unknown, key = ''): boolean {
  if (CAD_OWNERSHIP_KEY.test(key)) return true;
  if (Array.isArray(value)) return value.some(item => hasPrecisionCadWorkerCadReference(item));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([childKey, child]) => hasPrecisionCadWorkerCadReference(child, childKey));
  }
  return false;
}

function jsonBytes(value: unknown): number | null {
  try { const json = JSON.stringify(value); return json === undefined ? null : Buffer.byteLength(json, 'utf8'); }
  catch { return null; }
}

function canonicalNormalizedJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalNormalizedJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalNormalizedJson(record[key])}`).join(',')}}`;
}

function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('json_value_unsupported');
  return canonicalNormalizedJson(JSON.parse(serialized) as unknown);
}

function requestHash(input: PrecisionCadWorkerInput): string {
  return createHash('sha256').update(canonicalJson({
    userId: input.userId,
    binding: input.binding,
    tool: input.tool,
    scope: REMOTE_PRECISION_CAD_TOOL_SCOPES[input.tool],
    arguments: input.arguments,
    cadHydrationBinding: input.cadHydrationBinding ?? null,
  })).digest('hex');
}

function hasForbidden(value: unknown, key = ''): { path: boolean; secret: boolean } {
  if (typeof value === 'string') return { path: PATH_KEY.test(key) || PATH_VALUE.test(value) || /\.(?:step|stl|obj|dxf|png|jpg|json|csv)$/i.test(value), secret: false };
  if (Array.isArray(value)) return value.reduce((out, item) => { const next = hasForbidden(item, key); return { path: out.path || next.path, secret: out.secret || next.secret }; }, { path: false, secret: false });
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce<{ path: boolean; secret: boolean }>((out, [childKey, child]) => {
      const next = hasForbidden(child, childKey);
      return { path: out.path || next.path, secret: out.secret || SECRET_KEY.test(childKey) || next.secret };
    }, { path: false, secret: false });
  }
  return { path: false, secret: false };
}

function publicJob(job: InternalJob): PrecisionCadWorkerJob {
  const { arguments: _arguments, cadHydrationBinding: _cadHydrationBinding, requestHash: _requestHash, idempotencyLookupKey: _lookupKey, child: _child, resolvers: _resolvers, ...safe } = job;
  return structuredClone(safe);
}

function killProcessTree(child: ChildProcess): void {
  if (child.killed) return;
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    killer.unref();
  } else if (child.pid && process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  } else child.kill('SIGKILL');
}

function safeWorkerEnv(overrides: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const blocked = /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE[_-]?KEY|DATABASE_URL|AUTH)/i;
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? 'production' };
  for (const [key, value] of Object.entries(process.env)) if (!blocked.test(key) && value !== undefined) env[key] = value;
  env.NEXYFAB_AGENT_RUNTIME_PROFILE = 'installer-core';
  env.NEXYFAB_AGENT_SCOPE = 'read-propose-apply-export';
  for (const [key, value] of Object.entries(overrides ?? {})) if (/^[A-Z0-9_]{1,64}$/.test(key)) env[key] = value;
  return env;
}

function defaultWorkerScript(): string {
  return resolve(process.cwd(), 'scripts/drawing-to-3d/precision-cad-worker.mjs');
}

export class PrecisionCadWorkerQueue {
  private readonly jobs = new Map<string, InternalJob>();
  private readonly idempotency = new Map<string, string>();
  private readonly pending: string[] = [];
  private running = 0;
  private readonly options: Required<Pick<QueueOptions, 'workerScript' | 'maxConcurrency' | 'timeoutMs' | 'maxQueueDepth' | 'maxRetainedJobs'>> & QueueOptions;

  constructor(options: QueueOptions = {}) {
    this.options = {
      ...options,
      workerScript: options.workerScript ?? defaultWorkerScript(),
      maxConcurrency: Math.min(4, Math.max(1, options.maxConcurrency ?? 1)),
      timeoutMs: Math.min(PRECISION_CAD_WORKER_LIMITS.timeoutMs, Math.max(100, options.timeoutMs ?? PRECISION_CAD_WORKER_LIMITS.timeoutMs)),
      maxQueueDepth: Math.min(PRECISION_CAD_WORKER_LIMITS.maxQueueDepth, Math.max(1, options.maxQueueDepth ?? PRECISION_CAD_WORKER_LIMITS.maxQueueDepth)),
      maxRetainedJobs: Math.min(PRECISION_CAD_WORKER_LIMITS.maxRetainedJobs, Math.max(16, options.maxRetainedJobs ?? PRECISION_CAD_WORKER_LIMITS.maxRetainedJobs)),
    };
  }

  enqueue(input: PrecisionCadWorkerInput): { ok: true; job: PrecisionCadWorkerJob; reused: boolean } | { ok: false; errorCode: PrecisionCadWorkerErrorCode } {
    const bindingIssues = validateRemotePrecisionCadBinding(input.binding);
    const argsBytes = jsonBytes(input.arguments);
    const forbidden = hasForbidden(input.arguments);
    const clientCadReference = hasPrecisionCadWorkerCadReference(input.arguments);
    if (!SAFE_ID.test(input.userId) || !SAFE_KEY.test(input.idempotencyKey)
      || Buffer.byteLength(input.idempotencyKey, 'utf8') > PRECISION_CAD_WORKER_LIMITS.maxIdempotencyKeyBytes
      || bindingIssues.length || !Object.prototype.hasOwnProperty.call(REMOTE_PRECISION_CAD_TOOL_SCOPES, input.tool)
      || !input.arguments || typeof input.arguments !== 'object' || Array.isArray(input.arguments)) return { ok: false, errorCode: 'INVALID_REQUEST' };
    if (argsBytes === null || argsBytes > this.limit('maxArgumentBytes')) return { ok: false, errorCode: 'ARGUMENTS_TOO_LARGE' };
    if (forbidden.secret) return { ok: false, errorCode: 'SECRET_INPUT_FORBIDDEN' };
    if (forbidden.path) return { ok: false, errorCode: 'PATH_INPUT_FORBIDDEN' };
    if (clientCadReference) return { ok: false, errorCode: 'CAD_RUNTIME_HYDRATION_REQUIRED' };
    if (input.cadHydrationBinding && !verifyServerCadHydrationBinding({ binding: input.cadHydrationBinding, userId: input.userId })) {
      return { ok: false, errorCode: 'CAD_RUNTIME_HYDRATION_REQUIRED' };
    }
    const key = `${input.userId}:${input.binding.projectId}:${input.binding.revision}:${input.binding.updatedAt}:${input.idempotencyKey}`;
    const inputRequestHash = requestHash(input);
    const existingId = this.idempotency.get(key);
    if (existingId) {
      const existing = this.jobs.get(existingId);
      if (existing) {
        if (existing.requestHash !== inputRequestHash) return { ok: false, errorCode: 'IDEMPOTENCY_CONFLICT' };
        return { ok: true, job: publicJob(existing), reused: true };
      }
      this.idempotency.delete(key);
    }
    if (this.pending.length >= this.options.maxQueueDepth) return { ok: false, errorCode: 'QUEUE_FULL' };
    if (this.jobs.size >= this.options.maxRetainedJobs) this.prune();
    if (this.jobs.size >= this.options.maxRetainedJobs) return { ok: false, errorCode: 'QUEUE_FULL' };
    const now = Date.now();
    const id = `pcad-${randomUUID()}`;
    const auditId = `pcad_${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
    const job: InternalJob = { id, idempotencyKey: input.idempotencyKey, userId: input.userId, binding: structuredClone(input.binding), tool: input.tool, scope: REMOTE_PRECISION_CAD_TOOL_SCOPES[input.tool], status: 'queued', createdAt: now, updatedAt: now, auditId, arguments: structuredClone(input.arguments), ...(input.cadHydrationBinding ? { cadHydrationBinding: structuredClone(input.cadHydrationBinding) } : {}), requestHash: inputRequestHash, idempotencyLookupKey: key };
    this.jobs.set(id, job); this.idempotency.set(key, id); this.pending.push(id);
    this.trace(job, 'queued');
    this.kick();
    return { ok: true, job: publicJob(job), reused: false };
  }

  get(id: string): PrecisionCadWorkerJob | null { const job = this.jobs.get(id); return job ? publicJob(job) : null; }

  async wait(id: string, timeoutMs = this.options.timeoutMs + 1_000): Promise<PrecisionCadWorkerJob | null> {
    const job = this.jobs.get(id); if (!job) return null;
    if (job.status !== 'queued' && job.status !== 'running') return publicJob(job);
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        job.resolvers?.delete(wrapped);
        resolve(publicJob(job));
      }, timeoutMs);
      const wrapped = (next: PrecisionCadWorkerJob) => {
        clearTimeout(timer);
        job.resolvers?.delete(wrapped);
        resolve(next);
      };
      (job.resolvers ??= new Set()).add(wrapped);
    });
  }

  cancel(id: string): PrecisionCadWorkerJob | null {
    const job = this.jobs.get(id); if (!job || ['succeeded', 'failed', 'timed_out', 'cancelled'].includes(job.status)) return job ? publicJob(job) : null;
    job.status = 'cancelled'; job.errorCode = 'CANCELLED'; job.updatedAt = Date.now();
    if (job.child) killProcessTree(job.child);
    this.trace(job, 'cancelled'); this.resolve(job); this.kick();
    return publicJob(job);
  }

  private limit(name: 'maxArgumentBytes'): number { return name === 'maxArgumentBytes' ? PRECISION_CAD_WORKER_LIMITS.maxArgumentBytes : 0; }
  private trace(job: InternalJob, event: TraceEvent['event']): void { this.options.trace?.({ event, jobId: job.id, auditId: job.auditId, tool: job.tool, status: job.status, ...(job.startedAt ? { durationMs: (job.finishedAt ?? Date.now()) - job.startedAt } : {}) }); }
  private resolve(job: InternalJob): void {
    const next = publicJob(job);
    for (const resolve of job.resolvers ?? []) resolve(next);
    job.resolvers?.clear();
  }
  private prune(): void {
    for (const [id, job] of this.jobs) if (job.status !== 'queued' && job.status !== 'running') {
      this.jobs.delete(id);
      if (this.idempotency.get(job.idempotencyLookupKey) === id) this.idempotency.delete(job.idempotencyLookupKey);
      if (this.jobs.size < this.options.maxRetainedJobs) break;
    }
  }
  private kick(): void { while (this.running < this.options.maxConcurrency && this.pending.length) { const id = this.pending.shift()!; const job = this.jobs.get(id); if (job) { this.running++; void this.run(job).finally(() => { this.running--; this.kick(); }); } } }

  private async run(job: InternalJob): Promise<void> {
    if (job.status === 'cancelled') return;
    job.status = 'running'; job.startedAt = Date.now(); job.updatedAt = job.startedAt; this.trace(job, 'started');
    try {
      const response = await this.spawn(job);
      if ((job.status as PrecisionCadWorkerStatus) === 'cancelled') return;
      if (!response.ok) throw Object.assign(new Error(response.code ?? 'WORKER_FAILED'), { code: response.code });
      const bytes = jsonBytes(response.result);
      if (bytes === null || bytes > PRECISION_CAD_WORKER_LIMITS.maxResultBytes) throw Object.assign(new Error('RESULT_TOO_LARGE'), { code: 'RESULT_TOO_LARGE' });
      job.result = response.result; job.status = 'succeeded';
    } catch (error) {
      if ((job.status as PrecisionCadWorkerStatus) === 'cancelled') return;
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
      job.errorCode = code === 'WORKER_TIMEOUT' ? 'WORKER_TIMEOUT' : code === 'RESULT_TOO_LARGE' ? 'RESULT_TOO_LARGE' : code === 'CAD_RUNTIME_HYDRATION_REQUIRED' ? 'CAD_RUNTIME_HYDRATION_REQUIRED' : 'WORKER_FAILED';
      job.status = job.errorCode === 'WORKER_TIMEOUT' ? 'timed_out' : 'failed';
    } finally {
      job.updatedAt = Date.now(); job.finishedAt = job.updatedAt;
      const finalStatus = job.status as PrecisionCadWorkerStatus;
      this.trace(job, finalStatus === 'succeeded' ? 'succeeded' : finalStatus === 'timed_out' ? 'timed_out' : finalStatus === 'cancelled' ? 'cancelled' : 'failed'); this.resolve(job);
    }
  }

  private spawn(job: InternalJob): Promise<WorkerResponse> {
    return new Promise((resolveResponse, reject) => {
      const child = spawn(process.execPath, [this.options.workerScript], { cwd: process.cwd(), detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env: safeWorkerEnv(this.options.workerEnv) });
      job.child = child;
      const chunks: Buffer[] = []; let total = 0; let settled = false;
      const finish = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); job.child = undefined; fn(); };
      const timer = setTimeout(() => { killProcessTree(child); finish(() => reject(Object.assign(new Error('WORKER_TIMEOUT'), { code: 'WORKER_TIMEOUT' }))); }, this.options.timeoutMs);
      child.stdout?.on('data', (chunk: Buffer) => { total += chunk.length; if (total > PRECISION_CAD_WORKER_LIMITS.maxResultBytes + 1024) { killProcessTree(child); finish(() => reject(Object.assign(new Error('RESULT_TOO_LARGE'), { code: 'RESULT_TOO_LARGE' }))); return; } chunks.push(chunk); });
      child.once('error', () => finish(() => reject(Object.assign(new Error('WORKER_FAILED'), { code: 'WORKER_FAILED' }))));
      child.once('close', code => finish(() => { if (code !== 0) return reject(Object.assign(new Error('WORKER_FAILED'), { code: 'WORKER_FAILED' })); try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as WorkerResponse; resolveResponse(value); } catch { reject(Object.assign(new Error('WORKER_FAILED'), { code: 'WORKER_FAILED' })); } }));
      child.stdin?.end(JSON.stringify({ projectId: job.binding.projectId, revision: job.binding.revision, updatedAt: job.binding.updatedAt, userId: job.userId, tool: job.tool, arguments: job.arguments, ...(job.cadHydrationBinding ? { cadHydrationBinding: job.cadHydrationBinding } : {}) }) + '\n');
    });
  }
}

/** Shared process queue used by the server-side remote agent route. */
export const precisionCadWorkerQueue = new PrecisionCadWorkerQueue();

export async function executePrecisionCadToolInIsolatedWorker(input: PrecisionCadWorkerInput): Promise<PrecisionCadWorkerJob> {
  const enqueued = precisionCadWorkerQueue.enqueue(input);
  if (!enqueued.ok) return { id: '', idempotencyKey: input.idempotencyKey, userId: input.userId, binding: input.binding, tool: input.tool, scope: REMOTE_PRECISION_CAD_TOOL_SCOPES[input.tool], status: 'failed', createdAt: Date.now(), updatedAt: Date.now(), errorCode: enqueued.errorCode, auditId: '' };
  return (await precisionCadWorkerQueue.wait(enqueued.job.id)) ?? enqueued.job;
}
