import BetterSqlite from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import { createSpatialCadDocument, type SpatialCadDocument } from './spatialCadCommand';
import { ensureSpatialCadDraftTables, persistSpatialCadDraft, releaseSpatialCadDraftLocks } from './spatialCadDraftStore';
import { stableSpatialCadDocumentJson } from './spatialCadHash';

function sqliteAdapter(database: BetterSqlite.Database): DbAdapter {
  const adapter: DbAdapter = {
    backend: 'sqlite',
    async queryOne<T>(sql: string, ...params: SqlParam[]) { return database.prepare(sql).get(...params) as T | undefined; },
    async queryAll<T>(sql: string, ...params: SqlParam[]) { return database.prepare(sql).all(...params) as T[]; },
    async execute(sql: string, ...params: SqlParam[]) { return { changes: database.prepare(sql).run(...params).changes }; },
    async executeRaw(sql: string) { database.exec(sql); },
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>) { database.exec('BEGIN IMMEDIATE'); try { const result = await fn(adapter); database.exec('COMMIT'); return result; } catch (error) { database.exec('ROLLBACK'); throw error; } },
    async close() { database.close(); },
  };
  return adapter;
}

const hash = (document: SpatialCadDocument) => createHash('sha256').update(stableSpatialCadDocumentJson(document)).digest('hex');

describe('spatial CAD draft SQLite transaction', () => {
  it('commits baseline/auto-lock/release atomically and rejects stale or malformed state', async () => {
    const database = new BetterSqlite(':memory:');
    database.exec('CREATE TABLE nf_audit_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, resource_id TEXT, metadata TEXT, ip TEXT, created_at BIGINT NOT NULL)');
    const db = sqliteAdapter(database);
    await ensureSpatialCadDraftTables(db);
    const baseline = createSpatialCadDocument('building', { width: 10, depth: 20 });
    const first = await persistSpatialCadDraft(db, 'user-1', 'project-1', -1, baseline, { documentId: 'doc-1' });
    expect(first).toMatchObject({ ok: true, draft: { projectRevision: 0, locks: [] } });
    const changed = { ...baseline, revision: 1, parameters: { width: 12, depth: 20 } };
    const second = await persistSpatialCadDraft(db, 'user-1', 'project-1', 0, changed, { documentId: 'doc-1' });
    expect(second).toMatchObject({ ok: true, draft: { projectRevision: 1 } });
    if (!second.ok) throw new Error('expected auto-lock save');
    expect(second.draft.locks).toHaveLength(1);
    const lockId = second.draft.locks![0].id;
    const stale = await persistSpatialCadDraft(db, 'user-1', 'project-1', 0, { ...changed, revision: 2, parameters: { width: 14, depth: 20 } }, { documentId: 'doc-1' });
    expect(stale).toMatchObject({ ok: false, code: 'REVISION_CONFLICT' });
    const release = await releaseSpatialCadDraftLocks(db, 'user-1', 'project-1', 'building', { baseProjectRevision: 1, contentHash: hash(changed), documentId: 'doc-1', lockIds: [lockId] });
    expect(release).toMatchObject({ ok: true, draft: { projectRevision: 2, contentHash: hash(changed), document: { revision: 1 }, locks: [] } });
    expect(database.prepare('SELECT COUNT(*) AS count FROM nf_audit_log').get()).toMatchObject({ count: 3 });
    database.prepare('UPDATE nf_spatial_cad_draft_heads SET locks_json = ?').run('{"bad":true}');
    const malformed = await persistSpatialCadDraft(db, 'user-1', 'project-1', 2, { ...changed, revision: 2, parameters: { width: 15, depth: 20 } }, { documentId: 'doc-1' });
    expect(malformed).toMatchObject({ ok: false, code: 'LOCK_CONFLICT' });
    expect(database.prepare('SELECT project_revision FROM nf_spatial_cad_draft_heads').get()).toMatchObject({ project_revision: 2 });
    await db.close();
  });
});
