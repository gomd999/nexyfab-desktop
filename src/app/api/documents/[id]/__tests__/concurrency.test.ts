/**
 * D1 (PDM) — PUT /api/documents/[id] optimistic concurrency tests.
 *
 * Asserts:
 *  - body.ifMatchVersion = current → 200 + version bumps
 *  - body.ifMatchVersion = stale → 409 with serverVersion + clientExpected
 *  - body.ifMatchVersion = undefined → bypasses check (pass)
 *  - validation: non-finite number → 400
 *  - audit event document.update_conflict fires only on 409
 *  - happy path with no ifMatch still bumps version
 *
 * Scenario covered: "Alice + Bob both load doc at v=2; Bob renames first
 * (now v=3); Alice tries to rename with ifMatchVersion=2 → 409."
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

vi.mock('@/lib/cloudDoc/access', () => ({
  ensureCloudDocTables: vi.fn().mockResolvedValue(undefined),
  resolveDocAccess: vi.fn(),
}));

import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { logAudit } from '@/lib/audit';
import { resolveDocAccess } from '@/lib/cloudDoc/access';
import { NextRequest } from 'next/server';

let PUT: typeof import('../route').PUT;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  ({ PUT } = await import('../route'));
});

const owner = { userId: 'u-alice', email: 'a@x.com', orgIds: [] };

function makeDocRow(version: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'd1', owner_id: 'u-alice', workspace_id: 'ws-1',
    name: 'doc', blob_r2_key: 'documents/u-alice/d1/current.ydoc',
    version, nfab_format: 2, yjs_proto: 1,
    thumbnail_r2_key: null, size_bytes: 0,
    feature_count: 0, part_count: 0,
    created_at: 1000, updated_at: 2000,
    last_edited_by: 'u-alice', deleted_at: null,
    ...over,
  };
}

function makeReq(body: unknown) {
  return new NextRequest('http://test/api/documents/d1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: 'http://test' },
    body: JSON.stringify(body),
  });
}

const idParams = { params: Promise.resolve({ id: 'd1' }) };

describe('PUT /api/documents/[id] — D1 optimistic concurrency', () => {
  it('200 + version bump when ifMatchVersion matches server', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(owner as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(3),
      role: 'owner', canEdit: true, canManage: true,
    } as never);
    const execute = vi.fn().mockResolvedValue({ changes: 1 });
    const queryOne = vi.fn().mockResolvedValue(makeDocRow(4, { name: 'renamed' }));
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne, queryAll: vi.fn().mockResolvedValue([]), execute,
    } as never);

    const res = await PUT(makeReq({ name: 'renamed', ifMatchVersion: 3 }) as Parameters<typeof PUT>[0], idParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.document.version).toBe(4);
    expect(body.document.name).toBe('renamed');
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('version          = version + 1'),
      'renamed', 0, null, 0, null, expect.any(Number), 'u-alice', 'd1',
    );
  });

  it('409 with serverVersion + clientExpected when client is stale', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(owner as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(5),
      role: 'owner', canEdit: true, canManage: true,
    } as never);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn(), queryAll: vi.fn(), execute: vi.fn(),
    } as never);

    const res = await PUT(makeReq({ name: 'stale-rename', ifMatchVersion: 2 }) as Parameters<typeof PUT>[0], idParams);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('document.version_conflict');
    expect(body.serverVersion).toBe(5);
    expect(body.clientExpected).toBe(2);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'document.update_conflict',
      resourceId: 'd1',
      metadata: { clientExpected: 2, serverVersion: 5 },
    }));
  });

  it('200 when ifMatchVersion is undefined (caller opts out of concurrency check)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(owner as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(7),
      role: 'owner', canEdit: true, canManage: true,
    } as never);
    const queryOne = vi.fn().mockResolvedValue(makeDocRow(8, { name: 'no-ifmatch' }));
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne, queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ changes: 1 }),
    } as never);

    const res = await PUT(makeReq({ name: 'no-ifmatch' }) as Parameters<typeof PUT>[0], idParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.document.version).toBe(8);
  });

  it('400 when ifMatchVersion is non-finite (NaN / Infinity)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(owner as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(1),
      role: 'owner', canEdit: true, canManage: true,
    } as never);

    const res = await PUT(makeReq({ name: 'x', ifMatchVersion: 'not-a-number' as unknown as number }) as Parameters<typeof PUT>[0], idParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('validation.ifMatchVersion');
  });

  it('happy path with no ifMatch still bumps version (audit log normal)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(owner as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(10),
      role: 'owner', canEdit: true, canManage: true,
    } as never);
    const execute = vi.fn().mockResolvedValue({ changes: 1 });
    const queryOne = vi.fn().mockResolvedValue(makeDocRow(11, { name: 'fresh' }));
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne, queryAll: vi.fn().mockResolvedValue([]), execute,
    } as never);

    const res = await PUT(makeReq({ name: 'fresh' }) as Parameters<typeof PUT>[0], idParams);
    expect(res.status).toBe(200);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'document.update',
    }));
    expect(logAudit).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'document.update_conflict',
    }));
  });

  it('two-peer race scenario — Alice loses to Bob (canonical D1 case)', async () => {
    // Bob commits first: server now at v=3 (was v=2 when Alice loaded).
    // Alice's PUT with ifMatchVersion=2 must 409.
    vi.mocked(getAuthUser).mockResolvedValue(owner as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(3, { name: 'bob-renamed-it' }),
      role: 'owner', canEdit: true, canManage: true,
    } as never);

    const res = await PUT(makeReq({ name: 'alice-also-renames', ifMatchVersion: 2 }) as Parameters<typeof PUT>[0], idParams);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('document.version_conflict');
    expect(body.serverVersion).toBe(3);
    expect(body.clientExpected).toBe(2);
  });
});
