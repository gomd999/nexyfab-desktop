import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeaHealthServer, resolveFeaWorkerRuntimeConfig } from './server';

async function withServer(
  redis: { ping(): Promise<string>; llen(key: string): Promise<number> },
  env: Record<string, string | undefined>,
  callback: (origin: string) => Promise<void>,
): Promise<void> {
  const server = createFeaHealthServer(redis, env);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_INVALID');
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

afterEach(() => vi.restoreAllMocks());

describe('FEA worker runtime configuration', () => {
  it('accepts bounded integer values and rejects NaN, fractions, and out-of-range values', () => {
    expect(resolveFeaWorkerRuntimeConfig({
      PORT: '8081',
      FEA_WORKER_CONCURRENCY: '2',
      FEA_WORKER_LEASE_MS: '30000',
    })).toEqual({ port: 8081, concurrency: 2, leaseMs: 30_000 });
    expect(() => resolveFeaWorkerRuntimeConfig({ FEA_WORKER_CONCURRENCY: 'NaN' })).toThrow('FEA_WORKER_CONCURRENCY_INVALID');
    expect(() => resolveFeaWorkerRuntimeConfig({ FEA_WORKER_CONCURRENCY: '1.5' })).toThrow('FEA_WORKER_CONCURRENCY_INVALID');
    expect(() => resolveFeaWorkerRuntimeConfig({ PORT: '70000' })).toThrow('PORT_INVALID');
  });
});

describe('FEA worker health contract', () => {
  it('keeps liveness independent from Redis and fails readiness closed without a build ID', async () => {
    const redis = {
      ping: vi.fn(async () => { throw new Error('redis down'); }),
      llen: vi.fn(async () => 0),
    };
    await withServer(redis, {}, async origin => {
      const live = await fetch(`${origin}/api/health/live`);
      expect(live.status).toBe(200);
      await expect(live.json()).resolves.toMatchObject({ ok: true, phase: 'live', buildId: 'unknown' });
      expect(redis.ping).not.toHaveBeenCalled();

      const ready = await fetch(`${origin}/api/health/ready`);
      expect(ready.status).toBe(503);
      await expect(ready.json()).resolves.toMatchObject({
        ok: false,
        phase: 'ready',
        buildId: 'unknown',
        blockers: ['redis_unavailable', 'build_id_missing'],
      });
    });
  });

  it('reports ready only when Redis and the immutable build identity are present', async () => {
    const redis = { ping: vi.fn(async () => 'PONG'), llen: vi.fn(async () => 0) };
    await withServer(redis, { NEXYFAB_WORKER_BUILD_ID: 'fea-build-test' }, async origin => {
      const ready = await fetch(`${origin}/api/health/ready`);
      expect(ready.status).toBe(200);
      await expect(ready.json()).resolves.toMatchObject({
        ok: true,
        phase: 'ready',
        buildId: 'fea-build-test',
        blockers: [],
      });
    });
  });
});
