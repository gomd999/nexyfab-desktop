/**
 * W6-A acceptance — /api/documents full-stack integration against a REAL DB.
 *
 * Unlike the sibling unit tests (which mock the DB adapter call-by-call),
 * this suite runs the actual route handlers against:
 *
 *   - default:            an in-memory better-sqlite3 DB with the real
 *                         wave-2 SQLite migration file applied
 *                         (src/lib/db-migrations-wave-2-sqlite.sql), or
 *   - DOCS_IT_PG_URL=…:   a real PostgreSQL instance, schema installed by
 *                         the real startup path (initPostgresSchema →
 *                         src/lib/db-postgres-migrations.sql, which contains
 *                         the wave-2 BIGINT-ms port). This is the leg that
 *                         guards the original 500 (int4 overflow on
 *                         Date.now() ms-epoch values).
 *
 * Covered acceptance criteria (EXECUTION_PLAN W6-A):
 *   - 인증 후 200 (list + create + read)
 *   - 권한 스택: non-owner 404 (no leak), viewer 200-read / 403-write,
 *     grant / revoke round-trip, owner-only ACL & delete
 *   - 버전 스택: create → revise → explicit snapshots → newest-first list
 *   - BIGINT-ms: stored timestamps are ms-epoch (> 1.7e12) and serialized
 *     as JS numbers on both backends.
 *
 * W6-B/W6-C additions (2-user check-out + restore scenario):
 *   - 배타 잠금: A 획득 201 → B 획득/편집/스냅샷/복원 423 → A 편집 200 →
 *     refresh 연장 → holder/owner만 해제 → B 획득 201
 *   - 만료 승계: expires_at 되감기 후 획득 201 takenOver, 만료 잠금은 편집
 *     비차단
 *   - 버전복원: 새 버전 적층(히스토리 보존) + restored_from 기록, 404 비누설
 *
 * Only auth / storage / audit / client-ip are mocked — SQL runs for real.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

// ─── auth mock (mutable current user) ───────────────────────────────────────

const authState = vi.hoisted(() => ({
  user: null as null | { userId: string; email: string; orgIds: string[] },
}));

vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: vi.fn(async () => authState.user),
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

vi.mock('@/lib/client-ip', () => ({
  getTrustedClientIpOrUndefined: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/storage', () => ({
  getStorage: vi.fn(() => ({
    uploadRaw: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(Buffer.from([0x00, 0x00])),
    getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/current.ydoc'),
    delete: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ─── DB: real adapter over in-memory SQLite, or real Postgres ───────────────

vi.mock('@/lib/db-adapter', async (orig) => {
  const real = await orig<typeof import('@/lib/db-adapter')>();
  if (process.env.DOCS_IT_PG_URL) {
    // Postgres leg — point the REAL adapter at the test instance. Schema is
    // installed in beforeAll via the real initPostgresSchema() startup path.
    process.env.DATABASE_URL = process.env.DOCS_IT_PG_URL;
    return real;
  }
  // SQLite leg — real better-sqlite3 (in-memory), same adapter surface as
  // db-adapter's createSqliteAdapter, minus the giant app schema in db.ts.
  const { default: BetterSqlite } = await import('better-sqlite3');
  const mem = new BetterSqlite(':memory:');
  mem.pragma('foreign_keys = ON');
  const adapter: import('@/lib/db-adapter').DbAdapter = {
    backend: 'sqlite',
    async queryOne(sql, ...p) { return mem.prepare(sql).get(...(p as never[])) as never; },
    async queryAll(sql, ...p) { return mem.prepare(sql).all(...(p as never[])) as never; },
    async execute(sql, ...p) { const info = mem.prepare(sql).run(...(p as never[])); return { changes: info.changes }; },
    async executeRaw(sql) { mem.exec(sql); },
    async transaction(fn) {
      mem.exec('BEGIN');
      try { const r = await fn(adapter); mem.exec('COMMIT'); return r; }
      catch (e) { mem.exec('ROLLBACK'); throw e; }
    },
    async close() { mem.close(); },
  };
  return { ...real, getDbAdapter: () => adapter };
});

// ─── fixtures ───────────────────────────────────────────────────────────────

const ALICE = { userId: 'it-docs-alice', email: 'it-docs-alice@test.local', orgIds: [] as string[] };
const BOB   = { userId: 'it-docs-bob',   email: 'it-docs-bob@test.local',   orgIds: [] as string[] };
const CAROL = { userId: 'it-docs-carol', email: 'it-docs-carol@test.local', orgIds: [] as string[] };

function actAs(u: typeof ALICE | null) { authState.user = u; }

function jsonReq(method: string, url: string, body?: unknown) {
  return new NextRequest(`http://test${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

// Route handlers (loaded after mocks in beforeAll)
let colGET: typeof import('../route').GET;
let colPOST: typeof import('../route').POST;
let docGET: typeof import('../[id]/route').GET;
let docPUT: typeof import('../[id]/route').PUT;
let docDELETE: typeof import('../[id]/route').DELETE;
let verGET: typeof import('../[id]/versions/route').GET;
let verPOST: typeof import('../[id]/versions/route').POST;
let permPOST: typeof import('../[id]/permissions/route').POST;
let permDELETE: typeof import('../[id]/permissions/[userId]/route').DELETE;
let lockPOST: typeof import('../[id]/lock/route').POST;
let lockPUT: typeof import('../[id]/lock/route').PUT;
let lockDELETE: typeof import('../[id]/lock/route').DELETE;
let restorePOST: typeof import('../[id]/versions/[versionId]/restore/route').POST;

let db: import('@/lib/db-adapter').DbAdapter;
const IS_PG = !!process.env.DOCS_IT_PG_URL;

beforeAll(async () => {
  const dbMod = await import('@/lib/db-adapter');
  db = dbMod.getDbAdapter();

  if (IS_PG) {
    // Real startup path — the whole committed migration file, twice would
    // also work (idempotent); once is the prod-equivalent boot.
    await dbMod.initPostgresSchema();
    // Clean any leftovers from previous runs (test rows are prefixed).
    await db.execute(`DELETE FROM nf_document_locks WHERE holder_id LIKE 'it-docs-%'`);
    await db.execute(`DELETE FROM nf_document_versions WHERE created_by LIKE 'it-docs-%'`);
    await db.execute(`DELETE FROM nf_document_permissions WHERE user_id LIKE 'it-docs-%' OR granted_by LIKE 'it-docs-%'`);
    await db.execute(`DELETE FROM nf_documents WHERE owner_id LIKE 'it-docs-%'`);
    await db.execute(`DELETE FROM nf_workspace_members WHERE user_id LIKE 'it-docs-%'`);
    await db.execute(`DELETE FROM nf_workspaces WHERE owner_id LIKE 'it-docs-%'`);
  } else {
    // Real wave-2 SQLite migration file (dev/prod-SQLite equivalent).
    await db.executeRaw(`
      CREATE TABLE IF NOT EXISTS nf_users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL, created_at BIGINT NOT NULL
      );
    `);
    const migration = fs.readFileSync(
      path.resolve(process.cwd(), 'src', 'lib', 'db-migrations-wave-2-sqlite.sql'), 'utf-8',
    );
    await db.executeRaw(migration);
  }

  for (const u of [ALICE, BOB, CAROL]) {
    await db.execute(
      `INSERT INTO nf_users (id, email, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      u.userId, u.email, u.userId, Date.now(),
    );
  }

  colGET = (await import('../route')).GET;
  colPOST = (await import('../route')).POST;
  ({ GET: docGET, PUT: docPUT, DELETE: docDELETE } = await import('../[id]/route'));
  ({ GET: verGET, POST: verPOST } = await import('../[id]/versions/route'));
  ({ POST: permPOST } = await import('../[id]/permissions/route'));
  ({ DELETE: permDELETE } = await import('../[id]/permissions/[userId]/route'));
  ({ POST: lockPOST, PUT: lockPUT, DELETE: lockDELETE } = await import('../[id]/lock/route'));
  restorePOST = (await import('../[id]/versions/[versionId]/restore/route')).POST;
});

afterAll(async () => {
  await db?.close();
});

// ─── the acceptance flow (sequential; state carries across tests) ───────────

let docId = '';

describe(`documents stack integration (${IS_PG ? 'postgres' : 'sqlite'})`, () => {
  it('401 on list and create when unauthenticated', async () => {
    actAs(null);
    expect((await colGET(jsonReq('GET', '/api/documents'))).status).toBe(401);
    expect((await colPOST(jsonReq('POST', '/api/documents', { name: 'x' }))).status).toBe(401);
  });

  it('201 create (alice) — BIGINT-ms timestamps stored and serialized as numbers', async () => {
    actAs(ALICE);
    const res = await colPOST(jsonReq('POST', '/api/documents', { name: 'Bracket v1' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    docId = body.document.id;
    expect(body.document.ownerId).toBe(ALICE.userId);
    expect(body.document.version).toBe(1);
    expect(typeof body.document.createdAt).toBe('number');
    expect(body.document.createdAt).toBeGreaterThan(1.7e12); // ms epoch, would overflow int4

    // DB-level: the stored value is ms-epoch (this exact insert 500'd on
    // Postgres int4 before the BIGINT port).
    const row = await db.queryOne<{ created_at: number | string }>(
      'SELECT created_at FROM nf_documents WHERE id = ?', docId,
    );
    expect(Number(row?.created_at)).toBeGreaterThan(1.7e12);
  });

  it('200 list (alice) — visible, pagination.total is a number', async () => {
    actAs(ALICE);
    const res = await colGET(jsonReq('GET', '/api/documents'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.documents.map((d: { id: string }) => d.id)).toContain(docId);
    expect(typeof body.pagination.total).toBe('number');
    expect(body.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it('no access (bob): list empty, GET 404 (no existence leak), PUT 404, versions 404', async () => {
    actAs(BOB);
    const list = await colGET(jsonReq('GET', '/api/documents'));
    const listBody = await list.json();
    expect(listBody.documents.map((d: { id: string }) => d.id)).not.toContain(docId);

    expect((await docGET(jsonReq('GET', `/api/documents/${docId}`), ctx({ id: docId }))).status).toBe(404);
    expect((await docPUT(jsonReq('PUT', `/api/documents/${docId}`, { name: 'hax' }), ctx({ id: docId }))).status).toBe(404);
    expect((await verGET(jsonReq('GET', `/api/documents/${docId}/versions`), ctx({ id: docId }))).status).toBe(404);
  });

  it('owner grants viewer to bob → 201; non-owner cannot manage ACL → 403', async () => {
    actAs(ALICE);
    const grant = await permPOST(
      jsonReq('POST', `/api/documents/${docId}/permissions`, { userId: BOB.userId, role: 'viewer' }),
      ctx({ id: docId }),
    );
    expect(grant.status).toBe(201);
    const gBody = await grant.json();
    expect(gBody.permission.role).toBe('viewer');
    expect(typeof gBody.permission.grantedAt).toBe('number');

    actAs(BOB);
    const selfGrant = await permPOST(
      jsonReq('POST', `/api/documents/${docId}/permissions`, { userId: BOB.userId, role: 'editor' }),
      ctx({ id: docId }),
    );
    expect(selfGrant.status).toBe(403);
  });

  it('viewer (bob): read 200 with role=viewer, write paths 403', async () => {
    actAs(BOB);
    const read = await docGET(jsonReq('GET', `/api/documents/${docId}`), ctx({ id: docId }));
    expect(read.status).toBe(200);
    const rBody = await read.json();
    expect(rBody.document.role).toBe('viewer');

    expect((await docPUT(jsonReq('PUT', `/api/documents/${docId}`, { name: 'nope' }), ctx({ id: docId }))).status).toBe(403);
    expect((await verPOST(jsonReq('POST', `/api/documents/${docId}/versions`, { label: 'nope' }), ctx({ id: docId }))).status).toBe(403);
    expect((await docDELETE(jsonReq('DELETE', `/api/documents/${docId}`), ctx({ id: docId }))).status).toBe(403);
  });

  it('editor (carol via grant): rename 200 bumps version 1 → 2', async () => {
    actAs(ALICE);
    expect((await permPOST(
      jsonReq('POST', `/api/documents/${docId}/permissions`, { userId: CAROL.userId, role: 'editor' }),
      ctx({ id: docId }),
    )).status).toBe(201);

    actAs(CAROL);
    const put = await docPUT(jsonReq('PUT', `/api/documents/${docId}`, { name: 'Bracket v2' }), ctx({ id: docId }));
    expect(put.status).toBe(200);
    const pBody = await put.json();
    expect(pBody.document.name).toBe('Bracket v2');
    expect(pBody.document.version).toBe(2);
  });

  it('version stack: two explicit snapshots → 201 each, doc version 2 → 3 → 4, newest-first list', async () => {
    actAs(ALICE);
    const v1 = await verPOST(jsonReq('POST', `/api/documents/${docId}/versions`, { label: 'first snapshot' }), ctx({ id: docId }));
    expect(v1.status).toBe(201);
    const v1Body = await v1.json();
    expect(v1Body.docVersion).toBe(3);
    expect(v1Body.version.isExplicit).toBe(true);

    await new Promise((r) => setTimeout(r, 10)); // distinct created_at ms for a deterministic ORDER BY

    actAs(CAROL);
    const v2 = await verPOST(jsonReq('POST', `/api/documents/${docId}/versions`, { label: 'second snapshot' }), ctx({ id: docId }));
    expect(v2.status).toBe(201);
    expect((await v2.json()).docVersion).toBe(4);

    actAs(BOB); // viewer may list
    const list = await verGET(jsonReq('GET', `/api/documents/${docId}/versions`), ctx({ id: docId }));
    expect(list.status).toBe(200);
    const lBody = await list.json();
    expect(lBody.versions).toHaveLength(2);
    expect(lBody.versions[0].label).toBe('second snapshot'); // newest first
    expect(lBody.versions[1].label).toBe('first snapshot');
    expect(typeof lBody.versions[0].createdAt).toBe('number');
    expect(lBody.versions[0].createdAt).toBeGreaterThan(lBody.versions[1].createdAt);
    expect(lBody.docVersion).toBe(4);
  });

  it('revoke bob → 200; bob loses access (404 again)', async () => {
    actAs(ALICE);
    const rev = await permDELETE(
      jsonReq('DELETE', `/api/documents/${docId}/permissions/${BOB.userId}`),
      ctx({ id: docId, userId: BOB.userId }),
    );
    expect(rev.status).toBe(200);

    actAs(BOB);
    expect((await docGET(jsonReq('GET', `/api/documents/${docId}`), ctx({ id: docId }))).status).toBe(404);
    const list = await colGET(jsonReq('GET', '/api/documents'));
    const listBody = await list.json();
    expect(listBody.documents.map((d: { id: string }) => d.id)).not.toContain(docId);
  });

  it('owner soft-delete → 200; filtered from list; owner undelete → 200 restores', async () => {
    actAs(ALICE);
    const del = await docDELETE(jsonReq('DELETE', `/api/documents/${docId}`), ctx({ id: docId }));
    expect(del.status).toBe(200);
    const dBody = await del.json();
    expect(typeof dBody.deletedAt).toBe('number');

    const listAfter = await colGET(jsonReq('GET', '/api/documents'));
    const laBody = await listAfter.json();
    expect(laBody.documents.map((d: { id: string }) => d.id)).not.toContain(docId);

    const undelete = await docPUT(jsonReq('PUT', `/api/documents/${docId}?undelete=1`, {}), ctx({ id: docId }));
    expect(undelete.status).toBe(200);
    const uBody = await undelete.json();
    expect(uBody.document.deletedAt).toBeNull();

    const listRestored = await colGET(jsonReq('GET', '/api/documents'));
    const lrBody = await listRestored.json();
    expect(lrBody.documents.map((d: { id: string }) => d.id)).toContain(docId);
  });
});

// ─── W6-B: exclusive check-out locks + W6-C: version restore ────────────────
// Continues the same sequential state: docId live (version 4), ALICE owner,
// CAROL editor, BOB revoked. Versions so far: 'first snapshot', 'second snapshot'.

const lockCtx = () => ctx({ id: docId });
const restoreCtx = (versionId: string) => ctx({ id: docId, versionId });

const DEFAULT_TTL = 30 * 60 * 1000;

let firstSnapshotId = '';

describe(`W6-B exclusive locks (${IS_PG ? 'postgres' : 'sqlite'})`, () => {
  it('401 unauth / 404 stranger (no leak) / 400 bad ttlMs', async () => {
    actAs(null);
    expect((await lockPOST(jsonReq('POST', `/api/documents/${docId}/lock`), lockCtx())).status).toBe(401);

    actAs(BOB); // revoked — must not learn the doc exists
    expect((await lockPOST(jsonReq('POST', `/api/documents/${docId}/lock`), lockCtx())).status).toBe(404);

    actAs(ALICE);
    const bad = await lockPOST(jsonReq('POST', `/api/documents/${docId}/lock`, { ttlMs: 'soon' }), lockCtx());
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe('validation.ttlMs');
  });

  it('viewer cannot check out → 403 (editor role required)', async () => {
    actAs(ALICE);
    expect((await permPOST(
      jsonReq('POST', `/api/documents/${docId}/permissions`, { userId: BOB.userId, role: 'viewer' }),
      ctx({ id: docId }),
    )).status).toBe(201);

    actAs(BOB);
    const res = await lockPOST(jsonReq('POST', `/api/documents/${docId}/lock`), lockCtx());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('document.permission_denied');
  });

  it('A acquires → 201, TTL exactly 30 min default; GET document surfaces the lock', async () => {
    actAs(ALICE);
    const res = await lockPOST(jsonReq('POST', `/api/documents/${docId}/lock`), lockCtx());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.lock.holderId).toBe(ALICE.userId);
    expect(body.takenOver).toBe(false);
    expect(body.lock.expiresAt - body.lock.acquiredAt).toBe(DEFAULT_TTL);
    expect(body.lock.acquiredAt).toBeGreaterThan(1.7e12); // BIGINT ms-epoch

    const read = await docGET(jsonReq('GET', `/api/documents/${docId}`), ctx({ id: docId }));
    expect(read.status).toBe(200);
    const rBody = await read.json();
    expect(rBody.lock.holderId).toBe(ALICE.userId);
    expect(typeof rBody.lock.expiresAt).toBe('number');
  });

  it('B acquire while A holds → 423 Locked with holder + expiry info', async () => {
    actAs(CAROL);
    const res = await lockPOST(jsonReq('POST', `/api/documents/${docId}/lock`), lockCtx());
    expect(res.status).toBe(423);
    const body = await res.json();
    expect(body.code).toBe('document.locked');
    expect(body.lock.holderId).toBe(ALICE.userId);
    expect(typeof body.lock.expiresAt).toBe('number');
  });

  it('B edit paths blocked while A holds: PUT doc 423, POST version 423, restore 423 (listing stays open)', async () => {
    actAs(CAROL);
    expect((await docPUT(jsonReq('PUT', `/api/documents/${docId}`, { name: 'blocked' }), ctx({ id: docId }))).status).toBe(423);
    expect((await verPOST(jsonReq('POST', `/api/documents/${docId}/versions`, { label: 'blocked' }), ctx({ id: docId }))).status).toBe(423);

    // Reads are NOT blocked by a check-out — grab a snapshot id for restore.
    const list = await verGET(jsonReq('GET', `/api/documents/${docId}/versions`), ctx({ id: docId }));
    expect(list.status).toBe(200);
    const versions = (await list.json()).versions as Array<{ id: string; label: string }>;
    firstSnapshotId = versions.find((v) => v.label === 'first snapshot')!.id;
    expect(firstSnapshotId).toBeTruthy();

    const restore = await restorePOST(
      jsonReq('POST', `/api/documents/${docId}/versions/${firstSnapshotId}/restore`),
      restoreCtx(firstSnapshotId),
    );
    expect(restore.status).toBe(423);
    expect((await restore.json()).code).toBe('document.locked');
  });

  it('A (holder) edits freely: PUT 200 → version 5, snapshot 201 → version 6', async () => {
    actAs(ALICE);
    const put = await docPUT(jsonReq('PUT', `/api/documents/${docId}`, { name: 'Bracket v3' }), ctx({ id: docId }));
    expect(put.status).toBe(200);
    expect((await put.json()).document.version).toBe(5);

    const snap = await verPOST(jsonReq('POST', `/api/documents/${docId}/versions`, { label: 'locked edit snapshot' }), ctx({ id: docId }));
    expect(snap.status).toBe(201);
    expect((await snap.json()).docVersion).toBe(6);
  });

  it('A refresh (PUT lock) → 200 with extended expiry (exact ttl from refreshed_at)', async () => {
    actAs(ALICE);
    const res = await lockPUT(jsonReq('PUT', `/api/documents/${docId}/lock`, { ttlMs: 60 * 60 * 1000 }), lockCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lock.expiresAt - body.lock.refreshedAt).toBe(60 * 60 * 1000);
  });

  it('release: B 403 (not holder/owner) → A 200 released → repeat idempotent released:false', async () => {
    actAs(CAROL);
    const denied = await lockDELETE(jsonReq('DELETE', `/api/documents/${docId}/lock`), lockCtx());
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe('lock.not_holder');

    actAs(ALICE);
    const rel = await lockDELETE(jsonReq('DELETE', `/api/documents/${docId}/lock`), lockCtx());
    expect(rel.status).toBe(200);
    expect((await rel.json()).released).toBe(true);

    const again = await lockDELETE(jsonReq('DELETE', `/api/documents/${docId}/lock`), lockCtx());
    expect(again.status).toBe(200);
    expect((await again.json()).released).toBe(false);
  });

  it('B acquires after release → 201; refresh without a lock → 404 lock.not_found', async () => {
    actAs(ALICE); // holds nothing now
    const stale = await lockPUT(jsonReq('PUT', `/api/documents/${docId}/lock`), lockCtx());
    expect(stale.status).toBe(404);
    expect((await stale.json()).code).toBe('lock.not_found');

    actAs(CAROL);
    const res = await lockPOST(jsonReq('POST', `/api/documents/${docId}/lock`), lockCtx());
    expect(res.status).toBe(201);
    expect((await res.json()).lock.holderId).toBe(CAROL.userId);
  });
});

describe(`W6-C version restore (${IS_PG ? 'postgres' : 'sqlite'})`, () => {
  it('B restores while holding own lock → 201: stacked as NEW version, restoredFrom recorded, history intact', async () => {
    actAs(CAROL);
    const before = await verGET(jsonReq('GET', `/api/documents/${docId}/versions`), ctx({ id: docId }));
    const beforeBody = await before.json();
    const beforeIds = beforeBody.versions.map((v: { id: string }) => v.id) as string[];
    expect(beforeIds).toHaveLength(3); // first, second, locked edit snapshot
    const docVersionBefore = beforeBody.docVersion as number; // 6

    const res = await restorePOST(
      jsonReq('POST', `/api/documents/${docId}/versions/${firstSnapshotId}/restore`),
      restoreCtx(firstSnapshotId),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.docVersion).toBe(docVersionBefore + 1); // 7 — monotonic, never rewound
    expect(body.version.restoredFrom).toBe(firstSnapshotId);
    expect(body.version.parentVersionId).toBe(firstSnapshotId);
    expect(body.version.isExplicit).toBe(true);

    // History preserved: every prior version still present + the new one on top.
    const after = await verGET(jsonReq('GET', `/api/documents/${docId}/versions`), ctx({ id: docId }));
    const afterBody = await after.json();
    const afterIds = afterBody.versions.map((v: { id: string }) => v.id) as string[];
    expect(afterIds).toHaveLength(4);
    for (const idPrev of beforeIds) expect(afterIds).toContain(idPrev);
    expect(afterBody.versions[0].id).toBe(body.version.id); // newest first
    expect(afterBody.versions[0].restoredFrom).toBe(firstSnapshotId);

    // DB-level: restored_from column actually persisted (not just serialized).
    const row = await db.queryOne<{ restored_from: string | null }>(
      'SELECT restored_from FROM nf_document_versions WHERE id = ?', body.version.id,
    );
    expect(row?.restored_from).toBe(firstSnapshotId);

    const read = await docGET(jsonReq('GET', `/api/documents/${docId}`), ctx({ id: docId }));
    const rBody = await read.json();
    expect(rBody.document.version).toBe(docVersionBefore + 1);
    expect(rBody.lock.holderId).toBe(CAROL.userId); // restore does not drop the lock
  });

  it('restore nonexistent version → 404 version.not_found (non-leak)', async () => {
    actAs(CAROL);
    const res = await restorePOST(
      jsonReq('POST', `/api/documents/${docId}/versions/nope/restore`),
      restoreCtx('does-not-exist'),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('version.not_found');
  });

  it("restore a version belonging to ANOTHER document → 404 (same non-leak shape)", async () => {
    actAs(ALICE);
    const doc2 = await colPOST(jsonReq('POST', '/api/documents', { name: 'Other doc' }));
    expect(doc2.status).toBe(201);
    const doc2Id = (await doc2.json()).document.id as string;
    const v2 = await verPOST(jsonReq('POST', `/api/documents/${doc2Id}/versions`, { label: 'foreign' }), ctx({ id: doc2Id }));
    expect(v2.status).toBe(201);
    const foreignVersionId = (await v2.json()).version.id as string;

    // Attempt as CAROL — she holds docId's lock, so the lock guard passes and
    // the version-ownership check is what must reject (non-leak 404).
    actAs(CAROL);
    const res = await restorePOST(
      jsonReq('POST', `/api/documents/${docId}/versions/${foreignVersionId}/restore`),
      restoreCtx(foreignVersionId),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('version.not_found');
  });
});

describe(`W6-B expiry takeover (${IS_PG ? 'postgres' : 'sqlite'})`, () => {
  it('owner force-releases B lock → 200 forced:true; B re-acquires → 201', async () => {
    actAs(ALICE);
    const force = await lockDELETE(jsonReq('DELETE', `/api/documents/${docId}/lock`), lockCtx());
    expect(force.status).toBe(200);
    const fBody = await force.json();
    expect(fBody.released).toBe(true);
    expect(fBody.forced).toBe(true);

    actAs(CAROL);
    expect((await lockPOST(jsonReq('POST', `/api/documents/${docId}/lock`), lockCtx())).status).toBe(201);
  });

  it('expired lock blocks nothing and is taken over on acquire (승계, takenOver:true)', async () => {
    // Short-TTL injection: rewind expires_at below now directly in the DB —
    // exercises the exact takeover predicate (expires_at <= now) the API uses.
    const rewound = await db.execute(
      'UPDATE nf_document_locks SET expires_at = ? WHERE document_id = ?',
      Date.now() - 1_000, docId,
    );
    expect(rewound.changes).toBe(1);

    // Expired lock does not block another editor's write…
    actAs(ALICE);
    const put = await docPUT(jsonReq('PUT', `/api/documents/${docId}`, { name: 'Bracket v4' }), ctx({ id: docId }));
    expect(put.status).toBe(200);

    // …and GET reports the document as unlocked.
    const read = await docGET(jsonReq('GET', `/api/documents/${docId}`), ctx({ id: docId }));
    expect((await read.json()).lock).toBeNull();

    // Acquire takes the stale row over.
    const res = await lockPOST(jsonReq('POST', `/api/documents/${docId}/lock`), lockCtx());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.takenOver).toBe(true);
    expect(body.lock.holderId).toBe(ALICE.userId);

    // The expired ex-holder is now on the wrong side of the lock.
    actAs(CAROL);
    expect((await docPUT(jsonReq('PUT', `/api/documents/${docId}`, { name: 'late' }), ctx({ id: docId }))).status).toBe(423);

    // Cleanup so later suites (if any) see an unlocked doc.
    actAs(ALICE);
    expect((await lockDELETE(jsonReq('DELETE', `/api/documents/${docId}/lock`), lockCtx())).status).toBe(200);
  });
});
