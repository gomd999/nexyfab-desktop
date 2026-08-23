import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(), ensure: vi.fn(), persist: vi.fn(), read: vi.fn(), list: vi.fn(), audit: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: () => true }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ marker: 'db' }) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.access }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.audit }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIpOrUndefined: () => '127.0.0.1' }));
vi.mock('@/lib/cad/workspaceRevisionStore', () => ({
  ensureCadWorkspaceRevisionTables: mocks.ensure,
  persistCadWorkspaceRevision: mocks.persist,
  readCadWorkspaceRevision: mocks.read,
  listCadWorkspaceRevisions: mocks.list,
}));

import { GET, POST } from './route';

const context = { params: Promise.resolve({ id: 'project-1' }) };
const request = (body: unknown) => new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/cad-revisions', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://nexyfab.com' }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: 'user-1' });
  mocks.access.mockResolvedValue({ canEdit: true, role: 'owner', ownerUserId: 'user-1', row: {} });
  mocks.ensure.mockResolvedValue(undefined);
  mocks.persist.mockResolvedValue({ ok: true, revisionId: 'rev-1', envelope: { workspace: { revision: 0 }, contentHash: 'a'.repeat(64) } });
  mocks.read.mockResolvedValue({ workspace: { revision: 0 }, contentHash: 'a'.repeat(64) });
  mocks.list.mockResolvedValue([{ artifactId: 'artifact-1', revision: 0, domain: 'building' }]);
});

describe('project CAD revision API isolation', () => {
  it('returns 404 before reading revision data for another tenant project', async () => {
    mocks.access.mockResolvedValue(null);
    const response = await GET(new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/cad-revisions'), context);
    expect(response.status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('allows a project viewer to read but never write', async () => {
    mocks.access.mockResolvedValue({ canEdit: false, role: 'viewer', ownerUserId: 'owner', row: {} });
    expect((await GET(new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/cad-revisions'), context)).status).toBe(200);
    expect((await POST(request({ baseRevision: -1, envelope: {} }), context)).status).toBe(403);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('allows viewers to list bounded exact revision metadata', async () => {
    mocks.access.mockResolvedValue({ canEdit: false, role: 'viewer', ownerUserId: 'owner', row: {} });
    const response = await GET(new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/cad-revisions?list=1&limit=20'), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ revisions: [{ artifactId: 'artifact-1' }] });
    expect(mocks.list).toHaveBeenCalledWith(expect.anything(), 'project-1', 20);
  });

  it('rejects an unbounded revision list request', async () => {
    expect((await GET(new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/cad-revisions?list=1&limit=101'), context)).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('passes the authenticated actor, route project and base revision to atomic persistence', async () => {
    const response = await POST(request({ baseRevision: -1, envelope: { schema: 'x' } }), context);
    expect(response.status).toBe(201);
    expect(mocks.persist).toHaveBeenCalledWith(expect.anything(), 'user-1', 'project-1', -1, { schema: 'x' });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'cad.workspace_revision_commit', resourceId: 'project-1' }));
  });

  it('returns structured conflict paths with 409', async () => {
    mocks.persist.mockResolvedValue({
      ok: false, code: 'REVISION_CONFLICT', currentRevision: 4,
      currentContentHash: 'b'.repeat(64), conflictPaths: ['semanticDocument.payload.parts[0].diameter'],
    });
    const response = await POST(request({ baseRevision: 3, envelope: { schema: 'x' } }), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: 4 });
  });

  it('does not initialize storage for unauthenticated requests', async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await POST(request({ baseRevision: -1, envelope: {} }), context);
    expect(response.status).toBe(401);
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it('maps a declared oversized stream and invalid UTF-8 without persistence', async () => {
    const url = 'https://nexyfab.com/api/nexyfab/projects/project-1/cad-revisions';
    const oversized = await POST(new NextRequest(url, { method: 'POST', headers: { origin: 'https://nexyfab.com', 'content-length': '2200001' }, body: '{}' }), context);
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toEqual({ error: 'Revision envelope too large' });
    const malformed = await POST(new NextRequest(url, { method: 'POST', headers: { origin: 'https://nexyfab.com' }, body: new Uint8Array([0xff]) }), context);
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({ error: 'Invalid JSON' });
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
