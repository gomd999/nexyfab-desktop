#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import IORedis from 'ioredis';

const QUEUE_KEY = 'nf:openscad:queue';
const PROCESSING_KEY = 'nf:openscad:processing';
const timeoutMs = Number(process.env.OPENSCAD_SMOKE_TIMEOUT_MS ?? 120_000);

if (!process.env.REDIS_URL?.trim()) {
  console.error('REDIS_URL is required');
  process.exit(2);
}

const redis = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  connectTimeout: 5_000,
});
const id = `commercial-smoke-${randomBytes(8).toString('hex')}`;
const key = `nf:openscad:job:${id}`;
const now = Date.now();
const job = {
  id,
  userId: 'commercial-smoke',
  status: 'queued',
  format: 'stl',
  createdAt: now,
  updatedAt: now,
  scad: 'cube([10,20,30], center=true);',
};

try {
  await redis.ping();
  await redis.set(key, JSON.stringify(job), 'EX', 300);
  await redis.rpush(QUEUE_KEY, id);
  const deadline = Date.now() + timeoutMs;
  let completed;
  while (Date.now() < deadline) {
    const raw = await redis.get(key);
    if (raw) {
      const current = JSON.parse(raw);
      if (current.status === 'failed') throw new Error(current.errorMessage || 'worker reported failure');
      if (current.status === 'complete') {
        completed = current;
        break;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!completed?.resultBase64) throw new Error('worker smoke timed out without an STL result');
  const result = Buffer.from(completed.resultBase64, 'base64');
  if (result.length < 80) throw new Error(`unexpectedly small STL result: ${result.length} bytes`);
  console.log(JSON.stringify({
    ok: true,
    jobId: id,
    status: completed.status,
    format: completed.format,
    outputBytes: result.length,
    sha256: createHash('sha256').update(result).digest('hex'),
  }, null, 2));
} finally {
  await redis.lrem(QUEUE_KEY, 0, id).catch(() => {});
  await redis.lrem(PROCESSING_KEY, 0, id).catch(() => {});
  await redis.del(key).catch(() => {});
  await redis.quit().catch(() => {});
}
