import BetterSqlite from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import { createInteriorPlacementDocument } from './interiorPlacementDocument';
import { ensureInteriorPlacementTables, persistInteriorPlacementOperation, releaseInteriorPlacementLocks } from './interiorPlacementDraftStore';

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

const furniture = (id: string, x = 0) => ({ id, catalogType: 'table4', spaceId: 'room-1', pose: { positionMm: [x, 0, 0] as [number, number, number], rotationDeg: [0, 0, 0] as [number, number, number] }, dimensionsMm: [1000, 600, 750] as [number, number, number], clearanceMm: [50, 50, 0] as [number, number, number] });

describe('interior placement draft SQLite CAS', () => {
  it('persists baseline and human operations, then releases occurrence locks atomically', async () => {
    const database = new BetterSqlite(':memory:');
    database.exec('CREATE TABLE nf_audit_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, resource_id TEXT, metadata TEXT, ip TEXT, created_at BIGINT NOT NULL)');
    const db = sqliteAdapter(database); await ensureInteriorPlacementTables(db);
    const baseline = createInteriorPlacementDocument({ documentId: 'placement-1', roomDocumentId: 'room-1', roomSizeMm: [10_000, 8_000, 3_000], objects: [furniture('table-1')] });
    const first = await persistInteriorPlacementOperation(db, 'user-1', 'project-1', { documentId: 'placement-1', roomDocumentId: 'room-1', baseProjectRevision: -1, operation: { kind: 'reset_layout', objects: baseline.objects }, document: baseline });
    expect(first).toMatchObject({ ok: true, draft: { projectRevision: 0 } });
    if (!first.ok) throw new Error('baseline failed');
    const added = await persistInteriorPlacementOperation(db, 'user-1', 'project-1', { documentId: 'placement-1', roomDocumentId: 'room-1', baseProjectRevision: 0, operation: { kind: 'add_object', object: furniture('table-2', 1200) } });
    expect(added).toMatchObject({ ok: true, draft: { projectRevision: 1 } });
    if (!added.ok) throw new Error('add failed');
    const moved = await persistInteriorPlacementOperation(db, 'user-1', 'project-1', { documentId: 'placement-1', roomDocumentId: 'room-1', baseProjectRevision: 1, operation: { kind: 'move_object', objectId: 'table-2', positionMm: [1500, 200, 0] } });
    expect(moved).toMatchObject({ ok: true, draft: { projectRevision: 2 } });
    if (!moved.ok) throw new Error('move failed');
    const stale = await persistInteriorPlacementOperation(db, 'user-1', 'project-1', { documentId: 'placement-1', roomDocumentId: 'room-1', baseProjectRevision: 1, operation: { kind: 'delete_object', objectId: 'table-2' } });
    expect(stale).toMatchObject({ ok: false, code: 'REVISION_CONFLICT' });
    const lockId = moved.draft.locks.find(lock => lock.target.objectId === 'table-2')?.id;
    expect(lockId).toBeTruthy();
    const released = await releaseInteriorPlacementLocks(db, 'user-1', 'project-1', { documentId: 'placement-1', baseProjectRevision: 2, contentHash: moved.draft.contentHash, lockIds: [lockId!] });
    expect(released).toMatchObject({ ok: true, draft: { projectRevision: 3, contentHash: moved.draft.contentHash, document: { revision: 2 }, locks: [] } });
    expect(database.prepare('SELECT COUNT(*) AS count FROM nf_audit_log').get()).toMatchObject({ count: 4 });
    await db.close();
  });

  it('rejects malformed locks and out-of-room/max-object operations without a write', async () => {
    const database = new BetterSqlite(':memory:'); database.exec('CREATE TABLE nf_audit_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, resource_id TEXT, metadata TEXT, ip TEXT, created_at BIGINT NOT NULL)');
    const db = sqliteAdapter(database); await ensureInteriorPlacementTables(db);
    const baseline = createInteriorPlacementDocument({ documentId: 'placement-2', roomDocumentId: 'room-1', roomSizeMm: [3000, 3000, 3000], objects: [furniture('table-1')] });
    await persistInteriorPlacementOperation(db, 'user-1', 'project-1', { documentId: 'placement-2', roomDocumentId: 'room-1', baseProjectRevision: -1, operation: { kind: 'reset_layout', objects: baseline.objects }, document: baseline });
    database.prepare('UPDATE nf_interior_placement_draft_heads SET locks_json = ?').run('{"bad":true}');
    const malformed = await persistInteriorPlacementOperation(db, 'user-1', 'project-1', { documentId: 'placement-2', roomDocumentId: 'room-1', baseProjectRevision: 0, operation: { kind: 'move_object', objectId: 'table-1', positionMm: [0, 0, 0] } });
    expect(malformed).toMatchObject({ ok: false, code: 'LOCK_CONFLICT' });
    expect(database.prepare('SELECT project_revision FROM nf_interior_placement_draft_heads').get()).toMatchObject({ project_revision: 0 });
    await db.close();
  });

  it('binds AI patches to the authoritative hash, selected field scope and duplicate-apply CAS', async () => {
    const database = new BetterSqlite(':memory:'); database.exec('CREATE TABLE nf_audit_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, resource_id TEXT, metadata TEXT, ip TEXT, created_at BIGINT NOT NULL)');
    const db = sqliteAdapter(database); await ensureInteriorPlacementTables(db);
    const baseline = createInteriorPlacementDocument({ documentId: 'placement-ai', roomDocumentId: 'room-1', roomSizeMm: [5000, 5000, 3000], objects: [furniture('table-1')] });
    const first = await persistInteriorPlacementOperation(db, 'user-1', 'project-1', { documentId: 'placement-ai', roomDocumentId: 'room-1', baseProjectRevision: -1, operation: { kind: 'reset_layout', objects: baseline.objects }, document: baseline });
    if (!first.ok) throw new Error('baseline failed');
    const operation = { kind: 'patch_selected_object' as const, objectId: 'table-1', changes: { pose: { positionMm: [200, 0, 0] as [number, number, number], rotationDeg: [0, 0, 0] as [number, number, number] } } };
    const stale = await persistInteriorPlacementOperation(db, 'user-1', 'project-1', { documentId: 'placement-ai', roomDocumentId: 'room-1', baseProjectRevision: 0, actor: 'ai', operation, guards: { selectedObjectId: 'table-1', parameterPaths: ['pose.positionMm'], locks: [], baseContentHash: 'f'.repeat(64), currentContentHash: 'f'.repeat(64) } });
    expect(stale).toMatchObject({ ok: false, code: 'LOCK_CONFLICT' });
    const applied = await persistInteriorPlacementOperation(db, 'user-1', 'project-1', { documentId: 'placement-ai', roomDocumentId: 'room-1', baseProjectRevision: 0, actor: 'ai', operation, guards: { selectedObjectId: 'table-1', parameterPaths: ['pose.positionMm'], locks: [], baseContentHash: first.draft.contentHash, currentContentHash: first.draft.contentHash } });
    expect(applied).toMatchObject({ ok: true, draft: { projectRevision: 1, document: { revision: 1 } } });
    const duplicate = await persistInteriorPlacementOperation(db, 'user-1', 'project-1', { documentId: 'placement-ai', roomDocumentId: 'room-1', baseProjectRevision: 0, actor: 'ai', operation, guards: { selectedObjectId: 'table-1', parameterPaths: ['pose.positionMm'], locks: [], baseContentHash: first.draft.contentHash, currentContentHash: first.draft.contentHash } });
    expect(duplicate).toMatchObject({ ok: false, code: 'REVISION_CONFLICT' });
    expect(database.prepare('SELECT COUNT(*) AS count FROM nf_audit_log').get()).toMatchObject({ count: 2 });
    await db.close();
  });

  it('rolls head and snapshot back when the same-transaction audit insert fails', async () => {
    const database = new BetterSqlite(':memory:'); database.exec('CREATE TABLE nf_audit_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, resource_id TEXT, metadata TEXT, ip TEXT, created_at BIGINT NOT NULL)');
    const db = sqliteAdapter(database); await ensureInteriorPlacementTables(db);
    const baseline = createInteriorPlacementDocument({ documentId: 'placement-rollback', roomDocumentId: 'room-1', roomSizeMm: [5000, 5000, 3000], objects: [furniture('table-1')] });
    await persistInteriorPlacementOperation(db, 'user-1', 'project-1', { documentId: 'placement-rollback', roomDocumentId: 'room-1', baseProjectRevision: -1, operation: { kind: 'reset_layout', objects: baseline.objects }, document: baseline });
    database.exec('DROP TABLE nf_audit_log');
    await expect(persistInteriorPlacementOperation(db, 'user-1', 'project-1', { documentId: 'placement-rollback', roomDocumentId: 'room-1', baseProjectRevision: 0, operation: { kind: 'move_object', objectId: 'table-1', positionMm: [100, 0, 0] } })).rejects.toThrow();
    expect(database.prepare('SELECT project_revision FROM nf_interior_placement_draft_heads').get()).toMatchObject({ project_revision: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM nf_interior_placement_drafts').get()).toMatchObject({ count: 1 });
    await db.close();
  });
});
