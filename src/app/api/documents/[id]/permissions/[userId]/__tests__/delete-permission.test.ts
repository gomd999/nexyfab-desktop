/**
 * DELETE /api/documents/[id]/permissions/[userId] — revoke permission tests.
 *
 * Covers F-Z-05 perm-denial surface from the Phase 3 master tracker:
 *  - 401 unauth
 *  - 403 invalid origin
 *  - 404 no access (anti-enumeration: matches GET/POST)
 *  - 403 non-owner cannot revoke
 *  - 400 cannot revoke the doc owner row
 *  - 200 idempotent revoke (no row present → changed:false)
 *  - 200 happy path → execute + audit fired
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: vi.fn(),
}));

vi.mock('@/lib/csrf', () => ({
  checkOrigin: vi.fn(() => true),
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
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { logAudit } from '@/lib/audit';
import { resolveDocAccess } from '@/lib/cloudDoc/access';
import { NextRequest } from 'next/server';

let DELETE: typeof import('../route').DELETE;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.mocked(checkOrigin).mockReturnValue(true);
  ({ DELETE } = await import('../route'));
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

function makeReq() {
  return new NextRequest('http://test/api/documents/d1/permissions/u-bob', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
  });
}

const params = { params: Promise.resolve({ id: 'd1', userId: 'u-bob' }) };

describe('DELETE /api/documents/[id]/permissions/[userId]', () => {
  it('403 when origin check fails', async () => {
    vi.mocked(checkOrigin).mockReturnValueOnce(false);
    const res = await DELETE(makeReq() as Parameters<typeof DELETE>[0], params);
    expect(res.status).toBe(403);
  });

  it('401 unauth', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const res = await DELETE(makeReq() as Parameters<typeof DELETE>[0], params);
    expect(res.status).toBe(401);
  });

  it('404 when no access (anti-enumeration)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(otherUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue(null);
    const res = await DELETE(makeReq() as Parameters<typeof DELETE>[0], params);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('document.not_found');
  });

  it('403 when caller is editor (not owner)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(otherUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(),
      role: 'editor',
      canEdit: true,
      canManage: false,
    } as never);
    const res = await DELETE(makeReq() as Parameters<typeof DELETE>[0], params);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('document.permission_denied');
  });

  it('400 cannot revoke the doc owner row', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(ownerUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow({ owner_id: 'u-alice' }),
      role: 'owner', canEdit: true, canManage: true,
    } as never);
    const ownerParams = { params: Promise.resolve({ id: 'd1', userId: 'u-alice' }) };
    const res = await DELETE(makeReq() as Parameters<typeof DELETE>[0], ownerParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('permission.owner_protected');
  });

  it('200 idempotent revoke — no row present returns changed:false', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(ownerUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(), role: 'owner', canEdit: true, canManage: true,
    } as never);
    const execute = vi.fn().mockResolvedValue({ changes: 0 });
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(undefined),
      queryAll: vi.fn().mockResolvedValue([]),
      execute,
    } as never);
    const res = await DELETE(makeReq() as Parameters<typeof DELETE>[0], params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, changed: false });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('200 happy path — execute + audit fired', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(ownerUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(), role: 'owner', canEdit: true, canManage: true,
    } as never);
    const execute = vi.fn().mockResolvedValue({ changes: 1 });
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(undefined),
      queryAll: vi.fn().mockResolvedValue([]),
      execute,
    } as never);
    const res = await DELETE(makeReq() as Parameters<typeof DELETE>[0], params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, changed: true });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM nf_document_permissions'),
      'd1', 'u-bob',
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'document.permission_revoke',
      resourceId: 'd1',
      metadata: { targetUserId: 'u-bob' },
    }));
  });
});
