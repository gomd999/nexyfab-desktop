import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  access: vi.fn(),
  bootstrap: vi.fn(),
  head: vi.fn(),
  origin: vi.fn(() => true),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: mocks.origin }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ marker: 'db' }) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.access }));
vi.mock('@/lib/ai/scad-agent/precisionCadSessionBootstrap', () => ({
  bootstrapPrecisionCadSession: mocks.bootstrap,
}));
vi.mock('@/lib/cad/workspaceRevisionStore', () => ({ readAuthoritativeWorkspaceHead: mocks.head }));

import { POST } from './route';

const url = 'https://nexyfab.com/api/nexyfab/projects/project-1/precision-cad-agent/bootstrap';
const context = { params: Promise.resolve({ id: 'project-1' }) };
const hash = (char: string) => char.repeat(64);
const request = (body: unknown) => new NextRequest(url, {
  method: 'POST',
  headers: { origin: 'https://nexyfab.com', 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const ownership = {
  schema: 'nexyfab.cad-session-ownership.v1',
  partIds: ['server-part'],
  brepHandles: { 'occt:server-1': 'server-part' },
};
const session = {
  id: 'agent-1',
  cadOwnership: ownership,
  integrity: { version: 1, issuedAt: 10, signature: 'a'.repeat(64) },
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.origin.mockReturnValue(true);
  mocks.auth.mockResolvedValue({ userId: 'user-1', orgIds: ['org-1'], activeOrgId: 'org-1', orgContextStatus: 'active' });
  mocks.access.mockResolvedValue({ role: 'owner', canEdit: true, ownerUserId: 'user-1', row: { org_id: 'org-1' } });
  mocks.bootstrap.mockResolvedValue({
    ok: true,
    status: 'READY',
    binding: { schema: 'nexyfab.cad-session-bootstrap.v1', projectId: 'project-1', workspaceId: 'project-1', workspaceRevision: 7, workspaceContentHash: hash('a'), geometryContentHash: hash('b'), shapeIdentityHash: hash('c'), bootstrappedAt: 10 },
    session,
    ownership,
    mapping: {},
  });
  mocks.head.mockResolvedValue({ projectId: 'project-1', revision: 7, contentHash: hash('a') });
});

describe('precision CAD session bootstrap route', () => {
  it('allows an owner and passes only the route project plus revision/hash to the server adapter', async () => {
    const response = await POST(request({ revision: 7, contentHash: hash('a') }), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, status: 'READY', session: { cadOwnership: { partIds: ['server-part'] } } });
    expect(mocks.bootstrap).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', projectId: 'project-1', revision: 7, contentHash: hash('a'),
    }));
  });

  it('allows an editor but never a viewer', async () => {
    mocks.access.mockResolvedValueOnce({ role: 'editor', canEdit: true, ownerUserId: 'owner', row: { org_id: 'org-1' } });
    expect((await POST(request({ revision: 7, contentHash: hash('a') }), context)).status).toBe(200);
    mocks.access.mockResolvedValueOnce({ role: 'viewer', canEdit: false, ownerUserId: 'owner', row: { org_id: 'org-1' } });
    expect((await POST(request({ revision: 7, contentHash: hash('a') }), context)).status).toBe(403);
    expect(mocks.bootstrap).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for cross-org access before workspace or mapping reads', async () => {
    mocks.access.mockResolvedValue(null);
    const response = await POST(request({ revision: 7, contentHash: hash('a') }), context);
    expect(response.status).toBe(404);
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });

  it('rejects forged client ownership and never forwards it to the bootstrap adapter', async () => {
    const response = await POST(request({ revision: 7, contentHash: hash('a'), cadOwnership: { partIds: ['attacker-part'] }, partId: 'attacker-part' }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'CLIENT_OWNERSHIP_FORBIDDEN' } });
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });

  it('maps stale workspace and missing canonical geometry to HOLD', async () => {
    mocks.bootstrap.mockResolvedValueOnce({ ok: false, status: 'HOLD', code: 'STALE_WORKSPACE_HASH', reason: 'stale', current: { revision: 8, contentHash: hash('d') } });
    const stale = await POST(request({ revision: 7, contentHash: hash('a') }), context);
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ status: 'HOLD', releaseReady: false, error: { code: 'STALE_WORKSPACE_HASH' }, current: { revision: 8 } });

    mocks.bootstrap.mockResolvedValueOnce({ ok: false, status: 'HOLD', code: 'CANONICAL_BREP_MAPPING_MISSING', reason: 'missing' });
    const missing = await POST(request({ revision: 7, contentHash: hash('a') }), context);
    expect(missing.status).toBe(409);
    await expect(missing.json()).resolves.toMatchObject({ status: 'HOLD', error: { code: 'CANONICAL_BREP_MAPPING_MISSING' } });
  });

  it('returns invalid binding before reading the workspace when revision/hash is absent', async () => {
    const response = await POST(request({}), context);
    expect(response.status).toBe(400);
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });

  it('lets the server select the current head without trusting a browser revision or hash', async () => {
    const response = await POST(request({ useCurrentHead: true }), context);
    expect(response.status).toBe(200);
    expect(mocks.head).toHaveBeenCalledWith({ marker: 'db' }, 'project-1');
    expect(mocks.bootstrap).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', revision: 7, contentHash: hash('a'),
    }));
  });

  it('rejects a mixed client binding when asking for the current head', async () => {
    const response = await POST(request({ useCurrentHead: true, revision: 7, contentHash: hash('a') }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'DUPLICATE_BOOTSTRAP_BINDING' } });
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });

  it('rejects duplicate revision/hash aliases and every unknown nested ownership schema', async () => {
    const duplicateRevision = await POST(request({ revision: 7, workspaceRevision: 7, contentHash: hash('a') }), context);
    expect(duplicateRevision.status).toBe(400);
    await expect(duplicateRevision.json()).resolves.toMatchObject({ error: { code: 'DUPLICATE_BOOTSTRAP_ALIAS' } });
    const duplicateHash = await POST(request({ revision: 7, contentHash: hash('a'), workspaceContentHash: hash('a') }), context);
    expect(duplicateHash.status).toBe(400);
    await expect(duplicateHash.json()).resolves.toMatchObject({ error: { code: 'DUPLICATE_BOOTSTRAP_ALIAS' } });
    const nestedOwnership = await POST(request({ revision: 7, contentHash: hash('a'), mapping: { ownership: { partId: 'attacker' } } }), context);
    expect(nestedOwnership.status).toBe(400);
    await expect(nestedOwnership.json()).resolves.toMatchObject({ error: { code: 'UNKNOWN_REQUEST_FIELD', field: 'mapping' } });
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });
});
