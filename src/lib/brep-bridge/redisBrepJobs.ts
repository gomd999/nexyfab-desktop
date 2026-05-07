import type { Redis } from 'ioredis';
import IORedis from 'ioredis';
import { BREP_JOB_TTL_MS } from './constants';
import type { BrepStepJobStatus } from './contracts';

const QUEUE_KEY = 'nf:brep:queue';

function jobRedisKey(id: string): string {
  return `nf:brep:job:${id}`;
}

let client: Redis | null = null;

export function isBrepRedisJobsEnabled(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

function getClient(): Redis | null {
  if (!isBrepRedisJobsEnabled()) return null;
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

export interface SerializedBrepJob {
  id: string;
  userId: string;
  status: BrepStepJobStatus;
  filename: string;
  createdAt: number;
  updatedAt: number;
  /** Present while queued/processing; stripped after completion when possible. */
  stepBase64?: string;
  previewMeshBase64?: string;
  artifactKey?: string;
  artifactUrl?: string;
  brepSessionToken?: string;
  errorMessage?: string;
}

export async function redisBrepSaveJob(rec: SerializedBrepJob): Promise<boolean> {
  const r = getClient();
  if (!r) return false;
  const ttlSec = Math.max(60, Math.ceil(BREP_JOB_TTL_MS / 1000));
  try {
    await r.set(jobRedisKey(rec.id), JSON.stringify(rec), 'EX', ttlSec);
    return true;
  } catch (e) {
    console.warn('[brep-redis] save job failed', e);
    return false;
  }
}

export async function redisBrepLoadJob(id: string): Promise<SerializedBrepJob | null> {
  const r = getClient();
  if (!r) return null;
  try {
    const raw = await r.get(jobRedisKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as SerializedBrepJob;
  } catch {
    return null;
  }
}

export async function redisBrepQueuePush(id: string): Promise<boolean> {
  const r = getClient();
  if (!r) return false;
  try {
    await r.rpush(QUEUE_KEY, id);
    return true;
  } catch (e) {
    console.warn('[brep-redis] queue push failed', e);
    return false;
  }
}

export async function redisBrepQueuePop(): Promise<string | null> {
  const r = getClient();
  if (!r) return null;
  try {
    return await r.lpop(QUEUE_KEY);
  } catch {
    return null;
  }
}

export async function redisBrepQueueLength(): Promise<number> {
  const r = getClient();
  if (!r) return 0;
  try {
    return await r.llen(QUEUE_KEY);
  } catch {
    return 0;
  }
}

export function __disconnectBrepRedisForTests(): void {
  if (client) {
    void client.quit().catch(() => {});
    client = null;
  }
}
