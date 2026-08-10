import { createHash, randomBytes } from 'node:crypto';
import IORedis, { type Redis } from 'ioredis';
import {
  FEA_IDEMPOTENCY_PREFIX,
  FEA_JOB_PREFIX,
  FEA_JOB_TTL_SECONDS,
  FEA_MAX_ATTEMPTS,
  FEA_MAX_OWNER_PENDING,
  FEA_OWNER_PENDING_PREFIX,
  FEA_PROCESSING_KEY,
  FEA_QUEUE_KEY,
  type FeaJobSubmission,
  type SerializedFeaJob,
  validateFeaJobRequest,
} from './contracts';

let client: Redis | null = null;

function redisClient(): Redis {
  const url = process.env.REDIS_URL?.trim();
  if (!url) throw new Error('FEA_REDIS_URL_MISSING');
  if (!client) {
    client = new IORedis(url, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      connectTimeout: 5000,
    });
  }
  return client;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec).sort().map(key => `${JSON.stringify(key)}:${stableStringify(rec[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function feaJobKey(id: string): string { return `${FEA_JOB_PREFIX}${id}`; }
export function feaOwnerPendingKey(ownerUserId: string): string {
  return `${FEA_OWNER_PENDING_PREFIX}${sha256(ownerUserId)}`;
}

export type EnqueueFeaResult =
  | { ok: true; job: SerializedFeaJob; reused: boolean }
  | { ok: false; code: string; message: string };

const ENQUEUE_SCRIPT = `
local existing = redis.call('GET', KEYS[2])
if existing then return {existing, 'existing'} end
if tonumber(redis.call('SCARD', KEYS[4])) >= tonumber(ARGV[4]) then return {'', 'pending'} end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[1])
redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[1])
redis.call('RPUSH', KEYS[3], ARGV[3])
redis.call('SADD', KEYS[4], ARGV[3])
redis.call('EXPIRE', KEYS[4], ARGV[1])
return {ARGV[3], 'created'}
`;

export async function enqueueFeaJob(submission: FeaJobSubmission): Promise<EnqueueFeaResult> {
  const validation = validateFeaJobRequest(submission.request);
  if (!validation.ok) return validation;
  if (!submission.ownerUserId || !submission.scopeId) {
    return { ok: false, code: 'OWNER_SCOPE_REQUIRED', message: 'Authenticated owner scope is required.' };
  }
  const redis = redisClient();
  const pendingKey = feaOwnerPendingKey(submission.ownerUserId);
  const pending = await redis.scard(pendingKey);
  if (pending >= FEA_MAX_OWNER_PENDING) {
    return { ok: false, code: 'FEA_PENDING_LIMIT', message: `At most ${FEA_MAX_OWNER_PENDING} FEA jobs may be pending per user.` };
  }

  const requestCanonical = stableStringify(validation.request);
  const requestHash = sha256(requestCanonical);
  const rawIdempotency = (submission.idempotencyKey?.trim() || requestHash).slice(0, 200);
  const idempotencyHash = sha256(`${submission.ownerUserId}\0${submission.scopeId}\0${rawIdempotency}`);
  const id = `fea-${randomBytes(12).toString('hex')}`;
  const now = Date.now();
  const job: SerializedFeaJob = {
    id,
    ownerUserId: submission.ownerUserId,
    scopeId: submission.scopeId,
    ...(submission.projectId ? { projectId: submission.projectId } : {}),
    status: 'queued',
    progress: { percent: 0, stage: 'queued' },
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    maxAttempts: FEA_MAX_ATTEMPTS,
    requestHash,
    idempotencyHash,
    request: validation.request,
  };
  const idemKey = `${FEA_IDEMPOTENCY_PREFIX}${idempotencyHash}`;
  const result = await redis.eval(
    ENQUEUE_SCRIPT,
    4,
    feaJobKey(id), idemKey, FEA_QUEUE_KEY, pendingKey,
    String(FEA_JOB_TTL_SECONDS), JSON.stringify(job), id, String(FEA_MAX_OWNER_PENDING),
  ) as [string, 'existing' | 'created' | 'pending'];
  const resultId = result[0];
  if (result[1] === 'pending') {
    return { ok: false, code: 'FEA_PENDING_LIMIT', message: `At most ${FEA_MAX_OWNER_PENDING} FEA jobs may be pending per user.` };
  }
  if (result[1] === 'created') return { ok: true, job, reused: false };

  const existing = await redisFeaLoadJob(resultId);
  if (!existing) return { ok: false, code: 'FEA_IDEMPOTENCY_EXPIRED', message: 'Idempotent job reference expired; retry with a new key.' };
  if (existing.ownerUserId !== submission.ownerUserId || existing.scopeId !== submission.scopeId) {
    return { ok: false, code: 'FEA_IDEMPOTENCY_SCOPE_CONFLICT', message: 'Idempotency scope conflict.' };
  }
  if (existing.requestHash !== requestHash) {
    return { ok: false, code: 'FEA_IDEMPOTENCY_PAYLOAD_CONFLICT', message: 'Idempotency key was already used with a different payload.' };
  }
  return { ok: true, job: existing, reused: true };
}

export async function redisFeaLoadJob(id: string): Promise<SerializedFeaJob | null> {
  if (!/^fea-[a-f0-9]{24}$/.test(id)) return null;
  const raw = await redisClient().get(feaJobKey(id));
  if (!raw) return null;
  try { return JSON.parse(raw) as SerializedFeaJob; } catch { return null; }
}

export async function getFeaJobForOwner(id: string, ownerUserId: string): Promise<SerializedFeaJob | null> {
  const job = await redisFeaLoadJob(id);
  return job?.ownerUserId === ownerUserId ? job : null;
}

export type CancelFeaResult = 'cancelled' | 'cancel_requested' | 'terminal' | 'not_found';

const CANCEL_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'not_found' end
local job = cjson.decode(raw)
if job.ownerUserId ~= ARGV[1] then return 'not_found' end
if job.status == 'complete' or job.status == 'failed' or job.status == 'cancelled' then return 'terminal' end
job.cancelRequested = true
job.updatedAt = tonumber(ARGV[2])
if job.status == 'queued' or job.status == 'retrying' then
  job.status = 'cancelled'
  job.completedAt = tonumber(ARGV[2])
  job.request = nil
  job.progress = {percent=job.progress.percent or 0, stage='cancelled', message='cancelled before execution'}
  redis.call('LREM', KEYS[2], 0, job.id)
  redis.call('SREM', KEYS[4], job.id)
  redis.call('SET', KEYS[1], cjson.encode(job), 'EX', ARGV[3])
  return 'cancelled'
end
job.status = 'cancel_requested'
redis.call('SET', KEYS[1], cjson.encode(job), 'EX', ARGV[3])
return 'cancel_requested'
`;

export async function cancelFeaJob(id: string, ownerUserId: string): Promise<CancelFeaResult> {
  if (!/^fea-[a-f0-9]{24}$/.test(id)) return 'not_found';
  return redisClient().eval(
    CANCEL_SCRIPT,
    4,
    feaJobKey(id), FEA_QUEUE_KEY, FEA_PROCESSING_KEY, feaOwnerPendingKey(ownerUserId),
    ownerUserId, String(Date.now()), String(FEA_JOB_TTL_SECONDS),
  ) as Promise<CancelFeaResult>;
}

export async function __disconnectFeaRedisForTests(): Promise<void> {
  if (!client) return;
  const closing = client;
  client = null;
  await closing.quit().catch(() => undefined);
}
