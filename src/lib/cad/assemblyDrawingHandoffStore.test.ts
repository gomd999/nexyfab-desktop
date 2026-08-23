import BetterSqlite from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import { IDENTITY_QUAT } from '@/lib/assembly/assemblyState';
import { buildAssemblyDrawingHandoff } from '@/app/[lang]/shape-generator/assembly/drawingHandoff';
import {
  cleanupExpiredAssemblyDrawingHandoffs,
  ensureAssemblyDrawingHandoffTable,
  isAssemblyDrawingHandoffStorageConfigured,
  persistAssemblyDrawingHandoff,
  readStoredAssemblyDrawingHandoff,
} from './assemblyDrawingHandoffStore';

const contentHash = 'a'.repeat(64);

function sqliteAdapter(database: BetterSqlite.Database): DbAdapter {
  const adapter: DbAdapter = {
    backend: 'sqlite',
    async queryOne<T>(sql: string, ...params: SqlParam[]) { return database.prepare(sql).get(...params) as T | undefined; },
    async queryAll<T>(sql: string, ...params: SqlParam[]) { return database.prepare(sql).all(...params) as T[]; },
    async execute(sql: string, ...params: SqlParam[]) { return { changes: database.prepare(sql).run(...params).changes }; },
    async executeRaw(sql: string) { database.exec(sql); },
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>) {
      database.exec('BEGIN IMMEDIATE');
      try { const result = await fn(adapter); database.exec('COMMIT'); return result; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    async close() { database.close(); },
  };
  return adapter;
}

async function fixture() {
  return buildAssemblyDrawingHandoff({
    projectId: 'project-1',
    workspaceRevision: 4,
    workspaceContentSha256: contentHash,
    state: {
      parts: [{ id: 'part-1', name: 'Bracket', partTemplateId: 'bracket', position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY_QUAT, fixed: true }],
      mates: [],
    },
    featureTrees: {
      'part-1': {
        nodes: [{
          id: 'extrude-1', name: 'Base', dependencies: [],
          payload: { kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }], depth: 2, direction: 'one_sided', mode: 'add' },
        }],
      },
    },
    now: new Date('2026-08-13T00:00:00.000Z'),
  });
}

function database() {
  const raw = new BetterSqlite(':memory:');
  raw.exec('CREATE TABLE nf_cad_workspace_heads (project_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, content_hash TEXT NOT NULL, updated_at BIGINT NOT NULL);');
  raw.prepare('INSERT INTO nf_cad_workspace_heads VALUES (?, ?, ?, ?)').run('project-1', 4, contentHash, 1);
  return { raw, db: sqliteAdapter(raw) };
}

