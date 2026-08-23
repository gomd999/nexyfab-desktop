import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(), origin: vi.fn(() => true), db: { queryOne: vi.fn() },
  ensureCad: vi.fn(), readRevision: vi.fn(), assertRevision: vi.fn(), assertPending: vi.fn(),
  claim: vi.fn(), release: vi.fn(), catalog: vi.fn(), executeRemote: vi.fn(), worker: vi.fn(),
  persist: vi.fn(), ensureArtifacts: vi.fn(), storage: vi.fn(), tenant: vi.fn(), audit: vi.fn(),
  ensureBoundary: vi.fn(), issue: vi.fn(), consume: vi.fn(), token: vi.fn(), dispatch: vi.fn(), enqueue: vi.fn(), cadRef: vi.fn(),
}));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: mocks.origin }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => mocks.db }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.access }));
vi.mock('@/lib/cad/workspaceRevisionStore', () => ({ ensureCadWorkspaceRevisionTables: mocks.ensureCad, readCadWorkspaceRevision: mocks.readRevision }));
vi.mock('@/lib/precision-cad-agent/remoteAgentApi', () => ({
  assertRemotePendingToolCall: mocks.assertPending, assertRemoteProjectRevision: mocks.assertRevision, claimRemotePendingToolCall: mocks.claim,
  releaseRemotePendingToolCall: mocks.release, loadInstallerCoreCatalog: mocks.catalog, executeRemoteAgentCall: mocks.executeRemote,
  hashRemoteArguments: (value: unknown) => JSON.stringify(value), validateRemoteBinding: () => true,
  makeRemoteApprovalToken: mocks.token,
}));
vi.mock('@/lib/precision-cad-agent/remoteCadContract', () => ({ REMOTE_PRECISION_CAD_CONTRACT_VERSION: 'nexyfab.remote-precision-cad.v1', validateRemotePrecisionCadToolCall: () => [] }));
vi.mock('@/lib/precision-cad-agent/isolatedWorkerQueue', () => ({ executePrecisionCadToolInIsolatedWorker: mocks.worker, hasPrecisionCadWorkerCadReference: mocks.cadRef }));
vi.mock('@/lib/precision-cad-agent/precisionCadResultPersistence', () => ({ persistPrecisionCadResult: mocks.persist, summarizePrecisionCadToolResult: (value: unknown) => value }));
vi.mock('@/lib/artifacts/directArtifactUploadStore', () => ({ ensureDirectArtifactUploadTables: mocks.ensureArtifacts, resolveArtifactTenantId: mocks.tenant }));
vi.mock('@/lib/storage', () => ({ getStorage: mocks.storage }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.audit }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIpOrUndefined: () => '127.0.0.1' }));
vi.mock('@/lib/platform/jobOrchestratorClient', () => ({ dispatchCadJob: mocks.dispatch }));
vi.mock('@/lib/platform/contracts', () => ({ JOB_CONTRACT_VERSION: 'job.v1' }));
vi.mock('@/lib/precision-cad-agent/commercialAgentExecutionBoundary', () => ({
  ensureApprovalChallengeTable: mocks.ensureBoundary,
  issueDbApprovalChallenge: mocks.issue,
  consumeDbApprovalChallenge: mocks.consume,
  hashBoundaryArguments: (value: unknown) => `args:${JSON.stringify(value)}`,
}));
vi.mock('@/lib/precision-cad-agent/commercialExecutionOutboxStore', () => ({ enqueueCommercialExecutionTransaction: mocks.enqueue }));

import { POST } from './route';

const context = { params: Promise.resolve({ id: 'project-1' }) };
const challenge = { challengeId: 'challenge-1', nonce: 'nonce-1', mac: 'mac-1' };
const call = { callId: 'call-1', name: 'build_assembly', arguments: { amount: 2 }, scope: 'apply' };
const baseBody = { contractVersion: 'nexyfab.remote-precision-cad.v1', continuationId: 'continuation-12345678901234567890', binding: { projectId: 'project-1', revision: 7, updatedAt: 123 }, call };
const request = (extra: Record<string, unknown> = {}) => new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/precision-cad-agent/call', { method: 'POST', headers: { origin: 'https://nexyfab.com' }, body: JSON.stringify({ ...baseBody, ...extra }) });
const rawRequest = (body: BodyInit | null, headers: Record<string, string> = {}) => new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/precision-cad-agent/call', { method: 'POST', headers: { origin: 'https://nexyfab.com', ...headers }, body });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXYFAB_AGENT_APPROVAL_SECRET = 'route-commercial-boundary-secret-0123456789';
  mocks.auth.mockResolvedValue({ userId: 'user-1' });
  mocks.access.mockResolvedValue({ canEdit: true, role: 'editor', ownerUserId: 'owner-1', row: { org_id: 'org-1' } });
  mocks.assertRevision.mockResolvedValue(null); mocks.assertPending.mockResolvedValue(null); mocks.readRevision.mockResolvedValue({ contentHash: 'a'.repeat(64), workspace: { projectId: 'project-1', revision: 7 } });
  mocks.catalog.mockResolvedValue([{ name: 'build_assembly', description: 'build', parameters: { type: 'object' }, scope: 'apply' }]);
  mocks.issue.mockResolvedValue({ ok: true, challenge }); mocks.consume.mockResolvedValue({ ok: true, challenge });
  mocks.enqueue.mockResolvedValue({ ok: true, row: { job: { executionId: 'exec-commercial-1' } } });
  mocks.claim.mockResolvedValue(true); mocks.token.mockReturnValue('legacy-token'); mocks.tenant.mockReturnValue('tenant-1'); mocks.storage.mockReturnValue({});
  mocks.cadRef.mockReturnValue(false);
  mocks.executeRemote.mockImplementation(async ({ executor }: { executor: (value: { tool: string; arguments: Record<string, unknown> }) => Promise<unknown> }) => ({ ok: true, tool: 'build_assembly', scope: 'apply', result: await executor({ tool: 'build_assembly', arguments: { amount: 2 } }), auditId: 'audit-1' }));
  mocks.worker.mockResolvedValue({ id: 'worker-1', status: 'succeeded', result: { ok: true }, auditId: 'worker-audit' });
  mocks.persist.mockResolvedValue({ ok: false, code: 'STORAGE_UNAVAILABLE' });
});
afterEach(() => { delete process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE; });

