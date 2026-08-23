import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), origin: vi.fn(() => true), read: vi.fn(), persist: vi.fn(), release: vi.fn() }));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: mocks.origin }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({}) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.access }));
vi.mock('@/lib/cad/interiorPlacementDraftStore', () => ({ readInteriorPlacementDraft: mocks.read, persistInteriorPlacementOperation: mocks.persist, releaseInteriorPlacementLocks: mocks.release }));
import { GET, POST } from './route';

const context = { params: Promise.resolve({ id: 'project-1' }) };
const draft = { projectId: 'project-1', documentId: 'placement-1', roomDocumentId: 'room-1', projectRevision: 0, contentHash: 'a'.repeat(64), document: { schema: 'nexyfab.interior-placement-document.v1', documentId: 'placement-1', roomDocumentId: 'room-1', revision: 0, units: 'mm', roomSizeMm: [1000, 1000, 3000], objects: [] }, locks: [], savedAt: 1 };
const request = (body: unknown) => new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/interior-placement', { method: 'POST', headers: { origin: 'https://nexyfab.com', 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ userId: 'user-1' }); mocks.access.mockResolvedValue({ canEdit: true }); mocks.read.mockResolvedValue({ ok: true, draft }); mocks.persist.mockResolvedValue({ ok: true, changedObjectIds: [], draft }); mocks.release.mockResolvedValue({ ok: true, released: [], draft }); });

describe('interior placement route', () => {
  it('checks origin/auth/editor before write and returns no-store authoritative GET', async () => {
    mocks.origin.mockReturnValue(false); expect((await POST(request({}), context)).status).toBe(403); expect(mocks.persist).not.toHaveBeenCalled();
    mocks.origin.mockReturnValue(true); mocks.auth.mockResolvedValue(null); expect((await POST(request({}), context)).status).toBe(401);
    mocks.auth.mockResolvedValue({ userId: 'user-1' }); mocks.access.mockResolvedValue({ canEdit: false }); expect((await POST(request({}), context)).status).toBe(403);
    mocks.access.mockResolvedValue({ canEdit: true }); const response = await GET(new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/interior-placement?documentId=placement-1'), context); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('rejects human actor/guards/full lock replacement and accepts commit discriminator', async () => {
    expect((await POST(request({ action: 'commit', actor: 'ai', documentId: 'placement-1', roomDocumentId: 'room-1', baseProjectRevision: 0, operation: { kind: 'add_object' } }), context)).status).toBe(400);
    expect((await POST(request({ action: 'commit', documentId: 'placement-1', roomDocumentId: 'room-1', baseProjectRevision: 0, locks: [], operation: { kind: 'add_object' } }), context)).status).toBe(400);
    expect((await POST(request({ action: 'commit', documentId: 'placement-1', roomDocumentId: 'room-1', baseProjectRevision: 0, operation: { kind: 'delete_object', objectId: 'table-1' } }), context)).status).toBe(201);
    expect(mocks.persist).toHaveBeenCalledWith(expect.anything(), 'user-1', 'project-1', expect.objectContaining({ actor: 'human' }));
  });

  it('rejects unknown/prototype-shaped fields and forwards an exact baseline document once', async () => {
    expect((await POST(request({ action: 'commit', documentId: 'placement-1', roomDocumentId: 'room-1', baseProjectRevision: 0, surprise: true, operation: { kind: 'delete_object', objectId: 'table-1' } }), context)).status).toBe(400);
    expect((await POST(request({ action: 'commit', documentId: 'placement-1', roomDocumentId: 'room-1', baseProjectRevision: 0, operation: { kind: 'delete_object', objectId: 'table-1', __protoPollution: true } }), context)).status).toBe(400);
    expect((await POST(request(null), context)).status).toBe(400);
    const baseline = { action: 'commit', documentId: 'placement-1', roomDocumentId: 'room-1', baseProjectRevision: -1, operation: { kind: 'reset_layout', objects: [] }, document: draft.document };
    expect((await POST(request(baseline), context)).status).toBe(201);
    expect(mocks.persist).toHaveBeenLastCalledWith(expect.anything(), 'user-1', 'project-1', expect.objectContaining({ document: draft.document, actor: 'human' }));
  });

  it('rejects an oversized stream before placement persistence', async () => {
    const response = await POST(new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/interior-placement', {
      method: 'POST', headers: { origin: 'https://nexyfab.com', 'content-length': '300001' }, body: '{}',
    }), context);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: 'Placement request too large' });
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
