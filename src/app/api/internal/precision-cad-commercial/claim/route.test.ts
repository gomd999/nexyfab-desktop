import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { verifyCommercialTransportHmac } from '../../../../../../packages/job-contracts/src/commercialPrecisionExecution';
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), claim: vi.fn(), hold: vi.fn(), workers: vi.fn(), sha256: vi.fn() }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: mocks.getDb }));
vi.mock('@/lib/storage', () => ({ getStorage: () => ({ sha256: mocks.sha256 }) }));
vi.mock('@/lib/precision-cad-agent/commercialWorkerReceipt', () => ({ loadTrustedCommercialWorkers: mocks.workers }));
vi.mock('@/lib/precision-cad-agent/commercialExecutionOutboxStore', () => ({ CommercialExecutionOutboxStore: class { claim = mocks.claim; hold = mocks.hold; } }));
import { POST } from './route';
const request = (body: unknown, secret = 's'.repeat(32)) => new NextRequest('https://local.test/api/internal/precision-cad-commercial/claim', { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify(body) });
const input = { artifactId: 'input-1', objectKey: 'private/commercial/input.json', contentSha256: 'e'.repeat(64), byteLength: 256, mediaType: 'application/json' };
const job = { contractVersion: 'nexyfab.precision-cad-commercial-execution.v3', jobId: 'job-1', tenantId: 'tenant-1', projectId: 'project-1', executionId: 'exec-1', generationRunId: 'run-1', generationStateRevision: 11, generationProgramSha256: '9'.repeat(64), workspaceId: 'workspace-1', workspaceRevision: 7, workspaceContentHash: 'a'.repeat(64), tool: 'build_assembly', scope: 'apply', callId: 'call-1', argumentsHash: 'b'.repeat(64), commandHash: 'c'.repeat(64), targetHash: 'd'.repeat(64), journalVersion: 3, attempt: 1, leaseGeneration: 2, inputArtifact: input };
const inputRow = { execution_id: job.executionId, tenant_id: job.tenantId, project_id: job.projectId, artifact_id: input.artifactId, object_key: input.objectKey, content_sha256: input.contentSha256, byte_length: input.byteLength, media_type: input.mediaType };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXYFAB_COMMERCIAL_WORKER_CLAIM_SECRET', 's'.repeat(32)); vi.stubEnv('NEXYFAB_COMMERCIAL_TRANSPORT_SECRET', 't'.repeat(32)); vi.stubEnv('NEXYFAB_COMMERCIAL_CALLBACK_URL', 'https://core.example.test/callback'); vi.stubEnv('NEXYFAB_COMMERCIAL_MODE', '0');
  mocks.getDb.mockReturnValue({ queryOne: vi.fn().mockResolvedValue(inputRow) }); mocks.claim.mockResolvedValue({ ok: false, code: 'NOT_FOUND' }); mocks.hold.mockResolvedValue({ ok: true }); mocks.workers.mockReturnValue(undefined); mocks.sha256.mockResolvedValue({ size: input.byteLength, contentSha256: input.contentSha256 });
});
describe('commercial claim route', () => {
  it('rejects unauthorized and unregistered worker identities', async () => { expect((await POST(request({ owner: 'worker-1' }, 'wrong'))).status).toBe(403); expect((await POST(request({ owner: 'worker-1' }))).status).toBe(403); });
  it('holds while the worker registry is absent', async () => { vi.stubEnv('NEXYFAB_COMMERCIAL_TRANSPORT_SECRET', ''); expect((await POST(request({ owner: 'worker-1' }))).status).toBe(403); });
  it('returns an HMAC-bound v3 transport only after immutable input readback', async () => {
    mocks.workers.mockReturnValue({ 'worker-1': { workerIdentity: 'worker-1' } });
    mocks.claim.mockResolvedValue({ ok: true, row: { job, capability: 'x'.repeat(43) } });
    const response = await POST(request({ owner: 'worker-1' }));
    expect(response.status).toBe(200);
    const value = await response.json();
    expect(value.transport).toMatchObject({ schema: 'nexyfab.precision-cad-commercial-execution.v3', inputDownloadUrl: expect.stringContaining('artifactId=input-1'), artifactGatewayUrl: 'https://local.test/api/internal/precision-cad-commercial/artifacts' });
    expect(await verifyCommercialTransportHmac('t'.repeat(32), value.transport)).toBe(true);
    expect(mocks.hold).not.toHaveBeenCalled();
  });
  it('moves the claimed job to HOLD when immutable input readback or transport configuration fails', async () => {
    mocks.workers.mockReturnValue({ 'worker-1': { workerIdentity: 'worker-1' } });
    mocks.claim.mockResolvedValue({ ok: true, row: { job, capability: 'x'.repeat(43) } });
    mocks.sha256.mockResolvedValueOnce({ size: input.byteLength, contentSha256: '0'.repeat(64) });
    expect((await POST(request({ owner: 'worker-1' }))).status).toBe(409);
    expect(mocks.hold).toHaveBeenCalledWith(job.jobId, 'immutable_input_readback_failed');
    mocks.hold.mockClear(); vi.stubEnv('NEXYFAB_COMMERCIAL_CALLBACK_URL', 'http://127.0.0.1/callback');
    expect((await POST(request({ owner: 'worker-1' }))).status).toBe(409);
    expect(mocks.hold).toHaveBeenCalledWith(job.jobId, expect.stringContaining('transport_invalid:'));
  });
});
