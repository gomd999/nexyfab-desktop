import { isBrepRedisJobsEnabled, redisBrepQueueLength } from './redisBrepJobs';

export function brepMaxQueueDepth(): number {
  const n = Number(process.env.BREP_MAX_QUEUE_DEPTH);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 200;
}

/** Combined Redis + in-memory fallback queue depth (approximate under hybrid enqueue). */
export async function getBrepPendingQueueDepth(memoryQueueLength: number): Promise<number> {
  if (isBrepRedisJobsEnabled()) {
    const redisLen = await redisBrepQueueLength();
    return redisLen + memoryQueueLength;
  }
  return memoryQueueLength;
}
