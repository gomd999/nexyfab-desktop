import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(), configured: vi.fn(), ensure: vi.fn(), cleanup: vi.fn(), persist: vi.fn(), audit: vi.fn(), enrich: vi.fn(),
}));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: () => true }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ marker: 'db' }) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.access }));
vi.mock('@/lib/artifacts/directArtifactUploadStore', () => ({ resolveArtifactTenantId: (org: unknown, owner: string) => typeof org === 'string' ? org : `personal:${owner}` }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.audit }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIpOrUndefined: () => '127.0.0.1' }));
vi.mock('@/lib/cad/assemblyDrawingHandoffStore', () => ({
  ASSEMBLY_DRAWING_HANDOFF_MAX_BYTES: 8 * 1024 * 1024,
  isAssemblyDrawingHandoffStorageConfigured: mocks.configured,
  ensureAssemblyDrawingHandoffTable: mocks.ensure,
  cleanupExpiredAssemblyDrawingHandoffs: mocks.cleanup,
  persistAssemblyDrawingHandoff: mocks.persist,
}));
vi.mock('@/app/[lang]/shape-generator/drawing/exactSinglePartServerHandoff', () => ({
  enrichServerDrawingHandoffWithExactSinglePart: mocks.enrich,
}));

import { POST } from './route';

const context = { params: Promise.resolve({ id: 'project-1' }) };
const request = (body: unknown) => new NextRequest('https://nexyfab.com/api/nexyfab/projects/project-1/drawing-handoffs', {
  method: 'POST', headers: { origin: 'https://nexyfab.com', 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: 'editor-1' });
  mocks.access.mockResolvedValue({ canEdit: true, ownerUserId: 'owner-1', row: { org_id: 'org-1' } });
  mocks.configured.mockReturnValue(true);
  mocks.enrich.mockImplementation(async (handoff: unknown) => ({ status: 'NOT_RUN', reason: 'fixture', handoff }));
  mocks.persist.mockResolvedValue({ ok: true, idempotent: false, stored: { handoffId: 'id-1', payloadSha256: 'b'.repeat(64), byteLength: 100, expiresAt: 2000, sourceRevision: 4, sourceContentSha256: 'a'.repeat(64) } });
});

describe('assembly drawing handoff POST API', () => {
  it('requires authentication and tenant project access before touching storage', async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await POST(request({}), context)).status).toBe(401);
    mocks.auth.mockResolvedValue({ userId: 'outsider' });
    mocks.access.mockResolvedValue(null);
    expect((await POST(request({}), context)).status).toBe(404);
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('forbids viewer writes while keeping storage untouched', async () => {
    mocks.access.mockResolvedValue({ canEdit: false, ownerUserId: 'owner-1', row: { org_id: 'org-1' } });
    expect((await POST(request({ expectedRevision: 4, expectedContentSha256: 'a'.repeat(64), handoff: {} }), context)).status).toBe(403);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('returns NOT_CONFIGURED instead of treating ephemeral fallback as durable', async () => {
    mocks.configured.mockReturnValue(false);
    const response = await POST(request({ expectedRevision: 4, expectedContentSha256: 'a'.repeat(64), handoff: {} }), context);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: 'HANDOFF_STORAGE_NOT_CONFIGURED' });
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('binds editor writes to the resolved tenant and maps optimistic conflicts', async () => {
    mocks.persist.mockResolvedValueOnce({ ok: false, code: 'REVISION_CONFLICT', currentRevision: 5, currentContentSha256: 'c'.repeat(64) });
    const response = await POST(request({ expectedRevision: 4, expectedContentSha256: 'a'.repeat(64), handoff: { schema: 'x' } }), context);
    expect(response.status).toBe(409);
    expect(mocks.persist).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ projectId: 'project-1', tenantId: 'org-1', userId: 'editor-1', expectedRevision: 4 }));
  });

  it('rejects client-forged downstream evidence before persistence', async () => {
    mocks.enrich.mockResolvedValueOnce({ status: 'INVALID_INPUT', reason: 'CLIENT_DOWNSTREAM_EVIDENCE_FORBIDDEN', handoff: {} });
    const response = await POST(request({
      expectedRevision: 4,
      expectedContentSha256: 'a'.repeat(64),
      handoff: { artifacts: { drawing: { status: 'PASS' } } },
    }), context);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: 'CLIENT_DOWNSTREAM_EVIDENCE_FORBIDDEN' });
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('rejects chunked oversized bytes despite a false length and cancels before persistence', async () => {
    let cancelled = false;
    const init = {
      method: 'POST', headers: { origin: 'https://nexyfab.com', 'content-length': '1' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"handoff":"'));
          controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 64 * 1024));
        },
        cancel() { cancelled = true; },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' };
    const response = await POST(new NextRequest(
      'https://nexyfab.com/api/nexyfab/projects/project-1/drawing-handoffs',
      init as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>,
    ), context);
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
