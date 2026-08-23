import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), origin: vi.fn(() => true), ensure: vi.fn(), persist: vi.fn(), persistCommand: vi.fn(), read: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: mocks.origin }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ marker: 'db' }) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.access }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.audit }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIpOrUndefined: () => '127.0.0.1' }));
vi.mock('@/lib/cad/spatialCadDraftStore', () => ({ ensureSpatialCadDraftTables: mocks.ensure, persistSpatialCadCommand: mocks.persistCommand, persistSpatialCadDraft: mocks.persist, readSpatialCadDraft: mocks.read }));

import { GET, POST } from './route';

const context = { params: Promise.resolve({ id: 'project-1' }) };
const document = { schema: 'nexyfab.spatial-cad-document.v1', domain: 'building', revision: 1, parameters: { width: 12000 }, verification: 'NOT_RUN', updatedBy: 'human' };
const post = () => new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/spatial-cad', { method: 'POST', headers: { origin: 'https://nexyfab.com' }, body: JSON.stringify({ baseRevision: -1, document, documentId: 'doc-1' }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: 'user-1' });
  mocks.access.mockResolvedValue({ canEdit: true });
  mocks.origin.mockReturnValue(true);
  mocks.persist.mockResolvedValue({ ok: true, draft: { projectRevision: 0, document, contentHash: 'a'.repeat(64) } });
  mocks.persistCommand.mockResolvedValue({ ok: true, changedPaths: ['parameters.width'], draft: { projectRevision: 1, document, contentHash: 'b'.repeat(64) } });
  mocks.read.mockResolvedValue({ projectRevision: 0, document, contentHash: 'a'.repeat(64) });
});

describe('spatial CAD project draft API', () => {
  it('isolates another tenant before reading its draft', async () => {
    mocks.access.mockResolvedValue(null);
    const response = await GET(new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/spatial-cad?domain=building'), context);
    expect(response.status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('allows viewers to read but not overwrite', async () => {
    mocks.access.mockResolvedValue({ canEdit: false });
    expect((await GET(new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/spatial-cad?domain=building'), context)).status).toBe(200);
    expect((await POST(post(), context)).status).toBe(403);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('persists an authenticated semantic draft without claiming exact geometry', async () => {
    const response = await POST(post(), context);
    expect(response.status).toBe(201);
    expect(mocks.persist).toHaveBeenCalledWith(expect.anything(), 'user-1', 'project-1', -1, document, { documentId: 'doc-1' });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('surfaces optimistic concurrency conflicts', async () => {
    mocks.persist.mockResolvedValue({ ok: false, code: 'REVISION_CONFLICT', currentRevision: 3, conflictPaths: ['parameters.width'] });
    const response = await POST(post(), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: 3 });
  });

  it('does not initialize storage for anonymous requests', async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(post(), context)).status).toBe(401);
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it('applies the same origin, auth and editor boundary to reviewed commands', async () => {
    const commandBody = { baseProjectRevision: 0, baseContentHash: 'a'.repeat(64), documentId: 'doc-1', locks: [], parameterPaths: ['width'], mode: 'request_only_edit', command: { schema: 'nexyfab.spatial-cad-command.v1', commandId: 'ai-1', domain: 'building', baseRevision: 1, actor: 'ai', operation: { kind: 'set_parameter', key: 'width', value: 13000 } } };
    const request = () => new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/spatial-cad/command', { method: 'POST', headers: { origin: 'https://nexyfab.com' }, body: JSON.stringify(commandBody) });
    mocks.origin.mockReturnValue(false);
    expect((await POST(request(), context)).status).toBe(403);
    mocks.origin.mockReturnValue(true);
    mocks.access.mockResolvedValue({ canEdit: false });
    expect((await POST(request(), context)).status).toBe(403);
    expect(mocks.persistCommand).not.toHaveBeenCalled();
  });

  it('does not write a second audit record for a rejected reviewed command', async () => {
    mocks.persistCommand.mockResolvedValue({ ok: false, code: 'CONTENT_HASH_CONFLICT', issues: ['content_hash_changed'] });
    const response = await POST(new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/spatial-cad/command', { method: 'POST', headers: { origin: 'https://nexyfab.com' }, body: JSON.stringify({ baseProjectRevision: 0, baseContentHash: 'a'.repeat(64), documentId: 'doc-1', locks: [], parameterPaths: ['width'], command: { schema: 'nexyfab.spatial-cad-command.v1' } }) }), context);
    expect(response.status).toBe(409);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('rejects oversized and malformed streamed drafts before store calls', async () => {
    const url = 'https://nexyfab.com/api/nexyfab/projects/project-1/spatial-cad';
    const oversized = await POST(new NextRequest(url, { method: 'POST', headers: { origin: 'https://nexyfab.com', 'content-length': '300001' }, body: '{}' }), context);
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toEqual({ error: 'Spatial draft too large' });
    const malformed = await POST(new NextRequest(url, { method: 'POST', headers: { origin: 'https://nexyfab.com' }, body: new Uint8Array([0xff]) }), context);
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({ error: 'Invalid JSON' });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.persistCommand).not.toHaveBeenCalled();
  });
});
