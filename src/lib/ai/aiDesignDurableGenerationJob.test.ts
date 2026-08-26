import { describe, expect, it } from 'vitest';
import { DurableStoreError } from './aiDesignDurableJobPrimitives';
import { InMemoryDurableGenerationJobStoreV1 } from './aiDesignDurableGenerationJob';

const base = { projectId: 'p1', sessionId: 's1' };
describe('DurableGenerationJobV1 reference contract', () => {
  it('is idempotent by project-session key and payload digest', () => {
    const store = new InMemoryDurableGenerationJobStoreV1({ mode: 'reference' }); const first = store.enqueue({ ...base, jobId: 'j1', idempotencyKey: 'request-1', payload: { input: 'a' } }); const replay = store.enqueue({ ...base, jobId: 'j2', idempotencyKey: 'request-1', payload: { input: 'a' } }); expect(replay).toEqual(first); expect(() => store.enqueue({ ...base, jobId: 'j3', idempotencyKey: 'request-1', payload: { input: 'b' } })).toThrowError(DurableStoreError);
  });
  it('enforces CAS, lease ownership, heartbeat and terminal state', () => {
    const store = new InMemoryDurableGenerationJobStoreV1({ mode: 'reference' }); store.enqueue({ ...base, jobId: 'j1', idempotencyKey: 'r1', payload: {}, now: '2026-08-24T00:00:00.000Z' }); const claimed = store.claim({ ...base, jobId: 'j1', owner: 'worker-a', leaseMs: 10_000, expectedRevision: 0, now: '2026-08-24T00:00:00.000Z' }); expect(claimed.status).toBe('RUNNING'); expect(() => store.heartbeat({ ...base, jobId: 'j1', owner: 'worker-b', leaseMs: 10_000, expectedRevision: 1, now: '2026-08-24T00:00:01.000Z' })).toThrowError(DurableStoreError); expect(() => store.succeed({ ...base, jobId: 'j1', owner: 'worker-a', expectedRevision: 0 })).toThrowError(/revision/); const done = store.succeed({ ...base, jobId: 'j1', owner: 'worker-a', expectedRevision: 1, now: '2026-08-24T00:00:02.000Z' }); expect(done.status).toBe('SUCCEEDED'); expect(() => store.requestCancel({ ...base, jobId: 'j1', expectedRevision: 2 })).toThrowError(DurableStoreError);
  });
  it('backs off retryable failures and cancels without reopening terminal work', () => {
    const store = new InMemoryDurableGenerationJobStoreV1({ mode: 'reference' }); store.enqueue({ ...base, jobId: 'j1', idempotencyKey: 'r1', payload: {}, now: '2026-08-24T00:00:00.000Z' }); const claimed = store.claim({ ...base, jobId: 'j1', owner: 'w', leaseMs: 2000, expectedRevision: 0, now: '2026-08-24T00:00:00.000Z' }); const failed = store.fail({ ...base, jobId: 'j1', owner: 'w', expectedRevision: claimed.revision, errorCode: 'TRANSIENT', retryable: true, now: '2026-08-24T00:00:01.000Z' }); expect(failed.status).toBe('QUEUED'); expect(failed.availableAt).toBe('2026-08-24T00:00:02.000Z'); const cancelled = store.requestCancel({ ...base, jobId: 'j1', expectedRevision: failed.revision, now: '2026-08-24T00:00:03.000Z' }); expect(cancelled.status).toBe('CANCELLED');
  });
  it('fails closed in commercial mode', () => { const store = new InMemoryDurableGenerationJobStoreV1({ mode: 'commercial' }); expect(() => store.enqueue({ ...base, jobId: 'j1', idempotencyKey: 'r1', payload: {} })).toThrowError(/commercial/); });
});
