import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  access: vi.fn(),
  createPrivateUploadUrl: vi.fn(),
  createMultipart: vi.fn(),
  createPartUrl: vi.fn(),
  ensure: vi.fn(),
  createSession: vi.fn(),
  complete: vi.fn(),
  readSession: vi.fn(),
  listParts: vi.fn(),
  finalizeMultipart: vi.fn(),
  abortMultipart: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: () => true }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ marker: 'db' }) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.access }));
vi.mock('@/lib/storage', () => ({ getStorage: () => ({
  createPrivateUploadUrl: mocks.createPrivateUploadUrl,
  createPrivateMultipartUpload: mocks.createMultipart,
  createPrivateMultipartPartUrl: mocks.createPartUrl,
  listPrivateMultipartParts: vi.fn(),
  completePrivateMultipartUpload: vi.fn(),
  abortPrivateMultipartUpload: vi.fn(),
  sha256: vi.fn(),
}) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => ({ allowed: true, remaining: 9, resetAt: Date.now() + 1_000 }) }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.audit }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIpOrUndefined: () => '127.0.0.1' }));
vi.mock('@/lib/artifacts/directArtifactUploadStore', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/artifacts/directArtifactUploadStore')>();
  return {
    ...actual,
    ensureDirectArtifactUploadTables: mocks.ensure,
    createArtifactUploadSession: mocks.createSession,
    completeArtifactUpload: mocks.complete,
    readOwnedArtifactUploadSession: mocks.readSession,
    listArtifactMultipartParts: mocks.listParts,
    finalizeArtifactMultipartUpload: mocks.finalizeMultipart,
    abortArtifactMultipartUpload: mocks.abortMultipart,
  };
});

import { POST } from './route';

const context = { params: Promise.resolve({ id: 'project-1' }) };
const hash = (char: string) => char.repeat(64);
function request(body: Record<string, unknown>) {
  return new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/artifacts/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://nexyfab.com' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: 'user-1', orgIds: ['org-1'], activeOrgId: 'org-1', orgContextStatus: 'active' });
  mocks.access.mockResolvedValue({ canEdit: true, role: 'owner', ownerUserId: 'user-1', row: { org_id: 'org-1' } });
  mocks.createPrivateUploadUrl.mockResolvedValue({
    key: 'private/artifacts/org-org-1/projects/project-1/id/assembly.step',
    uploadUrl: 'https://bucket.r2.cloudflarestorage.com/object?signature=secret',
  });
  mocks.createMultipart.mockResolvedValue({
    key: 'private/artifacts/org-org-1/projects/project-1/id/building.ifc',
    storageUploadId: 'r2-upload-1',
  });
  mocks.createPartUrl.mockResolvedValue({ uploadUrl: 'https://bucket.r2.cloudflarestorage.com/part?signature=secret' });
  mocks.createSession.mockResolvedValue({
    id: 'upload-1', format: 'step', expected_size: 8192, expires_at: 2_000_000,
  });
  mocks.complete.mockResolvedValue({
    ok: true,
    idempotent: false,
    artifact: { artifactId: 'artifact-1', contentSha256: hash('a') },
  });
  mocks.readSession.mockResolvedValue({ upload_mode: 'SINGLE_PUT', multipart_completed_at: null });
  mocks.listParts.mockResolvedValue({ ok: false, code: 'SESSION_NOT_FOUND' });
  mocks.finalizeMultipart.mockResolvedValue({ ok: true, session: {}, parts: [] });
  mocks.abortMultipart.mockResolvedValue({ ok: true });
});

