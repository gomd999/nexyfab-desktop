import { describe, expect, it, vi } from 'vitest';
import BetterSqlite from 'better-sqlite3';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import { appendArchitectureInteriorHistoryEvent, appendArchitectureInteriorHistoryEventInTransaction, ensureArchitectureInteriorHistoryTables, readArchitectureInteriorHistory, type ArchitectureInteriorHistoryEvent } from './architectureInteriorHistoryStore';

const hash = (letter: string) => letter.repeat(64);
function row(event: ArchitectureInteriorHistoryEvent) {
  return {
    id: event.id, sequence: event.sequence, operation: event.operation, lineageId: event.lineageId,
    source_sequence: event.sourceSequence, actorUserId: event.actorUserId, commandId: event.commandId,
    sourceRevision: event.sourceRevision, sourceContentHash: event.sourceContentHash,
    targetRevision: event.targetRevision, targetContentHash: event.targetContentHash, createdAt: event.createdAt,
  };
}
function event(sequence: number, operation: ArchitectureInteriorHistoryEvent['operation'], sourceRevision: number, sourceSequence?: number): ArchitectureInteriorHistoryEvent {
  return { id: `event-${sequence}`, sequence, operation, lineageId: 'lineage-1', ...(sourceSequence === undefined ? {} : { sourceSequence }), actorUserId: 'user-1', commandId: `command-${sequence}`, sourceRevision, sourceContentHash: hash(String.fromCharCode(97 + sourceRevision)), targetRevision: sourceRevision + 1, targetContentHash: hash(String.fromCharCode(98 + sourceRevision)), createdAt: sequence };
}
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

