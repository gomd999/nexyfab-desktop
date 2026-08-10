import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(), ensure: vi.fn(), persist: vi.fn(), read: vi.fn(), audit: vi.fn(),
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
});
