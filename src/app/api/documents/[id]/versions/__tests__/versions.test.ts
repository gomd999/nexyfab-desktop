/**
 * Wave 2 Phase 1 Week 4 — document version endpoint tests.
 *
 * Asserts:
 *  - 401 unauth
 *  - 404 no access
 *  - 403 read-only
 *  - happy paths for GET / POST
 *  - branch+parent validation
 *  - version counter bump
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/v.ydoc'),
}));

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
    download: vi.fn().mockResolvedValue(Buffer.from('snapshot-data')),
    uploadRaw: vi.fn().mockResolvedValue(undefined),
    getSignedUrl: storageMocks.getSignedUrl,
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
let POST: typeof import('../route').POST;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  ({ GET, POST } = await import('../route'));
});

const authedUser = { userId: 'u-alice', email: 'a@x.com', orgIds: [] };

function makeDocRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'd1', owner_id: 'u-alice', workspace_id: 'ws-1',
    name: 'doc', blob_r2_key: 'documents/u-alice/d1/current.ydoc',
    version: 3, nfab_format: 2, yjs_proto: 1,
    thumbnail_r2_key: null, size_bytes: 100,
    feature_count: 0, part_count: 0,
    created_at: 1000, updated_at: 2000,
    last_edited_by: 'u-alice', deleted_at: null,
    ...over,
  };
}

function makeReq(method: string, body?: unknown, query?: string) {
  return new NextRequest(`http://test/api/documents/d1/versions${query ? `?${query}` : ''}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const idParams = { params: Promise.resolve({ id: 'd1' }) };

// ─── GET ─────────────────────────────────────────────────────────────────────

describe('GET /api/documents/[id]/versions', () => {
  it('401 unauth', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0], idParams);
    expect(res.status).toBe(401);
  });

  it('404 when no access', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue(null);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0], idParams);
    expect(res.status).toBe(404);
  });

  it('200 returns versions list for viewer+', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(),
      role: 'viewer',
      canEdit: false,
      canManage: false,
    } as never);
    const versionRows = [
      {
        id: 'v1', document_id: 'd1', parent_version_id: null,
        blob_r2_key: 'documents/u-alice/d1/versions/v3.ydoc',
        oplog_r2_key: null, label: 'milestone', branch_name: null,
        is_explicit: 1, size_bytes: 200, created_by: 'u-alice', created_at: 1500,
      },
    ];
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(undefined),
      queryAll: vi.fn().mockResolvedValue(versionRows),
      execute: vi.fn().mockResolvedValue({ changes: 0 }),
    } as never);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0], idParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versions).toHaveLength(1);
    expect(body.versions[0]).toMatchObject({
      id: 'v1', label: 'milestone', isExplicit: true, sizeBytes: 200,
      blobUrl: 'https://signed.example/v.ydoc',
    });
    expect(body.versions[0].blobUrlExpiresAt).toEqual(expect.any(Number));
    expect(storageMocks.getSignedUrl).toHaveBeenCalledWith(
      'documents/u-alice/d1/versions/v3.ydoc',
      600,
    );
    expect(body.docVersion).toBe(3);
  });

  it('passes explicitOnly query filter through to the SQL', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(), role: 'viewer', canEdit: false, canManage: false,
    } as never);
    const queryAll = vi.fn().mockResolvedValue([]);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(undefined),
      queryAll,
      execute: vi.fn().mockResolvedValue({ changes: 0 }),
    } as never);
    const res = await GET(makeReq('GET', undefined, 'explicitOnly=1') as Parameters<typeof GET>[0], idParams);
    expect(res.status).toBe(200);
    const sql = queryAll.mock.calls[0][0] as string;
    expect(sql).toContain('is_explicit = 1');
  });
});

// ─── POST ────────────────────────────────────────────────────────────────────

describe('POST /api/documents/[id]/versions', () => {
  it('401 unauth', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const res = await POST(makeReq('POST', { label: 'x' }) as Parameters<typeof POST>[0], idParams);
    expect(res.status).toBe(401);
  });

  it('404 when no access', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue(null);
    const res = await POST(makeReq('POST', { label: 'x' }) as Parameters<typeof POST>[0], idParams);
    expect(res.status).toBe(404);
  });

  it('403 when viewer attempts to create a version', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: 'u-bob', orgIds: [] } as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(),
      role: 'viewer',
      canEdit: false,
      canManage: false,
    } as never);
    const res = await POST(makeReq('POST', { label: 'sneaky' }) as Parameters<typeof POST>[0], idParams);
    expect(res.status).toBe(403);
  });

  it('201 happy path — editor creates explicit snapshot, version bumps', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow({ version: 3 }),
      role: 'editor',
      canEdit: true,
      canManage: false,
    } as never);
    const execute = vi.fn().mockResolvedValue({ changes: 1 });
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(undefined),
      queryAll: vi.fn().mockResolvedValue([]),
      execute,
    } as never);
    const res = await POST(makeReq('POST', { label: 'pre-release' }) as Parameters<typeof POST>[0], idParams);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.version.label).toBe('pre-release');
    expect(body.version.isExplicit).toBe(true);
    expect(body.docVersion).toBe(4); // bumped from 3
    // 1 INSERT into nf_document_versions, 1 UPDATE on nf_documents
    expect(execute).toHaveBeenCalledTimes(2);
  });

  // 260723 architecture-debt scoping: PDM gate/approval status is now
  // ADVISORY (client-asserted, like label/branchName) — this proves it is
  // (a) recorded when a valid gateReport is sent, (b) computed correctly as
  // 'failed' when any gate fails / 'passed' when all pass, and (c) NEVER
  // rejects the save regardless of gate outcome (the whole point — CAD
  // workflows must be able to persist a failing/WIP state).
  describe('PDM gate status (advisory, 260723)', () => {
    function setupEditableDoc() {
      vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
      vi.mocked(resolveDocAccess).mockResolvedValue({
        row: makeDocRow({ version: 3 }),
        role: 'editor',
        canEdit: true,
        canManage: false,
      } as never);
      const execute = vi.fn().mockResolvedValue({ changes: 1 });
      vi.mocked(getDbAdapter).mockReturnValue({
        queryOne: vi.fn().mockResolvedValue(undefined),
        queryAll: vi.fn().mockResolvedValue([]),
        execute,
      } as never);
      return execute;
    }

    it('all gates passing -> gate_status "passed", persisted and returned', async () => {
      const execute = setupEditableDoc();
      const res = await POST(
        makeReq('POST', { label: 'v', gateReport: [{ id: 'geometry', pass: true }, { id: 'drawing', pass: true }] }) as Parameters<typeof POST>[0],
        idParams,
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.version.gateStatus).toBe('passed');
      expect(body.version.gateReport).toEqual([{ id: 'geometry', pass: true }, { id: 'drawing', pass: true }]);
      // INSERT call included the derived gate_status/gate_report params.
      const insertArgs = execute.mock.calls[0]!;
      expect(insertArgs).toContain('passed');
    });

    it('one gate failing -> gate_status "failed", but the save STILL SUCCEEDS (advisory, not blocking)', async () => {
      const execute = setupEditableDoc();
      const res = await POST(
        makeReq('POST', { label: 'wip-save', gateReport: [{ id: 'geometry', pass: true }, { id: 'drawing', pass: false, reason: 'missing dimension' }] }) as Parameters<typeof POST>[0],
        idParams,
      );
      // The whole point: a gate-failed report does NOT reject the POST.
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.version.gateStatus).toBe('failed');
      expect(body.version.gateReport).toEqual([{ id: 'geometry', pass: true }, { id: 'drawing', pass: false, reason: 'missing dimension' }]);
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it('no gateReport sent -> gate_status stays null (never fabricated as passed)', async () => {
      setupEditableDoc();
      const res = await POST(makeReq('POST', { label: 'no-gate-info' }) as Parameters<typeof POST>[0], idParams);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.version.gateStatus).toBeNull();
      expect(body.version.gateReport).toBeNull();
    });

    it('a malformed gateReport (not an array of {id,pass}) is silently ignored, not a 400', async () => {
      setupEditableDoc();
      const res = await POST(
        makeReq('POST', { label: 'garbage-gate', gateReport: 'not-an-array' }) as Parameters<typeof POST>[0],
        idParams,
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.version.gateStatus).toBeNull();
    });
  });

  it('400 when branchName provided without parentVersionId', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(),
      role: 'editor',
      canEdit: true,
      canManage: false,
    } as never);
    const res = await POST(makeReq('POST', { branchName: 'feature' }) as Parameters<typeof POST>[0], idParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('validation.branch_parent');
  });

  it('400 when parentVersionId does not belong to this doc', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(),
      role: 'editor',
      canEdit: true,
      canManage: false,
    } as never);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue({ id: 'v9', document_id: 'OTHER-DOC' }),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ changes: 0 }),
    } as never);
    const res = await POST(makeReq('POST', { parentVersionId: 'v9' }) as Parameters<typeof POST>[0], idParams);
    expect(res.status).toBe(400);
  });

  it('400 when branchName contains invalid chars', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(authedUser as never);
    vi.mocked(resolveDocAccess).mockResolvedValue({
      row: makeDocRow(),
      role: 'editor',
      canEdit: true,
      canManage: false,
    } as never);
    const res = await POST(
      makeReq('POST', { branchName: 'feature space!', parentVersionId: 'v1' }) as Parameters<typeof POST>[0],
      idParams,
    );
    expect(res.status).toBe(400);
  });
});
