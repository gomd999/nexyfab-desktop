import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  access: vi.fn(),
  origin: vi.fn(),
  rate: vi.fn(),
  rateHeaders: vi.fn(),
  assertMigration: vi.fn(),
  read: vi.fn(),
  commit: vi.fn(),
  queryAll: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: mocks.origin }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: () => ({
    backend: 'postgres',
    queryAll: mocks.queryAll,
    execute: mocks.execute,
  }),
}));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.access }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: mocks.rate,
  rateLimitHeaders: mocks.rateHeaders,
}));
vi.mock('@/lib/cad/canonicalCadRevisionStore', () => ({
  assertCanonicalCadRevisionMigration: mocks.assertMigration,
  readCanonicalCadRevisionHead: mocks.read,
  commitCanonicalCadRevision: mocks.commit,
}));

import { GET, POST, dynamic, runtime } from './route';

const NOW = '2026-08-24T02:03:04.000Z';
const URL = 'https://nexyfab.com/api/cad/v2/projects/project-1/documents/document-1/revisions';
const context = () => ({ params: Promise.resolve({ id: 'project-1', documentId: 'document-1' }) });
const document = {
  projectId: 'project-1', documentId: 'document-1',
  revision: { revisionId: 'revision-1', sequence: 1, contentSha256: 'b'.repeat(64) },
  verification: 'NOT_RUN', release: 'HOLD',
};
const receipt = {
  authority: 'SERVER_CANONICAL_DRAFT_REVISION',
  revision: document.revision,
  verification: 'NOT_RUN', release: 'HOLD', receiptSha256: 'c'.repeat(64),
};
const command = {
  projectId: 'project-1', documentId: 'document-1',
  actor: { kind: 'human', actorId: 'user-1', agentIdentity: null },
};

