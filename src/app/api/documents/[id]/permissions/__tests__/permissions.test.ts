/**
 * Wave 2 Phase 1 Week 4 — document permission endpoint tests.
 *
 * Asserts:
 *  - 401 unauth
 *  - 404 no access
 *  - 403 non-owner cannot mutate ACL
 *  - 400 validation (missing fields, bad role, expiresAt past)
 *  - 404 target user not found
 *  - 200/201 happy paths (insert vs update upsert)
 *  - self-grant blocked
 *  - multi-owner blocked
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
let POST: typeof import('../route').POST;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  ({ GET, POST } = await import('../route'));
});

const ownerUser = { userId: 'u-alice', email: 'a@x.com', orgIds: [] };
const otherUser = { userId: 'u-bob', email: 'b@x.com', orgIds: [] };

function makeDocRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'd1', owner_id: 'u-alice', workspace_id: 'ws-1',
    name: 'doc', blob_r2_key: 'documents/u-alice/d1/current.ydoc',
    version: 1, nfab_format: 2, yjs_proto: 1,
    thumbnail_r2_key: null, size_bytes: 0,
    feature_count: 0, part_count: 0,
    created_at: 1, updated_at: 2,
    last_edited_by: 'u-alice', deleted_at: null,
    ...over,
  };
}

function makeReq(method: string, body?: unknown) {
  return new NextRequest('http://test/api/documents/d1/permissions', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const idParams = { params: Promise.resolve({ id: 'd1' }) };

// ─── GET ─────────────────────────────────────────────────────────────────────

describe('GET /api/documents/[id]/permissions', () => {
  it('401 unauth', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0], idParams);
    expect(res.status).toBe(401);
  });

  it('404 when no access', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(otherUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue(null);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0], idParams);
    expect(res.status).toBe(404);
  });

  it('200 returns shaped permission list (visible to viewer+)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(otherUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(),
      role: 'viewer',
      canEdit: false,
      canManage: false,
    } as never);
    const permRows = [
      {
        document_id: 'd1', user_id: 'u-alice', role: 'owner',
        granted_by: 'u-alice', granted_at: 100, expires_at: null,
      },
      {
        document_id: 'd1', user_id: 'u-bob', role: 'viewer',
        granted_by: 'u-alice', granted_at: 200, expires_at: null,
      },
    ];
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(undefined),
      queryAll: vi.fn().mockResolvedValue(permRows),
      execute: vi.fn().mockResolvedValue({ changes: 0 }),
    } as never);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0], idParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.permissions).toHaveLength(2);
    expect(body.permissions[0]).toMatchObject({ userId: 'u-alice', role: 'owner' });
    expect(body.permissions[1]).toMatchObject({ userId: 'u-bob', role: 'viewer' });
  });
});

// ─── POST ────────────────────────────────────────────────────────────────────

describe('POST /api/documents/[id]/permissions', () => {
  it('401 unauth', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const res = await POST(makeReq('POST', { userId: 'u-bob', role: 'viewer' }) as Parameters<typeof POST>[0], idParams);
    expect(res.status).toBe(401);
  });

  it('404 when no access', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(otherUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue(null);
    const res = await POST(makeReq('POST', { userId: 'u-c', role: 'viewer' }) as Parameters<typeof POST>[0], idParams);
    expect(res.status).toBe(404);
  });

  it('403 when caller is editor (not owner)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(otherUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(),
      role: 'editor',
      canEdit: true,
      canManage: false,
    } as never);
    const res = await POST(makeReq('POST', { userId: 'u-c', role: 'viewer' }) as Parameters<typeof POST>[0], idParams);
    expect(res.status).toBe(403);
  });

  it('400 missing userId', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(ownerUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(), role: 'owner', canEdit: true, canManage: true,
    } as never);
    const res = await POST(makeReq('POST', { role: 'viewer' }) as Parameters<typeof POST>[0], idParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('validation.userId');
  });

  it('400 invalid role string', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(ownerUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(), role: 'owner', canEdit: true, canManage: true,
    } as never);
    const res = await POST(makeReq('POST', { userId: 'u-c', role: 'godmode' }) as Parameters<typeof POST>[0], idParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('validation.role');
  });

  it('400 expiresAt in past', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(ownerUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(), role: 'owner', canEdit: true, canManage: true,
    } as never);
    const res = await POST(
      makeReq('POST', { userId: 'u-c', role: 'viewer', expiresAt: 1 }) as Parameters<typeof POST>[0],
      idParams,
    );
    expect(res.status).toBe(400);
  });

  it('404 when target user does not exist', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(ownerUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(), role: 'owner', canEdit: true, canManage: true,
    } as never);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(undefined), // nf_users → not found
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ changes: 0 }),
    } as never);
    const res = await POST(makeReq('POST', { userId: 'u-ghost', role: 'viewer' }) as Parameters<typeof POST>[0], idParams);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('user.not_found');
  });

  it('400 self-grant blocked', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(ownerUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(), role: 'owner', canEdit: true, canManage: true,
    } as never);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue({ id: 'u-alice' }),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ changes: 0 }),
    } as never);
    const res = await POST(makeReq('POST', { userId: 'u-alice', role: 'viewer' }) as Parameters<typeof POST>[0], idParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('permission.self');
  });

  it('400 multi-owner blocked (cannot grant role=owner)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(ownerUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(), role: 'owner', canEdit: true, canManage: true,
    } as never);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue({ id: 'u-bob' }),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ changes: 0 }),
    } as never);
    const res = await POST(makeReq('POST', { userId: 'u-bob', role: 'owner' }) as Parameters<typeof POST>[0], idParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('permission.multi_owner');
  });

  it('201 happy path — grants viewer to a new user', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(ownerUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(), role: 'owner', canEdit: true, canManage: true,
    } as never);
    const execute = vi.fn().mockResolvedValue({ changes: 1 });
    const queryOne = vi.fn()
      .mockResolvedValueOnce({ id: 'u-bob' })   // nf_users
      .mockResolvedValueOnce(undefined);         // existing permission row (none)
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne, queryAll: vi.fn().mockResolvedValue([]), execute,
    } as never);
    const res = await POST(makeReq('POST', { userId: 'u-bob', role: 'viewer' }) as Parameters<typeof POST>[0], idParams);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.permission).toMatchObject({ userId: 'u-bob', role: 'viewer', grantedBy: 'u-alice' });
  });

  it('200 upsert path — updates existing permission row', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(ownerUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(), role: 'owner', canEdit: true, canManage: true,
    } as never);
    const execute = vi.fn().mockResolvedValue({ changes: 1 });
    const queryOne = vi.fn()
      .mockResolvedValueOnce({ id: 'u-bob' })
      .mockResolvedValueOnce({
        document_id: 'd1', user_id: 'u-bob', role: 'viewer',
        granted_by: 'u-alice', granted_at: 100, expires_at: null,
      });
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne, queryAll: vi.fn().mockResolvedValue([]), execute,
    } as never);
    const res = await POST(makeReq('POST', { userId: 'u-bob', role: 'editor' }) as Parameters<typeof POST>[0], idParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.permission.role).toBe('editor');
  });
});
