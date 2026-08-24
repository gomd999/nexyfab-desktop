#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import IORedis, { type Redis } from 'ioredis';
import {
  FEA_JOB_PREFIX,
  FEA_JOB_TTL_SECONDS,
  FEA_OWNER_PENDING_PREFIX,
  FEA_PROCESSING_KEY,
  FEA_QUEUE_KEY,
  type FeaJobProgress,
  type FeaJobResult,
  type SerializedFeaJob,
} from '../../packages/fea-contracts/src/index';

function boundedInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name}_INVALID`);
  }
  return parsed;
}

export function resolveFeaWorkerRuntimeConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { port: number; concurrency: number; leaseMs: number } {
  return {
    port: boundedInteger('PORT', env.PORT, 8080, 1, 65_535),
    concurrency: boundedInteger('FEA_WORKER_CONCURRENCY', env.FEA_WORKER_CONCURRENCY, 1, 1, 2),
    leaseMs: boundedInteger('FEA_WORKER_LEASE_MS', env.FEA_WORKER_LEASE_MS, 20_000, 10_000, 60_000),
  };
}

const runtimeConfig = resolveFeaWorkerRuntimeConfig();
const PORT = runtimeConfig.port;
const CONCURRENCY = runtimeConfig.concurrency;
const LEASE_MS = runtimeConfig.leaseMs;
const HEARTBEAT_MS = Math.max(1_000, Math.floor(LEASE_MS / 4));
const RESULT_MAX_BYTES = 4 * 1024 * 1024;
const SOLVER_PATH = join(dirname(fileURLToPath(import.meta.url)), 'solver.mjs');

export function feaWorkerBuildId(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return env.NEXYFAB_WORKER_BUILD_ID?.trim() || 'unknown';
}

const state = {
  startedAt: Date.now(), active: 0, completed: 0, failed: 0, cancelled: 0,
  retried: 0, recovered: 0, timedOut: 0, memoryKilled: 0,
};
const children = new Set<ChildProcess>();
let shuttingDown = false;

function jobKey(id: string): string { return `${FEA_JOB_PREFIX}${id}`; }
function ownerPendingKey(ownerUserId: string): string {
  return `${FEA_OWNER_PENDING_PREFIX}${createHash('sha256').update(ownerUserId).digest('hex')}`;
}

function redisUrl(): string {
  const url = process.env.REDIS_URL?.trim();
  if (!url) throw new Error('FEA_REDIS_URL_MISSING');
  return url;
}

function commandRedis(): Redis {
  return new IORedis(redisUrl(), { maxRetriesPerRequest: 2, connectTimeout: 5000 });
}

function blockingRedis(): Redis {
  return new IORedis(redisUrl(), { maxRetriesPerRequest: null, connectTimeout: 5000 });
}

async function save(redis: Redis, job: SerializedFeaJob): Promise<void> {
  await redis.set(jobKey(job.id), JSON.stringify(job), 'EX', FEA_JOB_TTL_SECONDS);
}

async function load(redis: Redis, id: string): Promise<SerializedFeaJob | null> {
  const raw = await redis.get(jobKey(id));
  if (!raw) return null;
  try { return JSON.parse(raw) as SerializedFeaJob; } catch { return null; }
}

const CLAIM_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return '' end
local job = cjson.decode(raw)
if job.status ~= 'queued' and job.status ~= 'retrying' then return '' end
if job.cancelRequested then
  job.status = 'cancelled'; job.completedAt = tonumber(ARGV[1]); job.updatedAt = tonumber(ARGV[1]); job.request = nil
  redis.call('SET', KEYS[1], cjson.encode(job), 'EX', ARGV[4]); return ''
end
if not job.request then
  job.status = 'failed'; job.completedAt = tonumber(ARGV[1]); job.updatedAt = tonumber(ARGV[1]); job.errorCode = 'FEA_REQUEST_MISSING'; job.errorMessage = 'Queued job has no request payload.'
  redis.call('SET', KEYS[1], cjson.encode(job), 'EX', ARGV[4]); return ''
end
job.status = 'processing'; job.attempts = tonumber(job.attempts or 0) + 1; job.startedAt = job.startedAt or tonumber(ARGV[1]); job.updatedAt = tonumber(ARGV[1]); job.heartbeatAt = tonumber(ARGV[1]); job.leaseToken = ARGV[2]; job.leaseExpiresAt = tonumber(ARGV[3]); job.progress = {percent=math.max(1, tonumber(job.progress.percent or 0)), stage='preparing'}
redis.call('SET', KEYS[1], cjson.encode(job), 'EX', ARGV[4]); return cjson.encode(job)
`;

