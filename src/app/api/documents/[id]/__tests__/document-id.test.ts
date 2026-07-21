/**
 * Wave 2 Phase 1 Week 4 — single-document endpoint tests.
 *
 * GET / PUT / DELETE branches:
 *  - 401 unauth
 *  - 404 no access (never leak existence)
 *  - 403 read-only PUT, non-owner DELETE
 *  - 200 happy path
 *  - PUT undelete + restore-window edge
 *  - Cross-user attempt → 404
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
    getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/doc.ydoc'),
    download: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    uploadRaw: vi.fn().mockResolvedValue(undefined),
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
    resolveDocAccess: vi.fn(),
  };
});

import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveDocAccess } from '@/lib/cloudDoc/access';
import { NextRequest } from 'next/server';

let GET: typeof import('../route').GET;
let PUT: typeof import('../route').PUT;
let DELETE: typeof import('../route').DELETE;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  ({ GET, PUT, DELETE } = await import('../route'));
});

const authedUser = { userId: 'u-alice', email: 'a@x.com', orgIds: [] };

function makeDocRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'd1', owner_id: 'u-alice', workspace_id: 'ws-1',
    name: 'doc', blob_r2_key: 'documents/u-alice/d1/current.ydoc',
    version: 1, nfab_format: 2, yjs_proto: 1,
    thumbnail_r2_key: null, size_bytes: 0,
    feature_count: 0, part_count: 0,
    created_at: 1000, updated_at: 2000,
    last_edited_by: 'u-alice', deleted_at: null,
    ...over,
  };
}

function makeReq(method: string, body?: unknown, query?: string) {
  return new NextRequest(`http://test/api/documents/d1${query ? `?${query}` : ''}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const idParams = { params: Promise.resolve({ id: 'd1' }) };

// ─── GET ─────────────────────────────────────────────────────────────────────

describe('GET /api/documents/[id]', () => {
  it('401 when unauthenticated', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0], idParams);
    expect(res.status).toBe(401);
  });

  it('404 when no access (resolveDocAccess returns null)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue(null);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0], idParams);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('document.not_found');
  });

  it('200 returns shaped document + signed URL for owner', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(),
      role: 'owner',
      canEdit: true,
      canManage: true,
    } as never);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0], idParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.document.id).toBe('d1');
    expect(body.document.role).toBe('owner');
    expect(body.blobUrl).toBe('https://signed.example/doc.ydoc');
    expect(body.blobUrlExpiresAt).toBeGreaterThan(Date.now());
  });

  it('200 returns role=viewer for read-only access', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: 'u-bob', email: 'b@x.com', orgIds: [] } as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(),
      role: 'viewer',
      canEdit: false,
      canManage: false,
    } as never);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0], idParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.document.role).toBe('viewer');
  });

  it('cross-user attempt: returns 404 if no access (existence not leaked)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: 'u-mallory', orgIds: [] } as never);
    vi.mocked(resolveDocAccess).mockResolvedValue(null);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0], idParams);
    expect(res.status).toBe(404);
  });
});

// ─── PUT ─────────────────────────────────────────────────────────────────────

describe('PUT /api/documents/[id]', () => {
  it('401 unauth', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const res = await PUT(makeReq('PUT', { name: 'new' }) as Parameters<typeof PUT>[0], idParams);
    expect(res.status).toBe(401);
  });

  it('404 when no access', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue(null);
    const res = await PUT(makeReq('PUT', { name: 'new' }) as Parameters<typeof PUT>[0], idParams);
    expect(res.status).toBe(404);
  });

  it('403 when caller is read-only viewer', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: 'u-bob', orgIds: [] } as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(),
      role: 'viewer',
      canEdit: false,
      canManage: false,
    } as never);
    const res = await PUT(makeReq('PUT', { name: 'cant change' }) as Parameters<typeof PUT>[0], idParams);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('document.permission_denied');
  });

  it('400 invalid name validation', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(),
      role: 'owner',
      canEdit: true,
      canManage: true,
    } as never);
    const res = await PUT(makeReq('PUT', { name: '' }) as Parameters<typeof PUT>[0], idParams);
    expect(res.status).toBe(400);
  });

  it('200 happy path — owner updates name', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(),
      role: 'owner',
      canEdit: true,
      canManage: true,
    } as never);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(makeDocRow({ name: 'Renamed', updated_at: 9999 })),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ changes: 1 }),
    } as never);
    const res = await PUT(makeReq('PUT', { name: 'Renamed' }) as Parameters<typeof PUT>[0], idParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.document.name).toBe('Renamed');
  });

  it('403 when editor tries to change workspaceId (owner-only)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: 'u-charlie', orgIds: [] } as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(),
      role: 'editor',
      canEdit: true,
      canManage: false,
    } as never);
    const res = await PUT(makeReq('PUT', { workspaceId: 'ws-new' }) as Parameters<typeof PUT>[0], idParams);
    expect(res.status).toBe(403);
  });

  it('undelete: 403 when non-owner attempts', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: 'u-bob', orgIds: [] } as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow({ deleted_at: Date.now() - 1000 }),
      role: 'editor',
      canEdit: true,
      canManage: false,
    } as never);
    const res = await PUT(makeReq('PUT', {}, 'undelete=1') as Parameters<typeof PUT>[0], idParams);
    expect(res.status).toBe(403);
  });

  it('undelete: 400 when doc not deleted', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(), // deleted_at = null
      role: 'owner',
      canEdit: true,
      canManage: true,
    } as never);
    const res = await PUT(makeReq('PUT', {}, 'undelete=1') as Parameters<typeof PUT>[0], idParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('document.not_deleted');
  });

  it('undelete: 410 when past 90-day restore window', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    const old = Date.now() - 91 * 24 * 60 * 60 * 1000;
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow({ deleted_at: old }),
      role: 'owner',
      canEdit: true,
      canManage: true,
    } as never);
    const res = await PUT(makeReq('PUT', {}, 'undelete=1') as Parameters<typeof PUT>[0], idParams);
    expect(res.status).toBe(410);
  });

  it('undelete: 200 happy path restore by owner within window', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow({ deleted_at: Date.now() - 1000 }),
      role: 'owner',
      canEdit: true,
      canManage: true,
    } as never);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(makeDocRow({ deleted_at: null })),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ changes: 1 }),
    } as never);
    const res = await PUT(makeReq('PUT', {}, 'undelete=1') as Parameters<typeof PUT>[0], idParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.document.deletedAt).toBeNull();
  });
});

// ─── DELETE ──────────────────────────────────────────────────────────────────

describe('DELETE /api/documents/[id]', () => {
  it('401 unauth', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const res = await DELETE(makeReq('DELETE') as Parameters<typeof DELETE>[0], idParams);
    expect(res.status).toBe(401);
  });

  it('404 when no access (cross-user attempt)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: 'u-mallory', orgIds: [] } as never);
    vi.mocked(resolveDocAccess).mockResolvedValue(null);
    const res = await DELETE(makeReq('DELETE') as Parameters<typeof DELETE>[0], idParams);
    expect(res.status).toBe(404);
  });

  it('403 when editor (non-owner) tries to delete', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: 'u-bob', orgIds: [] } as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(),
      role: 'editor',
      canEdit: true,
      canManage: false,
    } as never);
    const res = await DELETE(makeReq('DELETE') as Parameters<typeof DELETE>[0], idParams);
    expect(res.status).toBe(403);
  });

  it('200 owner soft-deletes', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(),
      role: 'owner',
      canEdit: true,
      canManage: true,
    } as never);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(undefined),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ changes: 1 }),
    } as never);
    const res = await DELETE(makeReq('DELETE') as Parameters<typeof DELETE>[0], idParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.deletedAt).toBe('number');
    expect(body.restoreUntil - body.deletedAt).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it('200 idempotent on already-deleted doc (no double-delete)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(),
      role: 'owner',
      canEdit: true,
      canManage: true,
    } as never);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(undefined),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ changes: 0 }), // already deleted
    } as never);
    const res = await DELETE(makeReq('DELETE') as Parameters<typeof DELETE>[0], idParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyDeleted).toBe(true);
  });
});
