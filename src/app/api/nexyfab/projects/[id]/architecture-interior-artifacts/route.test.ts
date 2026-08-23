import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  resolveProjectAccess: vi.fn(),
  rateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 4, reset: Date.now() + 60_000 })),
  getDbAdapter: vi.fn(() => ({})),
  readWorkspace: vi.fn(),
  persistBundle: vi.fn(),
  executeTransaction: vi.fn(),
  ensureWorkspace: vi.fn(),
  ensureBundle: vi.fn(),
  readBundle: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.getAuthUser }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.resolveProjectAccess }));
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: mocks.rateLimitAsync, rateLimitHeaders: () => ({}) }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: mocks.getDbAdapter }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/ai/architectureInteriorWorkspaceStore', () => ({ readArchitectureInteriorWorkspace: mocks.readWorkspace, ensureArchitectureInteriorWorkspaceTables: mocks.ensureWorkspace }));
vi.mock('@/lib/ai/architectureInteriorArtifactBundleStore', () => ({ persistArchitectureInteriorArtifactBundle: mocks.persistBundle, readLatestArchitectureInteriorArtifactBundle: mocks.readBundle, ensureArchitectureInteriorArtifactBundleTables: mocks.ensureBundle }));
vi.mock('@/lib/ai/architectureInteriorArtifactTransaction', () => ({ executeArchitectureInteriorArtifactTransaction: mocks.executeTransaction }));

import { POST } from './route';

const auth = { userId: 'user-1', orgIds: ['org-1'], activeOrgId: 'org-1', orgContextStatus: 'ok' as const };
const access = { row: { id: 'project-1', user_id: 'owner-1', org_id: 'org-1' }, role: 'editor' as const, canEdit: true, ownerUserId: 'owner-1' };
const requestBody = { expectedWorkspaceRevision: 0, expectedWorkspaceContentHash: 'a'.repeat(64), requestedKinds: ['drawing'], expectedHeadBundleHash: null };

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/nexyfab/projects/project-1/architecture-interior-artifacts', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' } });
}

describe('architecture/interior derived-artifact route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXYFAB_AGENT_APPROVAL_SECRET = 'x'.repeat(40);
    mocks.getAuthUser.mockResolvedValue(auth);
    mocks.resolveProjectAccess.mockResolvedValue(access);
  });

  it('requires authentication and editor access', async () => {
    mocks.getAuthUser.mockResolvedValueOnce(null);
    expect((await POST(request(requestBody), { params: Promise.resolve({ id: 'project-1' }) })).status).toBe(401);
    mocks.getAuthUser.mockResolvedValue(auth);
    mocks.resolveProjectAccess.mockResolvedValueOnce({ ...access, role: 'viewer', canEdit: false });
    expect((await POST(request(requestBody), { params: Promise.resolve({ id: 'project-1' }) })).status).toBe(403);
  });

  it('returns a server-bound approval challenge before running generation', async () => {
    const result = await POST(request(requestBody), { params: Promise.resolve({ id: 'project-1' }) });
    expect(result.status).toBe(409);
    await expect(result.json()).resolves.toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED', approval: { scope: 'architecture_interior_artifacts', token: expect.any(String) } });
    expect(mocks.readWorkspace).not.toHaveBeenCalled();
    expect(mocks.executeTransaction).not.toHaveBeenCalled();
  });

  it('rejects unknown body keys and unsupported artifact kinds', async () => {
    expect((await POST(request({ ...requestBody, extra: true }), { params: Promise.resolve({ id: 'project-1' }) })).status).toBe(400);
    expect((await POST(request({ ...requestBody, requestedKinds: ['model'] }), { params: Promise.resolve({ id: 'project-1' }) })).status).toBe(400);
  });
});

