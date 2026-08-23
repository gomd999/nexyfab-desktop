import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeRemoteApprovalToken } from '@/lib/precision-cad-agent/remoteAgentApi';

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(), resolveProjectAccess: vi.fn(), rateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 2, reset: Date.now() + 60_000 })), getDbAdapter: vi.fn(() => ({})), ensureWorkspace: vi.fn(), readWorkspace: vi.fn(), persistWorkspace: vi.fn(), createKernel: vi.fn(), executeTransaction: vi.fn(), logAudit: vi.fn(), getStorage: vi.fn(() => ({})), ensureExactArtifactTables: vi.fn(), persistExactArtifact: vi.fn(), readValidateExactArtifact: vi.fn(), compactWorkspace: vi.fn(), deleteExactArtifact: vi.fn(), validateWorkspace: vi.fn(() => []),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.getAuthUser }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.resolveProjectAccess }));
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: mocks.rateLimitAsync, rateLimitHeaders: () => ({}) }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: mocks.getDbAdapter }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/ai/architectureInteriorWorkspaceStore', () => ({ ensureArchitectureInteriorWorkspaceTables: mocks.ensureWorkspace, readArchitectureInteriorWorkspace: mocks.readWorkspace, persistArchitectureInteriorWorkspace: mocks.persistWorkspace }));
vi.mock('@/lib/ai/architectureInteriorExactGeometry', () => ({ createNodeArchitectureExactKernelAdapter: mocks.createKernel }));
vi.mock('@/lib/ai/architectureInteriorExactTransaction', () => ({ executeArchitectureInteriorExactTransaction: mocks.executeTransaction }));
vi.mock('@/lib/storage', () => ({ getStorage: mocks.getStorage }));
vi.mock('@/lib/ai/architectureInteriorExactArtifactStore', () => ({ ensureArchitectureInteriorExactArtifactTables: mocks.ensureExactArtifactTables, persistArchitectureInteriorExactArtifact: mocks.persistExactArtifact, readValidateArchitectureInteriorExactArtifact: mocks.readValidateExactArtifact, compactArchitectureInteriorExactWorkspace: mocks.compactWorkspace, deleteArchitectureInteriorExactArtifact: mocks.deleteExactArtifact }));
vi.mock('@/lib/ai/architectureInteriorWorkspace', () => ({ validateArchitectureInteriorWorkspaceV2: mocks.validateWorkspace }));

import { GET, POST } from './route';

const auth = { userId: 'user-1', orgIds: ['org-1'], activeOrgId: 'org-1', orgContextStatus: 'ok' as const };
const access = { row: { id: 'project-1', user_id: 'owner-1', org_id: 'org-1' }, role: 'editor' as const, canEdit: true, ownerUserId: 'owner-1' };
const workspace = { workspace: { revision: 0 }, contentHash: 'a'.repeat(64) };
const body = { expectedWorkspaceRevision: 0, expectedWorkspaceContentHash: 'a'.repeat(64) };
const token = () => makeRemoteApprovalToken({ userId: 'user-1', projectId: 'project-1', revision: 0, tool: 'architecture-interior-exact.post', arguments: { action: 'promote_exact', scope: 'architecture-interior-exact', expectedWorkspaceRevision: 0, expectedWorkspaceContentHash: 'a'.repeat(64) } }, process.env) ?? '';