async function claim(redis: Redis, id: string): Promise<SerializedFeaJob | null> {
  const now = Date.now();
  const raw = String(await redis.eval(
    CLAIM_SCRIPT, 1, jobKey(id), String(now), randomBytes(16).toString('hex'), String(now + LEASE_MS), String(FEA_JOB_TTL_SECONDS),
  ));
  if (!raw) {
    const terminal = await load(redis, id);
    if (terminal && (terminal.status === 'cancelled' || terminal.status === 'failed')) {
      await redis.srem(ownerPendingKey(terminal.ownerUserId), id);
    }
    return null;
  }
  return JSON.parse(raw) as SerializedFeaJob;
}

const HEARTBEAT_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local job = cjson.decode(raw)
if job.leaseToken ~= ARGV[1] then return 0 end
job.heartbeatAt = tonumber(ARGV[2])
job.leaseExpiresAt = tonumber(ARGV[3])
job.updatedAt = tonumber(ARGV[2])
redis.call('SET', KEYS[1], cjson.encode(job), 'EX', ARGV[4])
return job.cancelRequested and 2 or 1
`;

async function heartbeat(redis: Redis, job: SerializedFeaJob): Promise<'ok' | 'cancel' | 'lost'> {
  const now = Date.now();
  const result = Number(await redis.eval(
    HEARTBEAT_SCRIPT, 1, jobKey(job.id), job.leaseToken!, String(now), String(now + LEASE_MS), String(FEA_JOB_TTL_SECONDS),
  ));
  return result === 2 ? 'cancel' : result === 1 ? 'ok' : 'lost';
}

const PROGRESS_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local job = cjson.decode(raw)
if job.leaseToken ~= ARGV[1] then return 0 end
job.progress = cjson.decode(ARGV[2])
job.updatedAt = tonumber(ARGV[3])
redis.call('SET', KEYS[1], cjson.encode(job), 'EX', ARGV[4])
return 1
`;

async function updateProgress(redis: Redis, job: SerializedFeaJob, progress: FeaJobProgress): Promise<void> {
  await redis.eval(
    PROGRESS_SCRIPT, 1, jobKey(job.id), job.leaseToken!, JSON.stringify(progress), String(Date.now()), String(FEA_JOB_TTL_SECONDS),
  );
}

type ChildResult =
  | { ok: true; result: FeaJobResult }
  | { ok: false; errorCode: string; errorMessage: string; retryable: boolean };

async function runSolver(redis: Redis, job: SerializedFeaJob): Promise<ChildResult> {
  const child = spawn(
    process.execPath,
    [`--max-old-space-size=${job.request!.limits.memoryMb}`, SOLVER_PATH],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production' } },
  );
  children.add(child);
  let stdout = Buffer.alloc(0);
  let stderr = '';
  let outputExceeded = false;
  let timedOut = false;
  let cancelled = false;
  child.stdout.on('data', chunk => {
    stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
    if (stdout.length > RESULT_MAX_BYTES) {
      outputExceeded = true;
      child.kill('SIGKILL');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.startsWith('NEXYFAB_FEA_PROGRESS:')) {
        try {
          const progress = JSON.parse(line.slice('NEXYFAB_FEA_PROGRESS:'.length)) as FeaJobProgress;
          void updateProgress(redis, job, progress).catch(() => undefined);
        } catch { /* malformed progress does not affect the solve */ }
      } else if (line && stderr.length < 64 * 1024) stderr += `${line}\n`;
    }
  });
  child.stdin.end(JSON.stringify(job.request));

  const timer = setTimeout(() => {
    timedOut = true;
    state.timedOut += 1;
    child.kill('SIGKILL');
  }, job.request!.limits.timeoutMs);
  const beat = setInterval(() => {
    void heartbeat(redis, job).then(status => {
      if (status === 'cancel') {
        cancelled = true;
        child.kill('SIGKILL');
      }
    }).catch(() => undefined);
  }, HEARTBEAT_MS);
  beat.unref?.();

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once('close', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: -1, signal: null }));
  });
  clearTimeout(timer);
  clearInterval(beat);
  children.delete(child);
  if (cancelled) return { ok: false, errorCode: 'FEA_CANCELLED', errorMessage: 'Cancelled by user.', retryable: false };
  if (timedOut) return { ok: false, errorCode: 'FEA_TIMEOUT', errorMessage: `Solver exceeded ${job.request!.limits.timeoutMs}ms.`, retryable: true };
  if (outputExceeded) return { ok: false, errorCode: 'FEA_RESULT_LIMIT', errorMessage: 'Solver result exceeded transport limit.', retryable: false };
  try {
    const parsed = JSON.parse(stdout.toString('utf8')) as ChildResult;
    if (!parsed.ok && exit.signal === 'SIGKILL' && /heap out of memory|allocation failed/i.test(stderr)) {
      state.memoryKilled += 1;
      return { ok: false, errorCode: 'FEA_MEMORY_LIMIT', errorMessage: 'Solver exceeded its memory boundary.', retryable: false };
    }
    return parsed;
  } catch {
    if (exit.signal === 'SIGKILL') state.memoryKilled += 1;
    return {
      ok: false,
      errorCode: exit.signal === 'SIGKILL' ? 'FEA_MEMORY_LIMIT' : 'FEA_SOLVER_PROTOCOL',
      errorMessage: `Solver exited without a valid bounded result (code=${exit.code}, signal=${exit.signal ?? 'none'}). ${stderr.slice(-1000)}`,
      retryable: exit.signal !== 'SIGKILL',
    };
  }
}

