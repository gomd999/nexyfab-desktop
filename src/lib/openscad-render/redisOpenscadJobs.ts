import type { Redis } from 'ioredis';
import IORedis from 'ioredis';
import { OPENSCAD_JOB_TTL_MS } from './constants';
import type { OpenScadMeshFormat } from './runOpenScadCli';

const QUEUE_KEY = 'nf:openscad:queue';

export type PersistedOpenScadJobStatus = 'queued' | 'processing' | 'complete' | 'failed';

function jobRedisKey(id: string): string {
  return `nf:openscad:job:${id}`;
}

let client: Redis | null = null;

export function isOpenscadRedisJobsEnabled(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

function getClient(): Redis | null {
  if (!isOpenscadRedisJobsEnabled()) return null;
  if (client) return client;
  try {
    client = new IORedis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      connectTimeout: 5000,
    });
    return client;
  } catch {
    return null;
  }
}

/** Persisted job shape (Redis JSON). */
export interface SerializedOpenScadJob {
  id: string;
  userId: string;
  status: PersistedOpenScadJobStatus;
  format: OpenScadMeshFormat;
  createdAt: number;
  updatedAt: number;
  /** Present while queued/processing; stripped after completion. */
  scad?: string;
  resultBase64?: string;
  artifactKey?: string;
  artifactUrl?: string;
  errorMessage?: string;
}

export async function redisOpenscadSaveJob(rec: SerializedOpenScadJob): Promise<boolean> {
  const r = getClient();
  if (!r) return false;
  const ttlSec = Math.max(60, Math.ceil(OPENSCAD_JOB_TTL_MS / 1000));
  try {
    await r.set(jobRedisKey(rec.id), JSON.stringify(rec), 'EX', ttlSec);
    return true;
  } catch (e) {
    console.warn('[openscad-redis] save job failed', e);
    return false;
  }
}

export async function redisOpenscadLoadJob(id: string): Promise<SerializedOpenScadJob | null> {
  const r = getClient();
  if (!r) return null;
  try {
    const raw = await r.get(jobRedisKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as SerializedOpenScadJob;
  } catch {
    return null;
  }
}

export async function redisOpenscadQueuePush(id: string): Promise<boolean> {
  const r = getClient();
  if (!r) return false;
  try {
    await r.rpush(QUEUE_KEY, id);
    return true;
  } catch (e) {
    console.warn('[openscad-redis] queue push failed', e);
    return false;
  }
}

export async function redisOpenscadQueuePop(): Promise<string | null> {
  const r = getClient();
  if (!r) return null;
  try {
    return await r.lpop(QUEUE_KEY);
  } catch {
    return null;
  }
}

export async function redisOpenscadQueueLength(): Promise<number> {
  const r = getClient();
  if (!r) return 0;
  try {
    return await r.llen(QUEUE_KEY);
  } catch {
    return 0;
  }
}

/** Test / teardown: clear client reference (does not flush Redis). */
export function __disconnectOpenscadRedisForTests(): void {
  if (client) {
    void client.quit().catch(() => {});
    client = null;
  }
}