describe('project artifact direct-upload API', () => {
  it('requires project editor authorization before issuing an R2 URL', async () => {
    mocks.access.mockResolvedValue({ canEdit: false, role: 'viewer', ownerUserId: 'owner', row: { org_id: 'org-1' } });
    const response = await POST(request({
      action: 'intent', filename: 'assembly.step', byteLength: 8192, contentSha256: hash('a'),
    }), context);
    expect(response.status).toBe(403);
    expect(mocks.createPrivateUploadUrl).not.toHaveBeenCalled();
  });

  it('binds a signed PUT to the tenant and project namespace', async () => {
    const response = await POST(request({
      action: 'intent', filename: 'assembly.step', byteLength: 8192, contentSha256: hash('a'),
    }), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      uploadId: 'upload-1', method: 'PUT', contentType: 'application/step',
      verification: 'SERVER_STREAM_SHA256', resumable: false,
    });
    expect(mocks.createPrivateUploadUrl).toHaveBeenCalledWith(
      'assembly.step', 'artifacts/org-org-1/projects/project-1', 'application/step', 900,
    );
    expect(mocks.createSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      projectId: 'project-1', tenantId: 'org-1', userId: 'user-1',
      objectKey: 'private/artifacts/org-org-1/projects/project-1/id/assembly.step',
    }));
  });

  it('completes only by server-owned upload session identity', async () => {
    const response = await POST(request({
      action: 'complete', uploadId: 'upload-1',
      filename: 'tampered.dwg', byteLength: 1, contentSha256: hash('f'),
    }), context);
    expect(response.status).toBe(201);
    expect(mocks.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      uploadId: 'upload-1', projectId: 'project-1', userId: 'user-1',
    }));
    expect(mocks.complete.mock.calls[0]?.[2]).not.toHaveProperty('filename');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'cad.artifact_upload_completed' }));
  });

  it('requires resumable multipart mode for large CAD and BIM artifacts', async () => {
    mocks.createSession.mockResolvedValue({
      id: 'upload-large', format: 'ifc', expected_size: 80 * 1024 * 1024,
      expires_at: Date.now() + 86_400_000,
    });
    const response = await POST(request({
      action: 'intent', filename: 'building.ifc', byteLength: 80 * 1024 * 1024, contentSha256: hash('b'),
    }), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      uploadId: 'upload-large', method: 'MULTIPART_PUT', resumable: true,
      partSizeBytes: 16 * 1024 * 1024, totalParts: 5,
    });
    expect(mocks.createMultipart).toHaveBeenCalledWith(
      'building.ifc', 'artifacts/org-org-1/projects/project-1', 'application/x-step',
    );
    expect(mocks.createSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      uploadMode: 'MULTIPART', storageUploadId: 'r2-upload-1', totalParts: 5,
    }));
    expect(mocks.createPrivateUploadUrl).not.toHaveBeenCalled();
  });

  it('returns authoritative uploaded part state for interruption recovery', async () => {
    mocks.listParts.mockResolvedValue({
      ok: true,
      session: { part_size: 16 * 1024 * 1024, total_parts: 3 },
      parts: [{ partNumber: 1, size: 16 * 1024 * 1024, etag: 'etag-1' }],
    });
    const response = await POST(request({ action: 'status', uploadId: 'upload-large' }), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resumable: true, totalParts: 3,
      uploadedParts: [{ partNumber: 1, etag: 'etag-1' }],
    });
  });

  it('does not reveal a missing or foreign upload session', async () => {
    mocks.complete.mockResolvedValue({ ok: false, code: 'SESSION_NOT_FOUND' });
    const response = await POST(request({ action: 'complete', uploadId: 'upload-other' }), context);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('bounds upload control JSON and rejects invalid UTF-8 before side effects', async () => {
    const url = 'https://nexyfab.com/api/nexyfab/projects/project-1/artifacts/uploads';
    const oversized = await POST(new NextRequest(url, { method: 'POST', headers: { origin: 'https://nexyfab.com', 'content-length': '4097' }, body: '{}' }), context);
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toEqual({ error: 'Upload request too large' });
    const malformed = await POST(new NextRequest(url, { method: 'POST', headers: { origin: 'https://nexyfab.com' }, body: new Uint8Array([0xff]) }), context);
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({ error: 'Invalid JSON' });
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