async function finish(redis: Redis, claimed: SerializedFeaJob, outcome: ChildResult): Promise<void> {
  const current = await load(redis, claimed.id);
  if (!current || current.leaseToken !== claimed.leaseToken) return;
  const now = Date.now();
  const cancelled = current.cancelRequested || (!outcome.ok && outcome.errorCode === 'FEA_CANCELLED');
  if (cancelled) {
    current.status = 'cancelled';
    current.completedAt = now;
    current.progress = { percent: current.progress.percent, stage: 'cancelled', message: 'cancelled' };
    state.cancelled += 1;
  } else if (outcome.ok) {
    current.status = 'complete';
    current.result = outcome.result;
    current.completedAt = now;
    current.progress = { percent: 100, stage: 'complete' };
    state.completed += 1;
  } else if (outcome.retryable && current.attempts < current.maxAttempts && !shuttingDown) {
    current.status = 'retrying';
    current.retryable = true;
    current.errorCode = outcome.errorCode;
    current.errorMessage = outcome.errorMessage;
    current.progress = { percent: 0, stage: 'retrying', message: `retry ${current.attempts + 1}/${current.maxAttempts}` };
    state.retried += 1;
  } else {
    current.status = 'failed';
    current.retryable = outcome.retryable;
    current.errorCode = outcome.errorCode;
    current.errorMessage = outcome.errorMessage;
    current.completedAt = now;
    state.failed += 1;
  }
  current.updatedAt = now;
  delete current.leaseToken;
  delete current.leaseExpiresAt;
  delete current.heartbeatAt;
  if (current.status !== 'retrying') delete current.request;
  await save(redis, current);
  await redis.lrem(FEA_PROCESSING_KEY, 1, current.id);
  if (current.status === 'retrying') await redis.rpush(FEA_QUEUE_KEY, current.id);
  else await redis.srem(ownerPendingKey(current.ownerUserId), current.id);
}

async function workerLoop(index: number): Promise<void> {
  const redis = commandRedis();
  const blocker = blockingRedis();
  try {
    while (!shuttingDown) {
      const id = await blocker.blmove(FEA_QUEUE_KEY, FEA_PROCESSING_KEY, 'LEFT', 'RIGHT', 5);
      if (!id) continue;
      const job = await claim(redis, id);
      if (!job) {
        await redis.lrem(FEA_PROCESSING_KEY, 1, id);
        continue;
      }
      state.active += 1;
      try {
        const outcome = await runSolver(redis, job);
        // Graceful deployment replacement intentionally leaves the reliable
        // processing entry leased. A successor requeues it after lease expiry.
        if (!shuttingDown) await finish(redis, job, outcome);
      } catch (error) {
        await finish(redis, job, {
          ok: false,
          errorCode: 'FEA_WORKER_ERROR',
          errorMessage: `${index}:${error instanceof Error ? error.message : String(error)}`.slice(0, 4000),
          retryable: true,
        });
      } finally {
        state.active -= 1;
      }
    }
  } finally {
    await Promise.allSettled([redis.quit(), blocker.quit()]);
  }
}

const RECOVER_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then redis.call('LREM', KEYS[2], 1, ARGV[1]); return 'missing' end
local job = cjson.decode(raw)
if job.status ~= 'processing' and job.status ~= 'cancel_requested' then redis.call('LREM', KEYS[2], 1, ARGV[1]); return 'stale' end
if tonumber(job.leaseExpiresAt or 0) > tonumber(ARGV[2]) then return 'leased' end
redis.call('LREM', KEYS[2], 1, ARGV[1])
job.leaseToken = nil; job.leaseExpiresAt = nil; job.heartbeatAt = nil; job.updatedAt = tonumber(ARGV[2])
if job.cancelRequested then
  job.status = 'cancelled'; job.completedAt = tonumber(ARGV[2]); job.request = nil
  redis.call('SREM', KEYS[4], ARGV[1])
  redis.call('SET', KEYS[1], cjson.encode(job), 'EX', ARGV[3]); return 'cancelled'
