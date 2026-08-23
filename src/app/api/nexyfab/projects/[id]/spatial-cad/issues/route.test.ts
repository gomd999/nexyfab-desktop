import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), ensure: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: () => true }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ marker: 'db' }) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.access }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.audit }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIpOrUndefined: () => '127.0.0.1' }));
vi.mock('@/lib/cad/spatialCadIssueStore', () => ({ ensureSpatialCadIssueTables: mocks.ensure, listSpatialCadIssues: mocks.list, createSpatialCadIssue: mocks.create, updateSpatialCadIssueStatus: mocks.update }));

import { GET, PATCH, POST } from './route';

const context = { params: Promise.resolve({ id: 'project-1' }) };
const candidate = { candidateId: 'candidate:architecture:mep', modelA: 'architecture', modelB: 'mep', overlapMm: [10, 20, 30], severity: 'hard', modelRevision: 1, evidence: 'BOUNDS_PREVIEW', exactVerification: 'NOT_RUN' };
const request = (method: 'POST' | 'PATCH', body: unknown) => new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/spatial-cad/issues', { method, headers: { origin: 'https://nexyfab.com' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: 'user-1' });
  mocks.access.mockResolvedValue({ canEdit: true });
  mocks.list.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ ok: true, issue: { id: 'SCI-1', ...candidate, status: 'OPEN', updatedAt: 10 } });
  mocks.update.mockResolvedValue({ ok: true, issue: { id: 'SCI-1', ...candidate, status: 'RESOLVED', updatedAt: 11 } });
});

describe('spatial CAD issue API', () => {
  it('keeps tenant isolation before listing issues', async () => {
    mocks.access.mockResolvedValue(null);
    expect((await GET(new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/spatial-cad/issues'), context))!.status).toBe(404);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('allows a viewer to list but not mutate issues', async () => {
    mocks.access.mockResolvedValue({ canEdit: false });
    expect((await GET(new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/spatial-cad/issues'), context))!.status).toBe(200);
    expect((await POST(request('POST', { candidate }), context))!.status).toBe(403);
  });

  it('creates only the candidate payload through the authenticated project', async () => {
    const response = await POST(request('POST', { candidate }), context);
    expect(response!.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.anything(), 'user-1', 'project-1', candidate);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'cad.spatial_issue_create' }));
  });

  it('surfaces concurrent status changes as conflict', async () => {
    mocks.update.mockResolvedValue({ ok: false, code: 'ISSUE_CONFLICT' });
    const response = await PATCH(request('PATCH', { issueId: 'SCI-1', status: 'RESOLVED', expectedUpdatedAt: 10 }), context);
    expect(response!.status).toBe(409);
  });

  it('does not initialize issue storage anonymously', async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(request('POST', { candidate }), context))!.status).toBe(401);
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it('bounds both create and previously-unbounded status update bodies', async () => {
    const url = 'https://nexyfab.com/api/nexyfab/projects/project-1/spatial-cad/issues';
    const headers = { origin: 'https://nexyfab.com', 'content-length': '64001' };
    const create = (await POST(new NextRequest(url, { method: 'POST', headers, body: '{}' }), context))!;
    expect(create.status).toBe(413);
    await expect(create.json()).resolves.toEqual({ error: 'Issue payload too large' });
    const update = (await PATCH(new NextRequest(url, { method: 'PATCH', headers, body: '{}' }), context))!;
    expect(update.status).toBe(413);
    await expect(update.json()).resolves.toEqual({ error: 'Issue payload too large' });
    const malformed = (await PATCH(new NextRequest(url, { method: 'PATCH', headers: { origin: 'https://nexyfab.com' }, body: new Uint8Array([0xff]) }), context))!;
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({ error: 'Invalid issue update' });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
