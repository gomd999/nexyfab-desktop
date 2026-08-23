import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), origin: vi.fn(() => true), persist: vi.fn() }));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: mocks.origin }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({}) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.access }));
vi.mock('@/lib/cad/interiorPlacementDraftStore', () => ({ persistInteriorPlacementOperation: mocks.persist }));
import { POST } from './route';

const context = { params: Promise.resolve({ id: 'project-1' }) };
const base = { documentId: 'placement-1', roomDocumentId: 'room-1', baseProjectRevision: 2, baseContentHash: 'a'.repeat(64), selectedObjectId: 'table-1', parameterPaths: ['pose.positionMm'], locks: [], operation: { kind: 'patch_selected_object', objectId: 'table-1', changes: { pose: { positionMm: [100, 0, 0], rotationDeg: [0, 0, 0] } } } };
const request = (body: unknown) => new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/interior-placement/command', { method: 'POST', headers: { origin: 'https://nexyfab.com', 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ userId: 'user-1' }); mocks.access.mockResolvedValue({ canEdit: true }); mocks.persist.mockResolvedValue({ ok: true, changedObjectIds: ['table-1'], draft: { projectId: 'project-1', documentId: 'placement-1', roomDocumentId: 'room-1', projectRevision: 3, contentHash: 'b'.repeat(64), document: {}, locks: [], savedAt: 1 } }); });

describe('interior placement reviewed command route', () => {
  it('fails closed for tampered/non-selected operations and sends AI guards only', async () => {
    expect((await POST(request({ ...base, operation: { kind: 'add_object' } }), context)).status).toBe(400);
    expect((await POST(request({ ...base, operation: { kind: 'patch_selected_object', objectId: 'other', changes: {} } }), context)).status).toBe(422);
    expect((await POST(request({ ...base, actor: 'human' }), context)).status).toBe(400);
    expect((await POST(request(base), context)).status).toBe(201);
    expect(mocks.persist).toHaveBeenCalledWith(expect.anything(), 'user-1', 'project-1', expect.objectContaining({ actor: 'ai', guards: expect.objectContaining({ selectedObjectId: 'table-1', parameterPaths: ['pose.positionMm'] }) }));
  });

  it('rejects unknown nested fields and malformed live-lock projections before store', async () => {
    expect((await POST(request({ ...base, operation: { ...base.operation, injected: true } }), context)).status).toBe(400);
    expect((await POST(request({ ...base, operation: { ...base.operation, changes: { ...base.operation.changes, catalogType: 'sofa' } } }), context)).status).toBe(400);
    expect((await POST(request({ ...base, locks: [{ id: 'l1', target: { kind: 'occurrence', objectId: 'table-1' }, ownerUserId: 'forged' }] }), context)).status).toBe(400);
    expect((await POST(request({ ...base, parameterPaths: ['pose.positionMm', 'pose.positionMm'] }), context)).status).toBe(400);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('preserves oversized and malformed JSON response contracts', async () => {
    const url = 'https://nexyfab.com/api/nexyfab/projects/project-1/interior-placement/command';
    const oversized = await POST(new NextRequest(url, { method: 'POST', headers: { origin: 'https://nexyfab.com', 'content-length': '300001' }, body: '{}' }), context);
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toEqual({ error: 'Placement command too large' });
    const malformed = await POST(new NextRequest(url, { method: 'POST', headers: { origin: 'https://nexyfab.com' }, body: '{' }), context);
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({ error: 'Invalid JSON' });
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
