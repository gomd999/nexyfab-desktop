import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  access: vi.fn(),
  origin: vi.fn(() => true),
  assertRevision: vi.fn(),
  catalog: vi.fn(),
  turn: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: mocks.origin }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({ backend: 'sqlite' }) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.access }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIpOrUndefined: () => '127.0.0.1' }));
vi.mock('@/lib/cad/workspaceRevisionStore', () => ({ ensureCadWorkspaceRevisionTables: vi.fn() }));
vi.mock('@/lib/precision-cad-agent/remoteAgentApi', () => ({
  assertRemoteProjectRevision: mocks.assertRevision,
  hashRemoteInitialTurnRequest: () => 'a'.repeat(64),
  loadInstallerCoreCatalog: mocks.catalog,
  runRemoteAgentTurn: mocks.turn,
  validateRemoteBinding: () => true,
}));
vi.mock('@/lib/precision-cad-agent/remoteCadContract', () => ({
  REMOTE_PRECISION_CAD_CONTRACT_VERSION: 'nexyfab.remote-precision-cad.v1',
  validateRemotePrecisionCadTurnRequest: () => [],
}));

import { POST } from './route';

const url = 'https://nexyfab.com/api/nexyfab/projects/project-1/precision-cad-agent/turn';
const context = { params: Promise.resolve({ id: 'project-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.origin.mockReturnValue(true);
  mocks.auth.mockResolvedValue({ userId: 'user-1' });
  mocks.access.mockResolvedValue({ role: 'editor', canEdit: true });
});

describe('remote precision CAD turn request body boundary', () => {
  it('rejects a declared oversized body before revision/provider work', async () => {
    const response = await POST(new NextRequest(url, {
      method: 'POST',
      headers: { origin: 'https://nexyfab.com', 'content-length': String(180 * 1024 + 1) },
      body: '{}',
    }), context);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'ARGUMENTS_TOO_LARGE' } });
    expect(mocks.assertRevision).not.toHaveBeenCalled();
    expect(mocks.turn).not.toHaveBeenCalled();
  });

  it('measures and cancels a chunked body that lies about Content-Length', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(180 * 1024));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() { cancelled = true; },
    });
    const init = {
      method: 'POST',
      headers: { origin: 'https://nexyfab.com', 'content-length': '1' },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' };
    const response = await POST(new NextRequest(url, init as never), context);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'ARGUMENTS_TOO_LARGE' } });
    expect(cancelled).toBe(true);
    expect(mocks.turn).not.toHaveBeenCalled();
  });

  it('rejects invalid UTF-8 as INVALID_REQUEST before revision/provider work', async () => {
    const response = await POST(new NextRequest(url, {
      method: 'POST',
      headers: { origin: 'https://nexyfab.com' },
      body: new Uint8Array([0xff]),
    }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(mocks.assertRevision).not.toHaveBeenCalled();
    expect(mocks.turn).not.toHaveBeenCalled();
  });

  it('requires an idempotency key before the first provider turn', async () => {
    mocks.assertRevision.mockResolvedValue(null);
    mocks.catalog.mockResolvedValue([]);
    const response = await POST(new NextRequest(url, {
      method: 'POST',
      headers: { origin: 'https://nexyfab.com', 'content-type': 'application/json' },
      body: JSON.stringify({
        contractVersion: 'nexyfab.remote-precision-cad.v1', runId: 'run-1',
        binding: { projectId: 'project-1', revision: 1, updatedAt: 123 },
        provider: 'openai', model: 'gpt-5.6-luna', instructions: 'check',
        input: [{ role: 'user', content: 'check' }], tools: [], scope: 'read',
      }),
    }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'INITIAL_TURN_IDEMPOTENCY_KEY_REQUIRED' } });
    expect(mocks.turn).not.toHaveBeenCalled();
  });

  it('accepts the legacy prior_provider_state alias as a continuation', async () => {
    mocks.assertRevision.mockResolvedValue(null);
    mocks.catalog.mockResolvedValue([]);
    mocks.turn.mockResolvedValue({ ok: true, assistant_text: 'done', tool_calls: [], provider_state: { handle: 'next-state' }, finish_status: 'completed' });
    const response = await POST(new NextRequest(url, {
      method: 'POST',
      headers: { origin: 'https://nexyfab.com', 'content-type': 'application/json' },
      body: JSON.stringify({
        contractVersion: 'nexyfab.remote-precision-cad.v1', runId: 'run-1',
        binding: { projectId: 'project-1', revision: 1, updatedAt: 123 },
        provider: 'openai', model: 'gpt-5.6-luna', instructions: 'continue',
        input: [{ role: 'tool', content: '{}', call_id: 'call-1', name: 'list_domains' }],
        tools: [], scope: 'read', prior_provider_state: { handle: 'previous-state' },
      }),
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.turn).toHaveBeenCalledWith(expect.objectContaining({ priorProviderState: { handle: 'previous-state' }, initialIdempotency: undefined }));
  });
});
