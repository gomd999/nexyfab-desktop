import { randomBytes } from 'node:crypto';
import { BREP_JOB_TTL_MS, BREP_STEP_MAX_BYTES } from './constants';
import type { BrepStepJobStatus } from './contracts';
import { maybeUploadBrepPreviewStl, runBrepStepProcess } from './processBrepStep';
import {
  __disconnectBrepRedisForTests,
  isBrepRedisJobsEnabled,
  redisBrepLoadJob,
  redisBrepQueueLength,
  redisBrepQueuePop,
  redisBrepQueuePush,
  redisBrepSaveJob,
  type SerializedBrepJob,
} from './redisBrepJobs';

export interface BrepStepJobRecord {
  id: string;
  userId: string;
  status: BrepStepJobStatus;
  filename: string;
  createdAt: number;
  updatedAt: number;
  previewMeshBase64?: string;
  artifactUrl?: string;
  artifactKey?: string;
  brepSessionToken?: string;
  errorMessage?: string;
}

interface PendingPayload {
  buffer: Buffer;
  filename: string;
}

const jobs = new Map<string, BrepStepJobRecord>();
const payloads = new Map<string, PendingPayload>();
const queue: string[] = [];
let workerRunning = false;

/** In-memory fallback queue length (paired with Redis queue when hybrid). */
export function getBrepMemoryQueueLength(): number {
  return queue.length;
}

function redisQueueEnabled(): boolean {
  return isBrepRedisJobsEnabled();
}

function toSerialized(job: BrepStepJobRecord, stepBase64?: string): SerializedBrepJob {
  return {
    id: job.id,
    userId: job.userId,
    status: job.status,
    filename: job.filename,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(stepBase64 !== undefined ? { stepBase64 } : {}),
    previewMeshBase64: job.previewMeshBase64,
    artifactKey: job.artifactKey,
    artifactUrl: job.artifactUrl,
    brepSessionToken: job.brepSessionToken,
    errorMessage: job.errorMessage,
  };
}

function fromSerialized(s: SerializedBrepJob): BrepStepJobRecord {
  return {
    id: s.id,
    userId: s.userId,
    status: s.status,
    filename: s.filename,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    previewMeshBase64: s.previewMeshBase64,
    errorMessage: s.errorMessage,
    artifactKey: s.artifactKey,
    artifactUrl: s.artifactUrl,
    brepSessionToken: s.brepSessionToken,
  };
}

function pruneJobs(): void {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.updatedAt > BREP_JOB_TTL_MS) {
      jobs.delete(id);
      payloads.delete(id);
    }
  }
}

if (typeof setInterval !== 'undefined') {
  setInterval(pruneJobs, 5 * 60_000).unref?.();
}

async function dequeueId(): Promise<string | null> {
  if (redisQueueEnabled()) {
    const fromRedis = await redisBrepQueuePop();
    if (fromRedis) return fromRedis;
  }
  return queue.shift() ?? null;
}

async function resolveJobAndPayload(
  id: string,
): Promise<{ job: BrepStepJobRecord; payload: PendingPayload } | null> {
  const job = jobs.get(id);
  const payload = payloads.get(id);
  if (job && payload) return { job, payload };

  if (!redisQueueEnabled()) return null;

  const ser = await redisBrepLoadJob(id);
  if (!ser?.stepBase64) return null;
  const j = fromSerialized(ser);
  const pl: PendingPayload = {
    buffer: Buffer.from(ser.stepBase64, 'base64'),
    filename: ser.filename,
  };
  jobs.set(id, j);
  payloads.set(id, pl);
  return { job: j, payload: pl };
}

async function runWorkerLoop(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    for (;;) {
      const id = await dequeueId();
      if (!id) break;

      const pair = await resolveJobAndPayload(id);
      if (!pair) continue;
      const { job, payload } = pair;

      job.status = 'processing';
      job.updatedAt = Date.now();
      await redisBrepSaveJob(toSerialized(job, payload.buffer.toString('base64')));

      if (payload.buffer.length > BREP_STEP_MAX_BYTES) {
        payloads.delete(id);
        job.status = 'failed';
        job.errorMessage = `File exceeds ${BREP_STEP_MAX_BYTES} bytes`;
        job.updatedAt = Date.now();
        jobs.set(id, job);
        await redisBrepSaveJob(toSerialized(job));
        continue;
      }

      const r = await runBrepStepProcess({
        userId: job.userId,
        jobId: job.id,
        filename: payload.filename,
        buffer: payload.buffer,
      });
      payloads.delete(id);

      if (r.previewMeshBase64 || r.artifactUrl) {
        job.status = 'complete';
        if (r.previewMeshBase64) {
          job.previewMeshBase64 = r.previewMeshBase64;
          const up = await maybeUploadBrepPreviewStl({
            userId: job.userId,
            jobId: job.id,
            previewMeshBase64: r.previewMeshBase64,
          });
          if (up.artifactUrl) {
            job.artifactUrl = up.artifactUrl;
            job.artifactKey = up.artifactKey;
          }
        }
        if (r.artifactUrl) job.artifactUrl = r.artifactUrl;
        if (r.brepSessionToken) job.brepSessionToken = r.brepSessionToken;
        if (r.errorMessage) job.errorMessage = r.errorMessage;
      } else {
        job.status = 'failed';
        job.errorMessage = r.errorMessage ?? 'Unknown processing error';
      }
      job.updatedAt = Date.now();
      jobs.set(id, job);
      await redisBrepSaveJob(toSerialized(job));
    }
  } finally {
    workerRunning = false;
  }

  const pending = redisQueueEnabled() ? await redisBrepQueueLength() : queue.length;
  if (pending > 0) void runWorkerLoop();
}

function kickWorker(): void {
  void runWorkerLoop();
}

export async function enqueueBrepStepJob(input: {
  userId: string;
  buffer: Buffer;
  filename: string;
}): Promise<BrepStepJobRecord> {
  pruneJobs();
  const id = `brep-${randomBytes(12).toString('hex')}`;
  const now = Date.now();
  const job: BrepStepJobRecord = {
    id,
    userId: input.userId,
    status: 'queued',
    filename: input.filename,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);
  payloads.set(id, { buffer: input.buffer, filename: input.filename });

  const stepB64 = input.buffer.toString('base64');
  if (redisQueueEnabled()) {
    const saved = await redisBrepSaveJob(toSerialized(job, stepB64));
    if (saved) {
      await redisBrepQueuePush(id);
    } else {
      queue.push(id);
    }
  } else {
    queue.push(id);
  }
  kickWorker();
  return job;
}

export async function getBrepStepJobAsync(id: string, userId: string): Promise<BrepStepJobRecord | null> {
  if (redisQueueEnabled()) {
    const ser = await redisBrepLoadJob(id);
    if (ser) {
      if (ser.userId !== userId) return null;
      const rec = fromSerialized(ser);
      jobs.set(id, rec);
      return rec;
    }
  }
  const j = jobs.get(id);
  if (!j || j.userId !== userId) return null;
  return j;
}

/** Same-instance memory lookup (tests). */
export function getBrepStepJob(id: string, userId: string): BrepStepJobRecord | null {
  const j = jobs.get(id);
  if (!j || j.userId !== userId) return null;
  return j;
}

export function __resetBrepJobQueueForTests(): void {
  jobs.clear();
  payloads.clear();
  queue.length = 0;
  workerRunning = false;
  __disconnectBrepRedisForTests();
}
