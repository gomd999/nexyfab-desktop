import { describe, expect, it } from 'vitest';
import { CadJobLedger } from './ledger';

const hash = (char: string) => char.repeat(64);

function memoryLedger() {
  const values = new Map<string, unknown>();
  return new CadJobLedger({
    storage: {
      async get<T>(key: string) { return values.get(key) as T | undefined; },
      async put<T>(key: string, value: T) { values.set(key, structuredClone(value)); },
    },
  });
}

function post(ledger: CadJobLedger, path: string, body: Record<string, unknown>) {
  return ledger.fetch(new Request(`https://ledger${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

describe('Durable Object CAD job idempotency ledger', () => {
  it('serializes enqueue reservations and suppresses a concurrent duplicate', async () => {
    const ledger = memoryLedger();
    const body = { jobId: 'job-1', messageSha256: hash('a'), now: 1_000 };
    const first = await post(ledger, '/register', { ...body, deliveryId: 'delivery-1' });
    expect(await first.json()).toMatchObject({ needsEnqueue: true, status: 'ENQUEUEING' });
    const duplicate = await post(ledger, '/register', { ...body, deliveryId: 'delivery-2', now: 2_000 });
    expect(await duplicate.json()).toMatchObject({ needsEnqueue: false, status: 'ENQUEUEING' });
  });

  it('releases a failed reservation and permanently deduplicates a persisted queue write', async () => {
    const ledger = memoryLedger();
    const identity = { jobId: 'job-1', messageSha256: hash('a') };
    await post(ledger, '/register', { ...identity, deliveryId: 'delivery-1', now: 1_000 });
    expect((await post(ledger, '/release', { ...identity, deliveryId: 'delivery-1', now: 2_000 })).status).toBe(200);
    expect(await (await post(ledger, '/register', { ...identity, deliveryId: 'delivery-2', now: 3_000 })).json()).toMatchObject({ needsEnqueue: true });
    expect((await post(ledger, '/mark-enqueued', { ...identity, deliveryId: 'delivery-2', now: 4_000 })).status).toBe(200);
    expect(await (await post(ledger, '/register', { ...identity, deliveryId: 'delivery-3', now: 5_000 })).json()).toMatchObject({ needsEnqueue: false, status: 'QUEUE_PERSISTED' });
  });

  it('rejects reuse of one job id for different payload bytes', async () => {
    const ledger = memoryLedger();
    await post(ledger, '/register', { jobId: 'job-1', messageSha256: hash('a'), deliveryId: 'delivery-1', now: 1_000 });
    const conflict = await post(ledger, '/register', { jobId: 'job-1', messageSha256: hash('b'), deliveryId: 'delivery-2', now: 2_000 });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ code: 'JOB_ID_PAYLOAD_CONFLICT' });
  });
});
