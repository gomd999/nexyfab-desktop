import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), configured: vi.fn(), ensure: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ marker: 'db' }) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.access }));
vi.mock('@/lib/artifacts/directArtifactUploadStore', () => ({ resolveArtifactTenantId: (org: unknown, owner: string) => typeof org === 'string' ? org : `personal:${owner}` }));
vi.mock('@/lib/cad/assemblyDrawingHandoffStore', () => ({
  isAssemblyDrawingHandoffStorageConfigured: mocks.configured,
  isServerAssemblyDrawingHandoffId: (id: string) => id === '11111111-1111-4111-8111-111111111111',
  ensureAssemblyDrawingHandoffTable: mocks.ensure,
  readStoredAssemblyDrawingHandoff: mocks.read,
}));

import { GET } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const context = { params: Promise.resolve({ id: 'project-1', handoffId: id }) };
const request = new NextRequest(`https://nexyfab.com/api/nexyfab/projects/project-1/drawing-handoffs/${id}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: 'viewer-1' });
  mocks.access.mockResolvedValue({ canEdit: false, ownerUserId: 'owner-1', row: { org_id: 'org-1' } });
  mocks.configured.mockReturnValue(true);
  mocks.read.mockResolvedValue({ ok: true, stored: { handoffId: id, handoff: { schema: 'x' }, payloadSha256: 'b'.repeat(64), byteLength: 100, expiresAt: 2000 } });
});

describe('assembly drawing handoff GET API', () => {
  it('allows a viewer read only inside the resolved tenant boundary', async () => {
    expect((await GET(request, context)).status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), { handoffId: id, projectId: 'project-1', tenantId: 'org-1' });
  });

  it('returns the same 404 without reading bytes for another tenant project', async () => {
    mocks.access.mockResolvedValue(null);
    expect((await GET(request, context)).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('keeps expired and corrupted immutable bytes fail-closed', async () => {
    mocks.read.mockResolvedValueOnce({ ok: false, code: 'EXPIRED' });
    expect((await GET(request, context)).status).toBe(410);
    mocks.read.mockResolvedValueOnce({ ok: false, code: 'STORED_HANDOFF_INVALID' });
    expect((await GET(request, context)).status).toBe(500);
  });
});