end
if tonumber(job.attempts or 0) < tonumber(job.maxAttempts or 1) and job.request then
  job.status = 'retrying'; job.progress = {percent=0, stage='retrying', message='recovered after expired worker lease'}
  redis.call('SET', KEYS[1], cjson.encode(job), 'EX', ARGV[3]); redis.call('RPUSH', KEYS[3], ARGV[1]); return 'requeued'
end
job.status = 'failed'; job.completedAt = tonumber(ARGV[2]); job.errorCode = 'FEA_WORKER_CRASH'; job.errorMessage = 'Worker lease expired and retry budget was exhausted.'; job.request = nil
redis.call('SREM', KEYS[4], ARGV[1]); redis.call('SET', KEYS[1], cjson.encode(job), 'EX', ARGV[3]); return 'failed'
`;

async function recoverExpired(redis: Redis): Promise<void> {
  const ids = await redis.lrange(FEA_PROCESSING_KEY, 0, -1);
  for (const id of new Set(ids)) {
    const job = await load(redis, id);
    const pendingKey = job ? ownerPendingKey(job.ownerUserId) : `${FEA_OWNER_PENDING_PREFIX}unknown`;
    const result = await redis.eval(
      RECOVER_SCRIPT, 4, jobKey(id), FEA_PROCESSING_KEY, FEA_QUEUE_KEY, pendingKey,
      id, String(Date.now()), String(FEA_JOB_TTL_SECONDS),
    );
    if (result === 'requeued') state.recovered += 1;
    else if (result === 'cancelled') state.cancelled += 1;
    else if (result === 'failed') state.failed += 1;
  }
}

interface FeaHealthRedis {
  ping(): Promise<string>;
  llen(key: string): Promise<number>;
}

export function createFeaHealthServer(
  redis: FeaHealthRedis,
  env: Readonly<Record<string, string | undefined>> = process.env,
): http.Server {
  return http.createServer(async (req, res) => {
    if (req.url === '/api/health/live') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({
        ok: true,
        phase: 'live',
        service: 'nexyfab-fea-worker',
        buildId: feaWorkerBuildId(env),
        active: state.active,
        uptimeMs: Date.now() - state.startedAt,
      }));
      return;
    }
    if (req.url === '/api/health/ready' || req.url === '/healthz') {
      try {
        const pong = await redis.ping();
        const buildId = feaWorkerBuildId(env);
        const blockers = [
          ...(pong === 'PONG' ? [] : ['redis_unavailable']),
          ...(buildId === 'unknown' ? ['build_id_missing'] : []),
        ];
        res.writeHead(blockers.length === 0 ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({
          ok: blockers.length === 0,
          phase: 'ready',
          service: 'nexyfab-fea-worker',
          buildId,
          blockers,
          active: state.active,
          uptimeMs: Date.now() - state.startedAt,
        }));
      } catch {
        const buildId = feaWorkerBuildId(env);
        const blockers = ['redis_unavailable', ...(buildId === 'unknown' ? ['build_id_missing'] : [])];
        res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: false, phase: 'ready', service: 'nexyfab-fea-worker', buildId, blockers }));
      }
      return;
    }
    if (req.url === '/metrics') {
      try {
        const [queued, processing] = await Promise.all([redis.llen(FEA_QUEUE_KEY), redis.llen(FEA_PROCESSING_KEY)]);
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({
          service: 'nexyfab-fea-worker',
          buildId: feaWorkerBuildId(env),
          ...state,
          queued,
          processing,
          uptimeMs: Date.now() - state.startedAt,
        }));
      } catch {
        res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: false, service: 'nexyfab-fea-worker', code: 'METRICS_UNAVAILABLE' }));
      }
      return;
    }
    res.writeHead(404).end();
  });
}

async function start(): Promise<void> {
  const redis = commandRedis();
  await redis.ping();
  await recoverExpired(redis);
  const recovery = setInterval(() => { void recoverExpired(redis).catch(() => undefined); }, LEASE_MS);
  recovery.unref?.();

  const server = createFeaHealthServer(redis);
  server.listen(PORT, '0.0.0.0');
  for (let index = 0; index < CONCURRENCY; index += 1) void workerLoop(index);

  const stop = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    for (const child of children) child.kill('SIGKILL');
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/server.mjs')) {
  void start().catch(error => {
    console.error('[fea-worker] fatal', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