describe('architecture/interior compact history ledger', () => {
  it('tracks the active undo source and reverted redo source, rather than undoing ledger rows', async () => {
    const rows = [
      event(1, 'apply', 0),
      event(2, 'undo', 1, 1),
      event(3, 'redo', 2, 2),
      event(4, 'undo', 3, 3),
    ].map(row);
    const db = { queryAll: vi.fn().mockResolvedValue(rows) } as never;
    const state = await readArchitectureInteriorHistory(db, { tenantId: 'tenant-1', projectId: 'project-1' });
    expect(state.events).toHaveLength(4);
    expect(state.undo).toBeUndefined();
    expect(state.redo?.sequence).toBe(3);
  });

  it('rejects an undo that does not target the active operation', async () => {
    const rows = [event(1, 'apply', 0), event(2, 'undo', 1, 1), event(3, 'undo', 2, 1)].map(row);
    const db = { queryAll: vi.fn().mockResolvedValue(rows) } as never;
    await expect(readArchitectureInteriorHistory(db, { tenantId: 'tenant-1', projectId: 'project-1' })).rejects.toThrow('history_corrupt');
  });

  it('persists apply/undo/redo across a SQLite reconnect and invalidates redo after a new apply', async () => {
    const db = sqliteAdapter(new BetterSqlite(':memory:'));
    await ensureArchitectureInteriorHistoryTables(db);
    const scope = { tenantId: 'tenant-1', projectId: 'project-1' };
    const base = { actorUserId: 'user-1', lineageId: 'lineage-1', commandId: 'command-1', sourceContentHash: hash('a'), targetContentHash: hash('b') };
    await appendArchitectureInteriorHistoryEvent(db, scope, { ...base, operation: 'apply', sourceRevision: 0, targetRevision: 1 });
    await appendArchitectureInteriorHistoryEvent(db, scope, { ...base, operation: 'undo', sourceSequence: 1, sourceRevision: 1, targetRevision: 2 });
    expect((await readArchitectureInteriorHistory(db, scope)).redo?.sequence).toBe(1);
    await appendArchitectureInteriorHistoryEvent(db, scope, { ...base, operation: 'redo', sourceSequence: 2, sourceRevision: 2, targetRevision: 3 });
    expect((await readArchitectureInteriorHistory(db, scope)).undo?.sequence).toBe(3);
    await appendArchitectureInteriorHistoryEvent(db, scope, { ...base, operation: 'undo', sourceSequence: 3, sourceRevision: 3, targetRevision: 4 });
    await appendArchitectureInteriorHistoryEvent(db, scope, { ...base, operation: 'apply', sourceRevision: 4, targetRevision: 5 });
    expect((await readArchitectureInteriorHistory(db, scope)).redo).toBeUndefined();
    await db.close();
  });

  it('enforces the compact 1000-entry ledger bound', async () => {
    const db = sqliteAdapter(new BetterSqlite(':memory:'));
    await ensureArchitectureInteriorHistoryTables(db);
    const scope = { tenantId: 'tenant-1', projectId: 'project-bound' };
    for (let revision = 0; revision < 1_000; revision++) {
      await appendArchitectureInteriorHistoryEvent(db, scope, { operation: 'apply', lineageId: 'lineage-bound', actorUserId: 'user-1', commandId: `bound-${revision}`, sourceRevision: revision, sourceContentHash: hash('a'), targetRevision: revision + 1, targetContentHash: hash('b') });
    }
    await expect(appendArchitectureInteriorHistoryEvent(db, scope, { operation: 'apply', lineageId: 'lineage-bound', actorUserId: 'user-1', commandId: 'bound-overflow', sourceRevision: 1_000, sourceContentHash: hash('a'), targetRevision: 1_001, targetContentHash: hash('b') })).rejects.toThrow('history_limit_exceeded');
    expect((await readArchitectureInteriorHistory(db, scope)).events).toHaveLength(1_000);
    await db.close();
  });

  it('rolls back a caller-owned head mutation when ledger append fails', async () => {
    const db = sqliteAdapter(new BetterSqlite(':memory:'));
    await ensureArchitectureInteriorHistoryTables(db);
    await db.executeRaw('CREATE TABLE test_head (revision INTEGER NOT NULL); INSERT INTO test_head (revision) VALUES (1);');
    const scope = { tenantId: 'tenant-1', projectId: 'project-atomic' };
    await expect(db.transaction(async tx => {
      await tx.execute('UPDATE test_head SET revision = 2');
      await appendArchitectureInteriorHistoryEventInTransaction(tx, scope, { operation: 'apply', lineageId: 'lineage-atomic', actorUserId: 'user-1', commandId: 'atomic-1', sourceRevision: 1, sourceContentHash: hash('a'), targetRevision: 2, targetContentHash: hash('b') });
      throw new Error('simulate_commit_failure');
    })).rejects.toThrow('simulate_commit_failure');
    expect((await db.queryOne<{ revision: number }>('SELECT revision FROM test_head'))?.revision).toBe(1);
    expect((await db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM nf_architecture_interior_history'))?.count).toBe(0);
    await db.close();
  });

  it('rejects malformed operation lineage before it can create a corrupt row', async () => {
    const db = sqliteAdapter(new BetterSqlite(':memory:'));
    await ensureArchitectureInteriorHistoryTables(db);
    const scope = { tenantId: 'tenant-1', projectId: 'project-invalid' };
    const base = { lineageId: 'lineage-1', actorUserId: 'user-1', commandId: 'command-1', sourceRevision: 0, sourceContentHash: hash('a'), targetRevision: 1, targetContentHash: hash('b') };
    await expect(appendArchitectureInteriorHistoryEvent(db, scope, { ...base, operation: 'undo' })).rejects.toThrow('history_input_invalid');
    await expect(appendArchitectureInteriorHistoryEvent(db, scope, { ...base, operation: 'apply', sourceSequence: 1 })).rejects.toThrow('history_input_invalid');
    await expect(appendArchitectureInteriorHistoryEvent(db, scope, { ...base, operation: 'apply', commandId: 'x'.repeat(513) })).rejects.toThrow('history_input_invalid');
    expect((await db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM nf_architecture_interior_history'))?.count).toBe(0);
    await db.close();
  });
});