describe('commercial approval and persistence boundary', () => {
  it('holds CAD ownership references before approval or isolated-worker dispatch', async () => {
    mocks.cadRef.mockReturnValue(true);
    const response = await POST(request({ approvalChallenge: challenge }), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ status: 'HOLD', releaseReady: false, error: { code: 'CAD_RUNTIME_HYDRATION_REQUIRED' } });
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it('does not accept a client-supplied hydration binding nested in tool arguments', async () => {
    mocks.cadRef.mockReturnValue(true);
    const response = await POST(request({
      approvalChallenge: challenge,
      call: { ...call, arguments: { options: { cadHydrationBinding: { projectId: 'project-1', sourceRecordId: 'forged' } } } },
    }), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ status: 'HOLD', error: { code: 'CAD_RUNTIME_HYDRATION_REQUIRED' } });
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it('rejects a declared oversized JSON body before revision or tool work', async () => {
    const response = await POST(rawRequest('{}', { 'content-length': String(320 * 1024 + 1) }), context);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'ARGUMENTS_TOO_LARGE' } });
    expect(mocks.assertRevision).not.toHaveBeenCalled();
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it('measures a chunked body despite a falsely small length and cancels it at the cap', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(320 * 1024));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() { cancelled = true; },
    });
    const init = { method: 'POST', headers: { origin: 'https://nexyfab.com', 'content-length': '1' }, body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' };
    const response = await POST(new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/precision-cad-agent/call', init as never), context);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'ARGUMENTS_TOO_LARGE' } });
    expect(cancelled).toBe(true);
    expect(mocks.assertRevision).not.toHaveBeenCalled();
  });

  it('rejects invalid UTF-8 as INVALID_REQUEST before revision or tool work', async () => {
    const response = await POST(rawRequest(new Uint8Array([0xff])), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(mocks.assertRevision).not.toHaveBeenCalled();
  });

  it('holds commercial execution before consuming approval when no verified generation binding exists', async () => {
    process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE = '1';
    const response = await POST(request({ approvalChallenge: challenge }), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ status: 'HOLD', releaseReady: false, error: { code: 'VERIFIED_GENERATION_BINDING_REQUIRED' } });
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it('enqueues v2 atomically from a server generation binding without requiring a final receipt', async () => {
    process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE = '1';
    mocks.db.queryOne.mockResolvedValue({ workspace_id: 'project-1', workspace_revision: 7, head_revision: 11, head_sha256: 'a'.repeat(64), generation_program_sha256: '8'.repeat(64) });
    const response = await POST(request({ generationRunId: 'run-1', approvalChallenge: challenge }), context);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ ok: true, status: 'QUEUED', workerStarted: false, releaseReady: false });
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ job: expect.objectContaining({ generationRunId: 'run-1', generationStateRevision: 11, generationProgramSha256: '8'.repeat(64), workspaceRevision: 7 }) }));
    expect(mocks.worker).not.toHaveBeenCalled();
  });
  it('issues a durable challenge and never executes before one-use consume', async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect(mocks.issue).toHaveBeenCalledTimes(1);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it('holds executed output when persistence fails and does not release the pending claim', async () => {
    const first = await POST(request({ approvalChallenge: challenge } ), context);
    expect(first.status).toBe(503);
    await expect(first.json()).resolves.toMatchObject({ ok: false, error: { code: 'EXECUTED_PERSISTENCE_HOLD', retryable: false } });
    expect(mocks.worker).toHaveBeenCalledTimes(1);
    expect(mocks.worker).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringContaining('"projectId":"project-1"'),
    }));
    const workerInput = mocks.worker.mock.calls[0]![0] as { idempotencyKey: string };
    expect(workerInput.idempotencyKey).toEqual(expect.stringContaining('"revision":7'));
    expect(workerInput.idempotencyKey).toEqual(expect.stringContaining('"workspaceContentHash"'));
    expect(workerInput.idempotencyKey).toEqual(expect.stringContaining('"tool":"build_assembly"'));
    expect(workerInput.idempotencyKey).toEqual(expect.stringContaining('"argumentsHash"'));
    expect(workerInput.idempotencyKey).toEqual(expect.stringContaining('"approvalChallengeId":"challenge-1"'));
    expect(mocks.release).not.toHaveBeenCalled();
    mocks.claim.mockResolvedValue(false);
    const second = await POST(request({ approvalChallenge: challenge }), context);
    expect(second.status).toBe(409);
    expect(mocks.worker).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the one-use challenge is consumed but the pending-call claim loses its CAS race', async () => {
    mocks.claim.mockResolvedValue(false);
    const response = await POST(request({ approvalChallenge: challenge }), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'STATE_INVALID' } });
    expect(mocks.consume).toHaveBeenCalledTimes(1);
    expect(mocks.worker).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });
});
