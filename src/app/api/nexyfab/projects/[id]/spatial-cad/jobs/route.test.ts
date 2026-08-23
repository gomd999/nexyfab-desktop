import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), ensure: vi.fn(), list: vi.fn(), usage: vi.fn(), enqueue: vi.fn(), cancel: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: () => true }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ marker: 'db' }) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.access }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.audit }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIpOrUndefined: () => '127.0.0.1' }));
vi.mock('@/lib/cad/spatialCadJobStore', () => ({ ensureSpatialCadJobTables: mocks.ensure, listSpatialCadJobs: mocks.list, getSpatialCadJobUsage: mocks.usage, enqueueExactClashJob: mocks.enqueue, cancelExactClashJob: mocks.cancel, SPATIAL_CAD_IDEMPOTENCY_KEY: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ }));

import { GET, POST } from './route';
const context = { params: Promise.resolve({ id: 'project-1' }) };
const request = { schema: 'nexyfab.exact-clash-job-request.v1', coordinateSystem: 'EPSG:5186', toleranceMm: 50, documentRevision: 1, models: [] };
const post = (body: unknown = { request }, headers: Record<string, string> = {}) => new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/spatial-cad/jobs', { method: 'POST', headers: { origin: 'https://nexyfab.com', 'Idempotency-Key': 'job-key-1', ...headers }, body: JSON.stringify(body) });
const streamedPost = (body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) => new NextRequest(
  'https://nexyfab.com/api/nexyfab/projects/project-1/spatial-cad/jobs',
  {
    method: 'POST',
    headers: { origin: 'https://nexyfab.com', 'Idempotency-Key': 'job-key-1', ...headers },
    body,
    duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>,
);

beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({ userId: 'user-1' }); mocks.access.mockResolvedValue({ canEdit: true }); mocks.list.mockResolvedValue([]); mocks.usage.mockResolvedValue({ active: 1, limit: 2 });
  mocks.enqueue.mockResolvedValue({ ok: true, job: { id: 'SCJ-1', request: { ...request, models: [{}, {}] }, status: 'QUEUED', execution: 'NOT_RUN', releaseVerification: 'NOT_RUN' } });
  mocks.cancel.mockResolvedValue({ ok: true, job: { id: 'SCJ-1', status: 'CANCELLED', execution: 'NOT_RUN', releaseVerification: 'NOT_RUN' } });
});

describe('spatial exact clash job API', () => {
  it('isolates tenants before listing jobs', async () => { mocks.access.mockResolvedValue(null); expect((await GET(new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/spatial-cad/jobs'), context)).status).toBe(404); expect(mocks.list).not.toHaveBeenCalled(); });
  it('allows viewers to read usage but not queue or cancel', async () => { mocks.access.mockResolvedValue({ canEdit: false }); const listed = await GET(new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/spatial-cad/jobs'), context); expect(listed.status).toBe(200); await expect(listed.json()).resolves.toMatchObject({ canEdit: false, usage: { active: 1, limit: 2 } }); expect((await POST(post(), context)).status).toBe(403); expect((await POST(post({ action: 'cancel', jobId: 'SCJ-1' }), context)).status).toBe(403); expect(mocks.cancel).not.toHaveBeenCalled(); });
  it('queues without claiming execution or release verification and returns authoritative usage', async () => { const response = await POST(post(), context); expect(response.status).toBe(202); await expect(response.json()).resolves.toMatchObject({ job: { status: 'QUEUED', execution: 'NOT_RUN', releaseVerification: 'NOT_RUN' }, usage: { active: 1, limit: 2 } }); expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'cad.spatial_exact_clash_queued' })); });
  it('keeps invalid exact input blocked', async () => { mocks.enqueue.mockResolvedValue({ ok: false, code: 'JOB_BLOCKED', issues: ['exact_clash_requires_2_to_100_models'] }); const response = await POST(post(), context); expect(response.status).toBe(422); });
  it('requires a validated idempotency key', async () => { expect((await POST(post({ request }, { 'Idempotency-Key': '' }), context)).status).toBe(400); expect(mocks.enqueue).not.toHaveBeenCalled(); });
  it('returns reuse, payload conflict, and cancellation outcomes from the durable store', async () => {
    mocks.enqueue.mockResolvedValueOnce({ ok: true, reused: true, job: { id: 'SCJ-1', status: 'QUEUED' } }).mockResolvedValueOnce({ ok: false, code: 'IDEMPOTENCY_CONFLICT', issues: ['idempotency_key_payload_conflict'] });
    expect((await POST(post(), context)).status).toBe(200);
    expect((await POST(post({ request: { ...request, toleranceMm: 51 } }), context)).status).toBe(409);
    expect((await POST(post({ action: 'cancel', jobId: 'SCJ-1' }), context)).status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith(expect.anything(), 'project-1', 'SCJ-1');
  });
  it('returns authoritative usage for cancellation success and races', async () => {
    mocks.cancel.mockResolvedValueOnce({ ok: true, job: { id: 'SCJ-1', status: 'CANCELLED', execution: 'NOT_RUN', releaseVerification: 'NOT_RUN' } }).mockResolvedValueOnce({ ok: false, code: 'CANCEL_CONFLICT', issues: ['spatial_cad_cancel_compare_and_swap_failed'] });
    expect((await POST(post({ action: 'cancel', jobId: 'SCJ-1' }), context)).status).toBe(200);
    await expect((await POST(post({ action: 'cancel', jobId: 'SCJ-1' }), context)).json()).resolves.toMatchObject({ ok: false, code: 'CANCEL_CONFLICT', usage: { active: 1, limit: 2 } });
  });
  it('does not cross project access boundaries for cancellation', async () => { mocks.access.mockResolvedValue(null); expect((await POST(post({ action: 'cancel', jobId: 'SCJ-1' }), context)).status).toBe(404); expect(mocks.cancel).not.toHaveBeenCalled(); });
  it('does not initialize storage anonymously', async () => { mocks.auth.mockResolvedValue(null); expect((await POST(post(), context)).status).toBe(401); expect(mocks.ensure).not.toHaveBeenCalled(); });
  it('denies usage to anonymous callers', async () => { mocks.auth.mockResolvedValue(null); expect((await GET(new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/spatial-cad/jobs'), context)).status).toBe(401); expect(mocks.usage).not.toHaveBeenCalled(); });
  it('does not trust false-small Content-Length and cancels actual overflow before enqueue', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        controller.enqueue(new Uint8Array(256 * 1024));
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(streamedPost(stream, { 'content-length': '1' }), context);
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('rejects invalid UTF-8 before enqueue', async () => {
    const response = await POST(new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/spatial-cad/jobs', {
      method: 'POST',
      headers: { origin: 'https://nexyfab.com', 'Idempotency-Key': 'job-key-1' },
      body: new Uint8Array([0xff]),
    }), context);
    expect(response.status).toBe(400);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