function request(value: unknown): NextRequest { return new NextRequest('http://localhost/api/nexyfab/projects/project-1/architecture-interior-exact', { method: 'POST', body: JSON.stringify(value), headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' } }); }
async function call(value: unknown = { ...body, approved: true, approvalToken: token() }) { return POST(request(value), { params: Promise.resolve({ id: 'project-1' }) }); }
function getRequest(): NextRequest { return new NextRequest('http://localhost/api/nexyfab/projects/project-1/architecture-interior-exact'); }

describe('architecture/interior exact promotion route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXYFAB_AGENT_APPROVAL_SECRET = 'x'.repeat(40);
    mocks.getAuthUser.mockResolvedValue(auth); mocks.resolveProjectAccess.mockResolvedValue(access); mocks.readWorkspace.mockResolvedValue({ ok: true, workspace }); mocks.createKernel.mockResolvedValue({ ok: true, adapter: { identity: { backend: 'occt-node' } } }); mocks.persistExactArtifact.mockResolvedValue({ ok: true, reference: { manifestId: 'manifest-1', bundleHash: 'c'.repeat(64), byteLength: 100, architecture: { receiptContentHash: 'd'.repeat(64), receiptEvidenceHash: 'e'.repeat(64), shapeCount: 1, stepBytes: 10 }, interior: { receiptContentHash: 'f'.repeat(64), receiptEvidenceHash: 'a'.repeat(64), shapeCount: 1, stepBytes: 10 } } }); mocks.compactWorkspace.mockImplementation((value: unknown) => value);
  });

  it('blocks viewers and returns the first approval challenge', async () => {
    mocks.resolveProjectAccess.mockResolvedValueOnce({ ...access, role: 'viewer', canEdit: false });
    expect((await call(body)).status).toBe(403);
    mocks.resolveProjectAccess.mockResolvedValue(access);
    const challenge = await call(body);
    expect(challenge.status).toBe(409);
    await expect(challenge.json()).resolves.toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED', approval: { token: expect.any(String) } });
  });

  it('rejects stale workspace hash before loading the kernel', async () => {
    mocks.readWorkspace.mockResolvedValue({ ok: true, workspace: { workspace: { revision: 2 }, contentHash: 'c'.repeat(64) } });
    expect((await call()).status).toBe(409);
    expect(mocks.createKernel).not.toHaveBeenCalled();
  });

  it('reports unavailable kernel, transaction rejection, and persistence conflict', async () => {
    mocks.createKernel.mockResolvedValueOnce({ ok: false, code: 'EXACT_GEOMETRY_KERNEL_UNAVAILABLE' });
    expect((await call()).status).toBe(503);
    mocks.createKernel.mockResolvedValue({ ok: true, adapter: {} });
    mocks.executeTransaction.mockResolvedValueOnce({ committed: false, workspace, code: 'kernel_blocked', details: ['failed'] });
    expect((await call()).status).toBe(422);
    mocks.executeTransaction.mockResolvedValueOnce({ committed: true, workspace: { workspace: { revision: 1 }, contentHash: 'b'.repeat(64), architecture: { geometry: { verification: { evidenceHash: 'd'.repeat(64) } } }, interior: { geometry: { verification: { evidenceHash: 'e'.repeat(64) } } } }, receipt: { contentHash: 'f'.repeat(64) }, artifactId: 'model' });
    mocks.persistWorkspace.mockResolvedValueOnce({ ok: false, code: 'REVISION_CONFLICT', currentRevision: 1, currentContentHash: 'b'.repeat(64), conflictPaths: [] });
    expect((await call()).status).toBe(409);
  });

  it('returns exact passed only after transaction and CAS persistence succeed', async () => {
    const nextWorkspace = { workspace: { revision: 1 }, contentHash: 'b'.repeat(64), architecture: { geometry: { verification: { evidenceHash: 'd'.repeat(64) } } }, interior: { geometry: { verification: { evidenceHash: 'e'.repeat(64) } } } };
    mocks.executeTransaction.mockResolvedValue({ committed: true, workspace: nextWorkspace, receipt: { contentHash: 'f'.repeat(64) }, artifactId: 'model' });
    mocks.persistWorkspace.mockResolvedValue({ ok: true, workspace: nextWorkspace, revisionId: 'rev-1' });
    const result = await call();
    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toMatchObject({ ok: true, code: 'EXACT_PROMOTED', exact: { status: 'passed' }, compliance: { status: 'not_run' }, release: { status: 'not_run' } });
    expect(mocks.logAudit).toHaveBeenCalledOnce();
  });

  it('reports exact readiness only when both compact domains match the validated private bundle', async () => {
    const reference = { schema: 'nexyfab.architecture-interior-exact-artifact-reference.v1', manifestId: 'manifest-1', projectId: 'project-1', revision: 1, bundleHash: 'c'.repeat(64), byteLength: 100, architecture: { receiptContentHash: 'd'.repeat(64), receiptEvidenceHash: 'e'.repeat(64), shapeCount: 1, stepBytes: 10 }, interior: { receiptContentHash: 'f'.repeat(64), receiptEvidenceHash: 'a'.repeat(64), shapeCount: 1, stepBytes: 10 } };
    const compact = (domain: 'architecture' | 'interior') => ({ schema: 'nexyfab.architecture-interior-exact-compact-reference.v1', domain, reference, receiptContentHash: domain === 'architecture' ? reference.architecture.receiptContentHash : reference.interior.receiptContentHash, receiptEvidenceHash: domain === 'architecture' ? reference.architecture.receiptEvidenceHash : reference.interior.receiptEvidenceHash });
    mocks.readWorkspace.mockResolvedValue({ ok: true, workspace: { workspace: { revision: 1, track: 'precision_cad', maturity: 'exact' }, contentHash: 'b'.repeat(64), architecture: { geometry: { payload: compact('architecture'), verification: { status: 'passed', evidenceHash: 'd'.repeat(64) } } }, interior: { geometry: { payload: compact('interior'), verification: { status: 'passed', evidenceHash: 'e'.repeat(64) } } } } });
    mocks.readValidateExactArtifact.mockResolvedValue({ ok: true, reference });
    const passed = await GET(getRequest(), { params: Promise.resolve({ id: 'project-1' }) });
    await expect(passed.json()).resolves.toMatchObject({ ok: true, exact: { status: 'passed', manifestId: 'manifest-1' } });

    const mismatched = compact('interior');
    mismatched.reference = { ...reference, manifestId: 'manifest-2' };
    mocks.readWorkspace.mockResolvedValueOnce({ ok: true, workspace: { workspace: { revision: 1, track: 'precision_cad', maturity: 'exact' }, contentHash: 'b'.repeat(64), architecture: { geometry: { payload: compact('architecture'), verification: { status: 'passed' } } }, interior: { geometry: { payload: mismatched, verification: { status: 'passed' } } } } });
    const unavailable = await GET(getRequest(), { params: Promise.resolve({ id: 'project-1' }) });
    await expect(unavailable.json()).resolves.toMatchObject({ ok: true, exact: { status: 'not_available', reasonCode: 'corrupt_artifact' } });
  });
});
