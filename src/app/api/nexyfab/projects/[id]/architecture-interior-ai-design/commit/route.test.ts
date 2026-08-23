import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRemoteApprovalToken } from '@/lib/precision-cad-agent/remoteAgentApi';
import { hashArchitectureInteriorEvidenceV2 } from '@/lib/ai/architectureInteriorWorkspace';

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(), resolveProjectAccess: vi.fn(), getDbAdapter: vi.fn(), checkOrigin: vi.fn(),
  bootstrap: vi.fn(), ensure: vi.fn(), persist: vi.fn(), tenant: vi.fn(), rateLimitAsync: vi.fn(), rateLimitHeaders: vi.fn(), ip: vi.fn(), audit: vi.fn(),
}));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.getAuthUser }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.resolveProjectAccess }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: mocks.getDbAdapter }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: mocks.checkOrigin }));
vi.mock('@/lib/artifacts/directArtifactUploadStore', () => ({ resolveArtifactTenantId: mocks.tenant }));
vi.mock('@/lib/ai/architectureInteriorAiCandidateWorkspace', () => ({ bootstrapArchitectureInteriorAiCandidateWorkspace: mocks.bootstrap }));
vi.mock('@/lib/ai/architectureInteriorWorkspaceStore', () => ({ ensureArchitectureInteriorWorkspaceTables: mocks.ensure, persistArchitectureInteriorWorkspace: mocks.persist }));
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: mocks.rateLimitAsync, rateLimitHeaders: mocks.rateLimitHeaders }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIpOrUndefined: mocks.ip }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.audit }));

import { POST } from './route';

const auth = { userId: 'user-1' };
const access = { role: 'editor', canEdit: true, row: { id: 'project-1', org_id: 'org-1' }, ownerUserId: 'user-1' };
const candidate = { hashes: { proposal: 'a'.repeat(64) }, architecture: {}, interior: {} };
const workspace = { projectId: 'project-1', workspace: { revision: 0 }, contentHash: 'b'.repeat(64) };
const candidateHash = hashArchitectureInteriorEvidenceV2(candidate);
const token = () => makeRemoteApprovalToken({ userId: 'user-1', projectId: 'project-1', revision: -1, tool: 'architecture-interior-ai-design.commit', arguments: { proposalId: 'p-1', proposalHash: 'a'.repeat(64), candidateHash } }, process.env);

function request(body: unknown) {
  return new NextRequest('http://localhost/api/nexyfab/projects/project-1/architecture-interior-ai-design/commit', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify(body) });
}
const params = { params: Promise.resolve({ id: 'project-1' }) };

describe('architecture/interior AI design commit route', () => {
  beforeEach(() => {
    vi.clearAllMocks(); process.env.NEXYFAB_AGENT_APPROVAL_SECRET = 'test-architecture-interior-approval-secret-32';
    mocks.getAuthUser.mockResolvedValue(auth); mocks.resolveProjectAccess.mockResolvedValue(access); mocks.getDbAdapter.mockReturnValue({}); mocks.checkOrigin.mockReturnValue(true); mocks.tenant.mockReturnValue('tenant-1'); mocks.ensure.mockResolvedValue(undefined); mocks.rateLimitAsync.mockResolvedValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60_000 }); mocks.rateLimitHeaders.mockReturnValue({}); mocks.ip.mockReturnValue('127.0.0.1');
    mocks.bootstrap.mockReturnValue({ ok: true, workspace }); mocks.persist.mockResolvedValue({ ok: true, revisionId: 'revision-1', workspace, createdAt: 1 });
  });

  it('requires editor authority and never bootstraps on invalid approval', async () => {
    mocks.resolveProjectAccess.mockResolvedValueOnce({ ...access, canEdit: false });
    expect((await POST(request({}), params)).status).toBe(403);
    const invalid = await POST(request({ proposalId: 'p-1', proposalHash: 'a'.repeat(64), candidateHash, candidate, approvalToken: 'x'.repeat(32) }), params);
    expect(invalid.status).toBe(409);
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });

  it('verifies the server HMAC binding, bootstraps, and persists revision zero by CAS', async () => {
    const response = await POST(request({ proposalId: 'p-1', proposalHash: 'a'.repeat(64), candidateHash, candidate, approvalToken: token() }), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, code: 'CONCEPT_COMMITTED', persisted: true, revision: 0, exact: { status: 'not_run' } });
    expect(mocks.bootstrap).toHaveBeenCalledWith({ candidate, approval: { projectId: 'project-1', proposalId: 'p-1', proposalHash: 'a'.repeat(64), actorId: 'user-1', scope: 'architecture_interior_concept' } });
    expect(mocks.persist).toHaveBeenCalledWith(expect.anything(), { tenantId: 'tenant-1', userId: 'user-1' }, 'project-1', -1, workspace);
  });

  it('rejects candidate hash tampering and concurrent workspace creation', async () => {
    const tampered = await POST(request({ proposalId: 'p-1', proposalHash: 'a'.repeat(64), candidateHash, candidate: { ...candidate, extra: true }, approvalToken: token() }), params);
    expect(tampered.status).toBe(409); expect(mocks.bootstrap).not.toHaveBeenCalled();
    mocks.persist.mockResolvedValueOnce({ ok: false, code: 'REVISION_CONFLICT', currentRevision: 0, currentContentHash: 'c'.repeat(64), conflictPaths: [] });
    const conflict = await POST(request({ proposalId: 'p-1', proposalHash: 'a'.repeat(64), candidateHash, candidate, approvalToken: token() }), params);
    expect(conflict.status).toBe(409); expect((await conflict.json()).code).toBe('REVISION_CONFLICT');
  });

  it('fails closed when approval configuration is missing or belongs to another user', async () => {
    delete process.env.NEXYFAB_AGENT_APPROVAL_SECRET;
    const missingConfig = await POST(request({ proposalId: 'p-1', proposalHash: 'a'.repeat(64), candidateHash, candidate, approvalToken: 'x'.repeat(32) }), params);
    expect(missingConfig.status).toBe(503);
    process.env.NEXYFAB_AGENT_APPROVAL_SECRET = 'test-architecture-interior-approval-secret-32';
    mocks.getAuthUser.mockResolvedValueOnce({ userId: 'other-user' });
    const wrongUser = await POST(request({ proposalId: 'p-1', proposalHash: 'a'.repeat(64), candidateHash, candidate, approvalToken: token() }), params);
    expect(wrongUser.status).toBe(409); expect(mocks.bootstrap).not.toHaveBeenCalled();
  });
});
