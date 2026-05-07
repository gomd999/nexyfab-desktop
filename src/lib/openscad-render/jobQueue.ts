import { randomBytes } from 'node:crypto';
import type { OpenScadMeshFormat } from './runOpenScadCli';
import { runOpenScadCli } from './runOpenScadCli';
import { OPENSCAD_JOB_MAX_OUTPUT_BYTES, OPENSCAD_JOB_TTL_MS } from './constants';
import { maybeUploadOpenScadArtifact } from './artifactUpload';
import {
  __disconnectOpenscadRedisForTests,
  isOpenscadRedisJobsEnabled,
  redisOpenscadLoadJob,
  redisOpenscadQueueLength,
  redisOpenscadQueuePop,
  redisOpenscadQueuePush,
  redisOpenscadSaveJob,
  type SerializedOpenScadJob,
} from './redisOpenscadJobs';

export type OpenScadJobStatus = 'queued' | 'processing' | 'complete' | 'failed';

export interface OpenScadJobRecord {
  id: string;
  userId: string;
  status: OpenScadJobStatus;
  format: OpenScadMeshFormat;
  createdAt: number;
  updatedAt: number;
  /** Base64 STL/OFF when complete and under transport cap */
  resultBase64?: string;
  errorMessage?: string;
  artifactKey?: string;
  artifactUrl?: string;
}

interface PendingPayload {
  scad: string;
  format: OpenScadMeshFormat;
}

const jobs = new Map<string, OpenScadJobRecord>();
const payloads = new Map<string, PendingPayload>();
const queue: string[] = [];
let workerRunning = false;

function redisQueueEnabled(): boolean {
  return isOpenscadRedisJobsEnabled();
}

function toSerialized(job: OpenScadJobRecord, scad?: string): SerializedOpenScadJob {
  return {
    id: job.id,
    userId: job.userId,
    status: job.status,
    format: job.format,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(scad !== undefined ? { scad } : {}),
    resultBase64: job.resultBase64,
    artifactKey: job.artifactKey,
    artifactUrl: job.artifactUrl,
    errorMessage: job.errorMessage,
  };
}

function fromSerialized(s: SerializedOpenScadJob): OpenScadJobRecord {
  return {
    id: s.id,
    userId: s.userId,
    status: s.status,
    format: s.format,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    resultBase64: s.resultBase64,
    errorMessage: s.errorMessage,
    artifactKey: s.artifactKey,
    artifactUrl: s.artifactUrl,
  };
}

function pruneJobs(): void {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.updatedAt > OPENSCAD_JOB_TTL_MS) {
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
    const fromRedis = await redisOpenscadQueuePop();
    if (fromRedis) return fromRedis;
  }
  return queue.shift() ?? null;
}

async function resolveJobAndPayload(
  id: string,
): Promise<{ job: OpenScadJobRecord; payload: PendingPayload } | null> {
  const job = jobs.get(id);
  const payload = payloads.get(id);
  if (job && payload) return { job, payload };

  if (!redisQueueEnabled()) return null;

  const ser = await redisOpenscadLoadJob(id);
  if (!ser?.scad) return null;
  const j = fromSerialized(ser);
  const pl: PendingPayload = { scad: ser.scad, format: ser.format };
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
      await redisOpenscadSaveJob(toSerialized(job, payload.scad));

      const r = await runOpenScadCli({
        scadSource: payload.scad,
        format: payload.format,
      });

      payloads.delete(id);

      if (r.ok) {
        const up = await maybeUploadOpenScadArtifact({
          buffer: r.buffer,
          userId: job.userId,
          jobId: job.id,
          format: payload.format,
        });
        if (up.artifactUrl) {
          job.artifactKey = up.artifactKey;
          job.artifactUrl = up.artifactUrl;
        }
        if (r.buffer.length > OPENSCAD_JOB_MAX_OUTPUT_BYTES && !job.artifactUrl) {
          job.status = 'failed';
          job.errorMessage = `Output too large (${r.buffer.length} bytes). Configure object storage (S3_BUCKET) or raise OPENSCAD_JOB_MAX_OUTPUT_BYTES.`;
          job.resultBase64 = undefined;
        } else {
          job.status = 'complete';
          if (!job.artifactUrl || r.buffer.length <= OPENSCAD_JOB_MAX_OUTPUT_BYTES) {
            job.resultBase64 = r.buffer.toString('base64');
          } else {
            job.resultBase64 = undefined;
          }
        }
      } else {
        job.status = 'failed';
        job.errorMessage = r.stderr ? `${r.message}\n${r.stderr}` : r.message;
      }
      job.updatedAt = Date.now();
      jobs.set(id, job);
      await redisOpenscadSaveJob(toSerialized(job));
    }
  } finally {
    workerRunning = false;
  }

  const pending = redisQueueEnabled() ? await redisOpenscadQueueLength() : queue.length;
  if (pending > 0) void runWorkerLoop();
}

function kickWorker(): void {
  void runWorkerLoop();
}

export async function enqueueOpenScadJob(input: {
  userId: string;
  scad: string;
  format: OpenScadMeshFormat;
}): Promise<OpenScadJobRecord> {
  pruneJobs();
  const id = `oscad-${randomBytes(12).toString('hex')}`;
  const now = Date.now();
  const job: OpenScadJobRecord = {
    id,
    userId: input.userId,
    status: 'queued',
    format: input.format,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);
  payloads.set(id, { scad: input.scad, format: input.format });

  if (redisQueueEnabled()) {
    const saved = await redisOpenscadSaveJob(toSerialized(job, input.scad));
    if (saved) {
      await redisOpenscadQueuePush(id);
    } else {
      queue.push(id);
    }
  } else {
    queue.push(id);
  }
  kickWorker();
  return job;
}

export async function getOpenScadJobAsync(id: string, userId: string): Promise<OpenScadJobRecord | null> {
  if (redisQueueEnabled()) {
    const ser = await redisOpenscadLoadJob(id);
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

/** @deprecated Prefer getOpenScadJobAsync; kept for tests on single-instance memory path */
export function getOpenScadJob(id: string, userId: string): OpenScadJobRecord | null {
  const j = jobs.get(id);
  if (!j || j.userId !== userId) return null;
  return j;
}

/** Test hook: reset all state */
export function __resetOpenScadJobQueueForTests(): void {
  jobs.clear();
  payloads.clear();
  queue.length = 0;
  workerRunning = false;
  __disconnectOpenscadRedisForTests();
}
