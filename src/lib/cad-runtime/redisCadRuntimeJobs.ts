import { randomBytes } from 'node:crypto';
import IORedis, { type Redis } from 'ioredis';
import type { RadianceExecutionPlan } from '@/lib/ai/radianceExecution';

const QUEUE_KEY = 'nf:cad-runtime:queue';
const JOB_PREFIX = 'nf:cad-runtime:job:';
const DEFAULT_TTL_SECONDS = 3600;

export type CadRuntimeRequest =
  | {
      kind: 'gmsh';
      stlBase64: string;
      geoText: string;
      timeoutMs: number;
      maxOutputBytes: number;
    }
  | {
      kind: 'tool-readiness';
      tool: 'gmsh' | 'radiance';
    }
  | {
      kind: 'radiance';
      plan: RadianceExecutionPlan;
      artifacts: Record<string, { encoding: 'utf8' | 'base64'; data: string }>;
      timeoutMs: number;
      maxOutputBytes: number;
    };

export type CadRuntimeResult =
  | { kind: 'gmsh'; exitCode: number; log: string; mshBase64?: string; error?: string }
  | { kind: 'tool-readiness'; tool: 'gmsh' | 'radiance'; ready: boolean; detail?: string; error?: string }
  | { kind: 'radiance'; status: 'pass' | 'fail' | 'not_run'; outputs: Record<string, string>; errors: string[] };

interface CadRuntimeJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  createdAt: number;
  updatedAt: number;
  request?: CadRuntimeRequest;
  result?: CadRuntimeResult;
  errorMessage?: string;
}

let client: Redis | null = null;

function redisClient(): Redis {
  const url = process.env.REDIS_URL?.trim();
  if (!url) throw new Error('CAD_RUNTIME_REDIS_URL_MISSING');
  if (!client) {
    client = new IORedis(url, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      connectTimeout: 5000,
    });
  }
  return client;
}

function jobKey(id: string): string {
  return `${JOB_PREFIX}${id}`;
}

export function isExternalCadRuntimeEnabled(): boolean {
  return process.env.CAD_RUNTIME_EXTERNAL_WORKER === '1';
}

/**
 * Submit a bounded, allow-listed native CAD operation to the isolated worker.
 * The web process never shells native CAD binaries when this boundary is on.
 */
export async function runCadRuntimeJob(
  request: CadRuntimeRequest,
  waitTimeoutMs = 150_000,
): Promise<CadRuntimeResult> {
  if (!isExternalCadRuntimeEnabled()) throw new Error('CAD_RUNTIME_EXTERNAL_WORKER_DISABLED');
  if (!Number.isFinite(waitTimeoutMs) || waitTimeoutMs < 1000 || waitTimeoutMs > 660_000) {
    throw new Error('CAD_RUNTIME_WAIT_LIMIT_INVALID');
  }

  const redis = redisClient();
  const id = `cadrt-${randomBytes(12).toString('hex')}`;
  const now = Date.now();
  const job: CadRuntimeJob = {
    id,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    request,
  };
  const ttl = Math.max(60, Number(process.env.CAD_RUNTIME_JOB_TTL_SECONDS ?? DEFAULT_TTL_SECONDS));
  await redis.set(jobKey(id), JSON.stringify(job), 'EX', ttl);
  await redis.rpush(QUEUE_KEY, id);

  const deadline = Date.now() + waitTimeoutMs;
  while (Date.now() < deadline) {
    const raw = await redis.get(jobKey(id));
    if (!raw) throw new Error('CAD_RUNTIME_JOB_EXPIRED');
    const current = JSON.parse(raw) as CadRuntimeJob;
    if (current.status === 'complete' && current.result) return current.result;
    if (current.status === 'failed') throw new Error(current.errorMessage || 'CAD_RUNTIME_JOB_FAILED');
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  throw new Error(`CAD_RUNTIME_JOB_TIMEOUT:${waitTimeoutMs}`);
}

export async function __disconnectCadRuntimeRedisForTests(): Promise<void> {
  if (client) {
    const closing = client;
    client = null;
    await closing.quit().catch(() => undefined);
  }
}
