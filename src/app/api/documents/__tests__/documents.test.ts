/**
 * Wave 2 Phase 1 Week 4 — cloud document collection endpoint tests.
 *
 * Mocks getAuthUser + getDbAdapter + getStorage to keep these as pure
 * route-handler unit tests (no real SQLite / R2). The DB mock returns a
 * deterministic value per call site (each test wires its own
 * queryOne/queryAll/execute returns to walk the route handler through the
 * branch under test).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@/lib/client-ip', () => ({
  getTrustedClientIpOrUndefined: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/storage', () => ({
  getStorage: vi.fn(() => ({
    uploadRaw: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/file'),
    delete: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: vi.fn(() => ({
    queryOne: vi.fn().mockResolvedValue(undefined),
    queryAll: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue({ changes: 0 }),
  })),
}));

vi.mock('@/lib/cloudDoc/access', async (orig) => {
  const real = await orig<typeof import('@/lib/cloudDoc/access')>();
  return {
    ...real,
    ensureCloudDocTables: vi.fn().mockResolvedValue(undefined),
    ensurePersonalWorkspace: vi.fn(async (_db: unknown, _u: string) => 'ws-personal-1'),
  };
});

import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { NextRequest } from 'next/server';

let GET: typeof import('../route').GET;
let POST: typeof import('../route').POST;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  ({ GET, POST } = await import('../route'));
});

const authedUser = { userId: 'u-alice', email: 'a@x.com', orgIds: [] };

function makeReq(method: string, body?: unknown, query?: string) {
  return new NextRequest(`http://test/api/documents${query ? `?${query}` : ''}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ─── GET ─────────────────────────────────────────────────────────────────────

describe('GET /api/documents', () => {
  it('401 when unauthenticated', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0]);
    expect(res.status).toBe(401);
  });

  it('200 with empty list when user has no documents', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue({ total: 0 }),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ changes: 0 }),
    } as never);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.documents).toEqual([]);
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 20, total: 0 });
  });

  it('200 returns shaped documents (camelCase) for the user', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    const sampleDoc = {
      id: 'd1', owner_id: 'u-alice', workspace_id: 'ws-1',
      name: 'Gear v1', blob_r2_key: 'documents/u-alice/d1/current.ydoc',
      version: 5, nfab_format: 2, yjs_proto: 1,
      thumbnail_r2_key: null, size_bytes: 100,
      feature_count: 3, part_count: 1,
      created_at: 1000, updated_at: 2000,
      last_edited_by: 'u-alice', deleted_at: null,
    };
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue({ total: 1 }),
      queryAll: vi.fn().mockResolvedValue([sampleDoc]),
      execute: vi.fn().mockResolvedValue({ changes: 0 }),
    } as never);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]).toMatchObject({
      id: 'd1', name: 'Gear v1', ownerId: 'u-alice',
      workspaceId: 'ws-1', version: 5, sizeBytes: 100,
    });
  });

  it('respects pageSize clamping (max 100)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    const queryAll = vi.fn().mockResolvedValue([]);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue({ total: 0 }),
      queryAll,
      execute: vi.fn().mockResolvedValue({ changes: 0 }),
    } as never);
    const res = await GET(makeReq('GET', undefined, 'pageSize=999') as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.pageSize).toBe(100); // clamped
  });

  it('passes workspaceId filter through to the query', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    const queryAll = vi.fn().mockResolvedValue([]);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue({ total: 0 }),
      queryAll,
      execute: vi.fn().mockResolvedValue({ changes: 0 }),
    } as never);
    const res = await GET(makeReq('GET', undefined, 'workspaceId=ws-abc') as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    // The SQL string passed in should reference workspace_id
    const calls = queryAll.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const sql = calls[0][0] as string;
    expect(sql).toContain('d.workspace_id = ?');
    // ws-abc should appear in the params
    expect(calls[0]).toContain('ws-abc');
  });
});

// ─── POST ────────────────────────────────────────────────────────────────────

describe('POST /api/documents', () => {
  it('401 when unauthenticated', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const res = await POST(makeReq('POST', { name: 'x' }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });

  it('400 when name missing', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    const res = await POST(makeReq('POST', {}) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('validation.name');
  });

  it('400 when name is too long', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    const longName = 'x'.repeat(201);
    const res = await POST(makeReq('POST', { name: longName }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('400 when JSON is malformed', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    const req = new NextRequest('http://test/api/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json}',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('201 happy path — creates document in Personal workspace by default', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    const execute = vi.fn().mockResolvedValue({ changes: 1 });
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(undefined),
      queryAll: vi.fn().mockResolvedValue([]),
      execute,
    } as never);
    const res = await POST(makeReq('POST', { name: 'My new doc' }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.document.name).toBe('My new doc');
    expect(body.document.ownerId).toBe('u-alice');
    expect(body.document.workspaceId).toBe('ws-personal-1');
    expect(body.document.version).toBe(1);
    // Insert into nf_documents + into nf_document_permissions (owner row).
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('404 when explicit workspaceId does not exist', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    const queryOne = vi.fn().mockResolvedValue(undefined); // workspace row → not found
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne, queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ changes: 0 }),
    } as never);
    const res = await POST(makeReq('POST', { name: 'X', workspaceId: 'ws-missing' }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('workspace.not_found');
  });

  it('403 when workspaceId is set but user has no editor role', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    const queryOne = vi.fn()
      // 1st: workspace lookup — exists, owned by someone else
      .mockResolvedValueOnce({ id: 'ws-9', owner_id: 'u-bob', deleted_at: null })
      // 2nd: workspace membership lookup — viewer
      .mockResolvedValueOnce({ role: 'viewer' });
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne, queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ changes: 0 }),
    } as never);
    const res = await POST(makeReq('POST', { name: 'X', workspaceId: 'ws-9' }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(403);
  });

  it('trims whitespace from name', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(undefined),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ changes: 1 }),
    } as never);
    const res = await POST(makeReq('POST', { name: '   Padded Name   ' }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.document.name).toBe('Padded Name');
  });
});
