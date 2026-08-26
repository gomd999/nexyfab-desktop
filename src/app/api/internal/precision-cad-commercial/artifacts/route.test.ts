import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  sha256: vi.fn(),
}));

vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ backend: 'postgres', queryOne: mocks.queryOne, execute: mocks.execute }) }));
vi.mock('@/lib/storage', () => ({ getStorage: () => ({ download: mocks.download, uploadRawImmutable: mocks.upload, sha256: mocks.sha256 }) }));
vi.mock('@/lib/precision-cad-agent/commercialWorkerIo', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/precision-cad-agent/commercialWorkerIo')>();
  return { ...actual, authorizeCommercialLease: mocks.authorize };
});

import { GET, POST, PUT } from './route';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const capability = 'x'.repeat(43);
const headers = { authorization: `Bearer ${capability}`, 'x-commercial-worker-identity': 'worker-1' };
const job = {
  contractVersion: 'nexyfab.precision-cad-commercial-execution.v3', jobId: 'job-1', tenantId: 'tenant-1', projectId: 'project-1', executionId: 'exec-1',
  generationRunId: 'run-1', generationStateRevision: 11, generationProgramSha256: '8'.repeat(64), workspaceId: 'workspace-1', workspaceRevision: 7,
  workspaceContentHash: 'a'.repeat(64), tool: 'build_assembly', scope: 'apply', callId: 'call-1', argumentsHash: 'b'.repeat(64), commandHash: 'c'.repeat(64),
  targetHash: 'd'.repeat(64), journalVersion: 3, attempt: 1, leaseGeneration: 2,
  inputArtifact: { artifactId: 'input-1', objectKey: 'private/commercial/input.json', contentSha256: '', byteLength: 0, mediaType: 'application/json' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ job, owner: 'worker-1', capabilityHash: 'e'.repeat(64), leaseExpiresAt: Date.now() + 60_000 });
  mocks.execute.mockResolvedValue({ changes: 1 });
  mocks.upload.mockResolvedValue({ replayed: false });
});

describe('commercial worker artifact gateway', () => {
  it('serves only the lease-bound immutable input after DB and object hash readback', async () => {
    const bytes = Buffer.from('{"input":true}', 'utf8');
    job.inputArtifact.contentSha256 = digest(bytes); job.inputArtifact.byteLength = bytes.length;
    mocks.queryOne.mockResolvedValue({ execution_id: job.executionId, tenant_id: job.tenantId, project_id: job.projectId, artifact_id: job.inputArtifact.artifactId, object_key: job.inputArtifact.objectKey, content_sha256: job.inputArtifact.contentSha256, byte_length: bytes.length, media_type: 'application/json' });
    mocks.download.mockResolvedValue(bytes);
    const response = await GET(new NextRequest(`https://core.example.test/api/internal/precision-cad-commercial/artifacts?jobId=${job.jobId}&artifactId=${job.inputArtifact.artifactId}`, { headers }));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-sha256')).toBe(digest(bytes));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    mocks.authorize.mockResolvedValueOnce(null);
    expect((await GET(new NextRequest('https://core.example.test/api/internal/precision-cad-commercial/artifacts?jobId=job-1&artifactId=input-1', { headers }))).status).toBe(403);
  });

  it('creates a fixed output identity, accepts exact immutable bytes, then commits readback', async () => {
    const bytes = Buffer.from('ISO-10303-21;\nEND-ISO-10303-21;\n', 'utf8');
    const intent = { artifactId: `model-${digest(bytes).slice(0, 48)}`, role: 'model', contentSha256: digest(bytes), byteLength: bytes.length, mediaType: 'application/step' };
    let row: Record<string, unknown> | undefined;
    mocks.queryOne.mockImplementation(async () => row);
    mocks.execute.mockImplementation(async (sql: string, ...params: unknown[]) => {
      if (sql.startsWith('INSERT')) row = { artifact_id: params[5], artifact_role: params[6], object_key: params[7], content_sha256: params[8], byte_length: params[9], media_type: params[10], worker_identity: params[4], status: 'PENDING', committed_at: null };
      if (sql.startsWith('UPDATE') && row) row.status = 'COMMITTED';
      return { changes: 1 };
    });
    const makePost = (action: string) => new NextRequest('https://core.example.test/api/internal/precision-cad-commercial/artifacts', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ action, jobId: job.jobId, intent }) });
    const grant = await POST(makePost('output-intent'));
    expect(grant.status).toBe(200);
    await expect(grant.json()).resolves.toMatchObject({ ok: true, grant: { uploadMode: 'CORE_PUT', artifact: { role: 'model', contentSha256: digest(bytes) } } });
    const upload = await PUT(new NextRequest('https://core.example.test/api/internal/precision-cad-commercial/artifacts?jobId=job-1&role=model', { method: 'PUT', headers: { ...headers, 'content-type': 'application/step' }, body: bytes }));
    expect(upload.status).toBe(200);
    expect(mocks.upload).toHaveBeenCalledWith(bytes, expect.stringMatching(/^private\/commercial-precision-outputs\//), 'application/step');
    mocks.sha256.mockResolvedValue({ size: bytes.length, contentSha256: digest(bytes) });
    const commit = await POST(makePost('commit-output'));
    expect(commit.status).toBe(200);
    await expect(commit.json()).resolves.toMatchObject({ ok: true, committed: true, artifact: { role: 'model' } });
    expect(row?.status).toBe('COMMITTED');
  });

  it('rejects an invalid action without allocating an output row', async () => {
    const response = await POST(new NextRequest('https://core.example.test/api/internal/precision-cad-commercial/artifacts', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'delete-output', jobId: job.jobId, intent: {} }) }));
    expect(response.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