describe('server-owned assembly drawing handoff store', () => {
  it('does not classify an implicit or relative SQLite path as durable storage', () => {
    expect(isAssemblyDrawingHandoffStorageConfigured({})).toBe(false);
    expect(isAssemblyDrawingHandoffStorageConfigured({ NEXYFAB_DB_PATH: 'relative.db' })).toBe(false);
    expect(isAssemblyDrawingHandoffStorageConfigured({ DATA_ROOT: 'relative-data' })).toBe(false);
    expect(isAssemblyDrawingHandoffStorageConfigured({ NEXYFAB_DB_PATH: 'C:\\durable\\nexyfab.db' })).toBe(true);
    expect(isAssemblyDrawingHandoffStorageConfigured({ DATABASE_URL: 'postgresql://db/nexyfab' })).toBe(true);
  });

  it('persists immutable canonical bytes idempotently and isolates tenant reads', async () => {
    const { raw, db } = database();
    await ensureAssemblyDrawingHandoffTable(db);
    const handoff = await fixture();
    const input = { projectId: 'project-1', tenantId: 'org-1', userId: 'editor-1', expectedRevision: 4, expectedContentSha256: contentHash, handoff, now: 1000 };
    const first = await persistAssemblyDrawingHandoff(db, input);
    const second = await persistAssemblyDrawingHandoff(db, input);
    expect(first).toMatchObject({ ok: true, idempotent: false });
    expect(second).toMatchObject({ ok: true, idempotent: true });
    if (!first.ok) throw new Error('fixture persistence failed');
    expect(await readStoredAssemblyDrawingHandoff(db, { handoffId: first.stored.handoffId, projectId: 'project-1', tenantId: 'org-2', now: 1001 }))
      .toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await readStoredAssemblyDrawingHandoff(db, { handoffId: first.stored.handoffId, projectId: 'project-1', tenantId: 'org-1', now: 1001 }))
      .toMatchObject({ ok: true, stored: { payloadSha256: first.stored.payloadSha256, sourceRevision: 4 } });
    expect((raw.prepare('SELECT COUNT(*) AS count FROM nf_assembly_drawing_handoffs').get() as { count: number }).count).toBe(1);
    await db.close();
  });

  it('fails closed on stale revision/hash and forged downstream PASS evidence', async () => {
    const { db } = database();
    await ensureAssemblyDrawingHandoffTable(db);
    const handoff = await fixture();
    expect(await persistAssemblyDrawingHandoff(db, {
      projectId: 'project-1', tenantId: 'org-1', userId: 'editor-1', expectedRevision: 3,
      expectedContentSha256: contentHash, handoff: { ...handoff, source: { ...handoff.source, workspaceRevision: 3 } },
    })).toMatchObject({ ok: false, code: 'REVISION_CONFLICT', currentRevision: 4 });
    const forged = structuredClone(handoff);
    forged.artifacts.drawing.status = 'PASS';
    expect(await persistAssemblyDrawingHandoff(db, {
      projectId: 'project-1', tenantId: 'org-1', userId: 'editor-1', expectedRevision: 4,
      expectedContentSha256: contentHash, handoff: forged,
    })).toMatchObject({ ok: false, code: 'INVALID_HANDOFF', issues: ['ASSEMBLY_DRAWING_HANDOFF_EVIDENCE_INVALID'] });
    await expect(persistAssemblyDrawingHandoff(db, {
      projectId: 'project-1', tenantId: 'org-1', userId: 'editor-1', expectedRevision: 4,
      expectedContentSha256: contentHash, handoff: {} as never,
    })).resolves.toMatchObject({ ok: false, code: 'INVALID_HANDOFF' });
    await db.close();
  });

  it('never returns expired or byte-tampered rows and cleans expiry in a bounded pass', async () => {
    const { raw, db } = database();
    await ensureAssemblyDrawingHandoffTable(db);
    const result = await persistAssemblyDrawingHandoff(db, {
      projectId: 'project-1', tenantId: 'org-1', userId: 'editor-1', expectedRevision: 4,
      expectedContentSha256: contentHash, handoff: await fixture(), now: 1000,
    });
    if (!result.ok) throw new Error('fixture persistence failed');
    raw.prepare('UPDATE nf_assembly_drawing_handoffs SET payload_json = payload_json || ? WHERE id = ?').run(' ', result.stored.handoffId);
    expect(await readStoredAssemblyDrawingHandoff(db, { handoffId: result.stored.handoffId, projectId: 'project-1', tenantId: 'org-1', now: 1001 }))
      .toEqual({ ok: false, code: 'STORED_HANDOFF_INVALID' });
    expect(await readStoredAssemblyDrawingHandoff(db, { handoffId: result.stored.handoffId, projectId: 'project-1', tenantId: 'org-1', now: result.stored.expiresAt }))
      .toEqual({ ok: false, code: 'EXPIRED' });
    expect(await cleanupExpiredAssemblyDrawingHandoffs(db, result.stored.expiresAt, 1)).toBe(1);
    expect(await readStoredAssemblyDrawingHandoff(db, { handoffId: result.stored.handoffId, projectId: 'project-1', tenantId: 'org-1' }))
      .toEqual({ ok: false, code: 'NOT_FOUND' });
    await db.close();
  });
});
