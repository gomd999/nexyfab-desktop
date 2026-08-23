import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ ensure: vi.fn(), claim: vi.fn(), heartbeat: vi.fn(), complete: vi.fn(), failDetailed: vi.fn() }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ marker: 'db' }) }));
vi.mock('@/lib/cad/spatialCadJobStore', () => ({
  ensureSpatialCadJobTables: mocks.ensure,
  claimNextExactClashJob: mocks.claim,
  heartbeatExactClashJob: mocks.heartbeat,
  completeExactClashJob: mocks.complete,
  failExactClashJobDetailed: mocks.failDetailed,
}));

import { POST } from './route';

const secret = 's'.repeat(32);
const workerIdentity = 'a'.repeat(64);
const kernelIdentity = 'b'.repeat(64);
function req(body: unknown, supplied = secret) {
  return new NextRequest('https://nexyfab.com/api/internal/spatial-cad/jobs', { method: 'POST', headers: { 'x-spatial-cad-worker-secret': supplied }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('NEXYFAB_SPATIAL_CAD_WORKER_SECRET', secret);
  vi.stubEnv('NEXYFAB_SPATIAL_CAD_WORKER_IDENTITIES', JSON.stringify({ 'worker-1': workerIdentity }));
  vi.stubEnv('NEXYFAB_SPATIAL_CAD_KERNEL_IDENTITIES', kernelIdentity);
  mocks.claim.mockResolvedValue(null); mocks.heartbeat.mockResolvedValue(true); mocks.complete.mockResolvedValue({ ok: true, job: { id: 'SCJ-1' } }); mocks.failDetailed.mockResolvedValue({ ok: true, code: 'RETRY_SCHEDULED', outcome: 'RETRY_SCHEDULED', errorCode: 'ARTIFACT_LOAD_FAILED', nextAttemptAt: 30000, attempts: 1, attemptsRemaining: 4 });
});
afterEach(() => vi.unstubAllEnvs());

describe('internal exact clash worker API', () => {
  it('measures actual bytes despite a false Content-Length and cancels overflow before storage', async () => {
    let cancelled = false;
    const init = {
      method: 'POST',
      headers: { 'x-spatial-cad-worker-secret': secret, 'content-length': '1', 'transfer-encoding': 'chunked' },
      body: new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array([0x7b])); controller.enqueue(new Uint8Array(512 * 1024)); },
        cancel() { cancelled = true; },
      }),
      duplex: 'half',
    } as unknown as ConstructorParameters<typeof NextRequest>[1];
    const response = await POST(new NextRequest('https://nexyfab.com/api/internal/spatial-cad/jobs', init));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'BODY_TOO_LARGE' });
    expect(cancelled).toBe(true);
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it('rejects invalid UTF-8 as INVALID_JSON before storage', async () => {
    const response = await POST(new NextRequest('https://nexyfab.com/api/internal/spatial-cad/jobs', { method: 'POST', headers: { 'x-spatial-cad-worker-secret': secret }, body: new Uint8Array([0xff]) }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'INVALID_JSON' });
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it('fails closed while the dedicated worker secret is absent', async () => { vi.stubEnv('NEXYFAB_SPATIAL_CAD_WORKER_SECRET', ''); expect((await POST(req({ action: 'claim', workerId: 'worker-1' }))).status).toBe(503); expect(mocks.ensure).not.toHaveBeenCalled(); });
  it('rejects a wrong secret before touching storage', async () => { expect((await POST(req({ action: 'claim', workerId: 'worker-1' }, 'wrong'))).status).toBe(403); expect(mocks.ensure).not.toHaveBeenCalled(); });
  it('fails closed when the worker identity registry is absent', async () => { vi.stubEnv('NEXYFAB_SPATIAL_CAD_WORKER_IDENTITIES', ''); expect((await POST(req({ action: 'claim', workerId: 'worker-1' }))).status).toBe(503); expect(mocks.ensure).not.toHaveBeenCalled(); });
  it('rejects an unregistered worker even with the shared worker secret', async () => { expect((await POST(req({ action: 'claim', workerId: 'worker-2' }))).status).toBe(403); expect(mocks.ensure).not.toHaveBeenCalled(); });
  it('claims through a lease without inventing completed execution', async () => { mocks.claim.mockResolvedValue({ job: { id: 'SCJ-1', status: 'RUNNING', execution: 'RUNNING', releaseVerification: 'NOT_RUN' }, leaseToken: 'lease-1' }); const response = await POST(req({ action: 'claim', workerId: 'worker-1' })); expect(response.status).toBe(200); await expect(response.json()).resolves.toMatchObject({ claim: { job: { execution: 'RUNNING', releaseVerification: 'NOT_RUN' } } }); });
  it('rejects a completion whose receipt belongs to another job', async () => { const response = await POST(req({ action: 'complete', workerId: 'worker-1', jobId: 'SCJ-1', leaseToken: 'lease-1', receipt: { jobId: 'SCJ-2' } })); expect(response.status).toBe(400); expect(mocks.complete).not.toHaveBeenCalled(); });
  it('rejects unregistered worker and kernel receipt identities before completion', async () => {
    const base = { jobId: 'SCJ-1', workerIdentitySha256: 'f'.repeat(64), kernelIdentitySha256: kernelIdentity };
    expect((await POST(req({ action: 'complete', workerId: 'worker-1', jobId: 'SCJ-1', leaseToken: 'lease-1', receipt: base }))).status).toBe(403);
    expect((await POST(req({ action: 'complete', workerId: 'worker-1', jobId: 'SCJ-1', leaseToken: 'lease-1', receipt: { ...base, workerIdentitySha256: workerIdentity, kernelIdentitySha256: 'e'.repeat(64) } }))).status).toBe(403);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('forwards a receipt only when worker and kernel identities are registered', async () => {
    const response = await POST(req({ action: 'complete', workerId: 'worker-1', jobId: 'SCJ-1', leaseToken: 'lease-1', receipt: { jobId: 'SCJ-1', workerIdentitySha256: workerIdentity, kernelIdentitySha256: kernelIdentity } }));
    expect(response.status).toBe(200);
    expect(mocks.complete).toHaveBeenCalledWith(expect.anything(), 'worker-1', 'lease-1', expect.objectContaining({ jobId: 'SCJ-1' }));
  });
  it('returns retry scheduling details through the active lease', async () => {
    expect((await POST(req({ action: 'heartbeat', workerId: 'worker-1', jobId: 'SCJ-1', leaseToken: 'lease-1' }))).status).toBe(200);
    const response = await POST(req({ action: 'fail', workerId: 'worker-1', jobId: 'SCJ-1', leaseToken: 'lease-1', errorCode: 'ARTIFACT_LOAD_FAILED' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, code: 'RETRY_SCHEDULED', nextAttemptAt: 30000, attemptsRemaining: 4 });
  });

  it('preserves terminal-failure and lease-rejection outcomes', async () => {
    mocks.failDetailed.mockResolvedValueOnce({ ok: true, code: 'TERMINAL_FAILURE', outcome: 'TERMINAL_FAILURE', errorCode: 'INVALID_INPUT', attempts: 5, attemptsRemaining: 0 });
    const terminal = await POST(req({ action: 'fail', workerId: 'worker-1', jobId: 'SCJ-1', leaseToken: 'lease-1', errorCode: 'INVALID_INPUT' }));
    expect(terminal.status).toBe(200);
    await expect(terminal.json()).resolves.toMatchObject({ ok: true, code: 'TERMINAL_FAILURE', attemptsRemaining: 0 });
    mocks.failDetailed.mockResolvedValueOnce({ ok: false, code: 'LEASE_REJECTED', outcome: 'LEASE_REJECTED', issues: ['exact_clash_lease_invalid_or_expired'] });
    const rejected = await POST(req({ action: 'fail', workerId: 'worker-1', jobId: 'SCJ-1', leaseToken: 'stale', errorCode: 'ARTIFACT_LOAD_FAILED' }));
    expect(rejected.status).toBe(409);
    await expect(rejected.json()).resolves.toMatchObject({ ok: false, code: 'LEASE_REJECTED' });
  });
});