function request(method: 'GET' | 'POST' = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(URL, {
    method,
    headers: method === 'POST' ? { origin: 'https://nexyfab.com', ...headers } : headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function auditEvent() {
  return {
    action: 'cad.canonical_v2_revision_commit' as const,
    projectId: 'project-1', documentId: 'document-1',
    revision: document.revision,
    parentRevision: { revisionId: 'revision-0', sequence: 0, contentSha256: 'a'.repeat(64) },
    commandId: 'command-1', commandSha256: 'd'.repeat(64), idempotencyKey: 'idem-1',
    actorId: 'user-1', receiptSha256: receipt.receiptSha256,
    compensationForCommandId: null,
    changedObjectIds: ['building:wall-1'], changedRelationshipIds: [],
    invalidated: ['exact_geometry', 'native_document', 'analysis', 'drawing', 'quantity', 'exchange', 'qualification'] as const,
    at: NOW,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  mocks.auth.mockResolvedValue({ userId: 'user-1', orgIds: [], activeOrgId: null, orgContextStatus: 'personal' });
  mocks.access.mockResolvedValue({ canEdit: true });
  mocks.origin.mockReturnValue(true);
  mocks.rate.mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 60_000 });
  mocks.rateHeaders.mockReturnValue({ 'Retry-After': '1' });
  mocks.assertMigration.mockResolvedValue(undefined);
  mocks.queryAll.mockResolvedValue([]);
  mocks.execute.mockResolvedValue({ changes: 1 });
  mocks.read.mockResolvedValue({ ok: true, head: { projectId: 'project-1', documentId: 'document-1', revision: document.revision, document } });
  mocks.commit.mockImplementation(async (db: unknown, input: {
    hooks: { invalidateDerived(tx: unknown, event: unknown): Promise<void>; appendAudit(tx: unknown, event: ReturnType<typeof auditEvent>): Promise<void> };
  }) => {
    const event = auditEvent();
    await input.hooks.invalidateDerived(db, event);
    await input.hooks.appendAudit(db, event);
    return { ok: true, replayed: false, receipt, document };
  });
});

afterEach(() => vi.useRealTimers());

describe('canonical CAD v2 human revision route', () => {
  it('uses the installed Next route contract and awaits dynamic params for GET', async () => {
    let paramsAwaited = false;
    const params = Promise.resolve().then(() => {
      paramsAwaited = true;
      return { id: 'project-1', documentId: 'document-1' };
    });
    const response = await GET(request(), { params });
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
    expect(paramsAwaited).toBe(true);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true, status: 'HOLD', verification: 'NOT_RUN', release: 'HOLD', releaseReady: false,
      head: { document: { verification: 'NOT_RUN', release: 'HOLD' } },
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.access).toHaveBeenCalledWith(expect.anything(), 'project-1', expect.objectContaining({ userId: 'user-1' }));
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), 'project-1', 'document-1');
  });

  it('returns private unauthorized responses without resolving access', async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await GET(request(), context());
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({ code: 'UNAUTHORIZED', status: 'HOLD', verification: 'NOT_RUN' });
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it('hides inaccessible projects on GET and requires canEdit on POST', async () => {
    mocks.access.mockResolvedValueOnce(null);
    expect((await GET(request(), context())).status).toBe(404);
    mocks.access.mockResolvedValueOnce({ canEdit: false });
    expect((await POST(request('POST', { command }), context())).status).toBe(403);
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('rejects invalid path IDs before project or store access', async () => {
    const response = await GET(request(), { params: Promise.resolve({ id: '../project', documentId: 'document-1' }) });
    expect(response.status).toBe(400);
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('enforces rate limits with private responses', async () => {
    mocks.rate.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 1_000 });
    const response = await GET(request(), context());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.rateHeaders).toHaveBeenCalledWith(expect.objectContaining({ allowed: false }), 120);
    expect(mocks.rate).toHaveBeenCalledWith(
      'cad-v2-revisions:get:user-1:127.0.0.1', 120, 60_000, { failClosed: false },
    );
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it('maps a fail-closed rate limiter outage to 503', async () => {
    mocks.rate.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 1_000, unavailable: true });
    expect((await POST(request('POST', { command }), context())).status).toBe(503);
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it('maps the read-only migration assertion failure before lock reads to 503', async () => {
    mocks.assertMigration.mockRejectedValue(new Error('canonical_cad_revision_migration_required'));
    const response = await POST(request('POST', { command }), context());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: 'MIGRATION_REQUIRED', status: 'HOLD' });
    expect(mocks.queryAll).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('accepts only an exact command envelope bounded to 256 KiB', async () => {
    const oversized = await POST(request('POST', '{}', { 'content-length': String(256 * 1024 + 1) }), context());
    expect(oversized.status).toBe(413);
    const malformed = await POST(new NextRequest(URL, {
      method: 'POST', headers: { origin: 'https://nexyfab.com' }, body: new Uint8Array([0xff]),
    }), context());
    expect(malformed.status).toBe(400);
    const extra = await POST(request('POST', { command, execution: {} }), context());
    expect(extra.status).toBe(400);
    await expect(extra.json()).resolves.toMatchObject({ code: 'BODY_KEYS_INVALID' });
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it.each(['execution', 'currentLocks', 'locks', 'evaluatedAt', 'now'])('rejects user-provided %s execution context', async key => {
    const response = await POST(request('POST', { command, [key]: key === 'locks' ? [] : NOW }), context());
    expect(response.status).toBe(400);
    expect(mocks.queryAll).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('requires the authenticated human actor and path-bound command identity', async () => {
    const agent = { ...command, actor: { kind: 'agent', actorId: 'user-1', agentIdentity: {} } };
    await expect(POST(request('POST', { command: agent }), context())).resolves.toMatchObject({ status: 400 });
    await expect(POST(request('POST', { command: { ...command, actor: { ...command.actor, actorId: 'user-2' } } }), context())).resolves.toMatchObject({ status: 400 });
    await expect(POST(request('POST', { command: { ...command, documentId: 'document-2' } }), context())).resolves.toMatchObject({ status: 400 });
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('uses DB locks and server time, commits, and appends audit in the same hook transaction', async () => {
    mocks.queryAll.mockResolvedValue([
      { lock_id: 'lock-z', scope: 'field', object_id: 'building:wall-1', field_path: 'payload.width', owner_actor_id: 'authority-1', source: 'authority' },
      { lock_id: 'lock-a', scope: 'object', object_id: 'building:wall-2', field_path: null, owner_actor_id: 'user-2', source: 'human' },
    ]);
    const response = await POST(request('POST', { command }), context());
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({
      ok: true, replayed: false, status: 'HOLD', verification: 'NOT_RUN', release: 'HOLD', releaseReady: false,
      receipt: { verification: 'NOT_RUN', release: 'HOLD' },
      document: { verification: 'NOT_RUN', release: 'HOLD' },
    });
    expect(mocks.queryAll).toHaveBeenCalledWith(expect.stringContaining('nf_cad_canonical_v2_locks'), 'project-1', 'document-1');
    expect(mocks.commit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      projectId: 'project-1', documentId: 'document-1', authenticatedActorId: 'user-1', command,
      execution: {
        evaluatedAt: NOW,
        currentLocks: [
          { lockId: 'lock-a', scope: 'object', objectId: 'building:wall-2', fieldPath: null, ownerActorId: 'user-2', source: 'human' },
          { lockId: 'lock-z', scope: 'field', objectId: 'building:wall-1', fieldPath: 'payload.width', ownerActorId: 'authority-1', source: 'authority' },
        ],
      },
    }));
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO nf_cad_canonical_v2_audit'),
      receipt.receiptSha256, 'project-1', 'document-1', 'revision-1', expect.any(String), Date.parse(NOW),
    );
  });

  it('fails closed on malformed authoritative lock rows', async () => {
    mocks.queryAll.mockResolvedValue([{ lock_id: 'lock-1', scope: 'field', object_id: null, field_path: null, owner_actor_id: 'authority-1', source: 'authority' }]);
    const response = await POST(request('POST', { command }), context());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: 'CORRUPT_SERVER_STATE', status: 'HOLD' });
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it.each([
    [{ ok: false, code: 'INVALID_REQUEST', issues: ['bad'] }, 400],
    [{ ok: false, code: 'HOLD', issues: ['hold'] }, 400],
    [{ ok: false, code: 'REVISION_CONFLICT', currentRevision: null, issues: ['stale'] }, 409],
    [{ ok: false, code: 'IDEMPOTENCY_CONFLICT', issues: ['different'] }, 409],
    [{ ok: false, code: 'INVALID_COMMAND', issues: ['invalid'] }, 422],
    [{ ok: false, code: 'MIGRATION_REQUIRED', issues: ['missing'] }, 503],
    [{ ok: false, code: 'CORRUPT_SERVER_STATE', issues: ['corrupt'] }, 500],
  ])('maps commit result %# to HTTP status %s', async (result, expectedStatus) => {
    mocks.commit.mockResolvedValue(result);
    const response = await POST(request('POST', { command }), context());
    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it.each([
    [{ ok: false, code: 'NOT_FOUND', issues: ['missing'] }, 404],
    [{ ok: false, code: 'MIGRATION_REQUIRED', issues: ['migration'] }, 503],
    [{ ok: false, code: 'CORRUPT_SERVER_STATE', issues: ['corrupt'] }, 500],
  ])('maps GET store result %# to HTTP status %s', async (result, expectedStatus) => {
    mocks.read.mockResolvedValue(result);
    const response = await GET(request(), context());
    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('returns 403 for cross-origin POST and 500 for unexpected store failures', async () => {
    mocks.origin.mockReturnValue(false);
    expect((await POST(request('POST', { command }), context())).status).toBe(403);
    mocks.origin.mockReturnValue(true);
    mocks.commit.mockRejectedValue(new Error('database unavailable'));
    const failed = await POST(request('POST', { command }), context());
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toMatchObject({ code: 'INTERNAL_ERROR', status: 'HOLD', verification: 'NOT_RUN' });
  });
});
