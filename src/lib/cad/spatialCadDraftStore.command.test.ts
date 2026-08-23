import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSpatialCadDocument, SPATIAL_CAD_COMMAND_SCHEMA, type SpatialCadDocument } from './spatialCadCommand';
import { persistSpatialCadCommand, type SpatialCadLock } from './spatialCadDraftStore';
import type { DbAdapter } from '@/lib/db-adapter';
import { stableSpatialCadDocumentJson } from './spatialCadHash';
import { spatialCadLockScope, type SpatialCadLockDto } from './spatialCadLocks';

function hash(document: SpatialCadDocument): string { return createHash('sha256').update(stableSpatialCadDocumentJson(document)).digest('hex'); }

function dbFor(document: SpatialCadDocument, contentHash: string, locks: SpatialCadLock[] = [], storedPayload = document): DbAdapter & { writes: string[] } {
  const head = { project_revision: 0, content_hash: contentHash, document_id: 'doc-1', locks_json: JSON.stringify(locks) };
  const drafts = new Map([[0, { payload_json: JSON.stringify(storedPayload), content_hash: contentHash, document_revision: document.revision, created_at: 1 }]]);
  const writes: string[] = [];
  const db: DbAdapter & { writes: string[] } = {
    backend: 'sqlite' as const,
    async queryOne<T>(sql: string, ...params: unknown[]) {
      if (sql.includes('FROM nf_spatial_cad_draft_heads')) return head as T;
      if (sql.includes('FROM nf_spatial_cad_drafts')) return drafts.get(Number(params[2])) as T | undefined;
      return undefined;
    },
    async queryAll() { return []; },
    async execute(sql: string, ...params: unknown[]) {
      writes.push(sql);
      if (sql.startsWith('UPDATE nf_spatial_cad_draft_heads')) { head.project_revision = Number(params[0]); head.content_hash = String(params[1]); return { changes: 1 }; }
      if (sql.startsWith('INSERT INTO nf_spatial_cad_drafts')) { drafts.set(Number(params[3]), { payload_json: String(params[6]), content_hash: String(params[5]), document_revision: Number(params[4]), created_at: Number(params[8]) }); return { changes: 1 }; }
      return { changes: 0 };
    },
    async executeRaw() {},
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> { return fn(db); },
    async close() {},
    writes,
  };
  return db;
}

const base = createSpatialCadDocument('civil', { lengthM: 120 });
const command = { schema: SPATIAL_CAD_COMMAND_SCHEMA, commandId: 'civil-1', domain: 'civil' as const, baseRevision: 0, actor: 'ai' as const, operation: { kind: 'set_parameter' as const, key: 'lengthM', value: 135 } };

describe('authoritative spatial project command CAS', () => {
  it('reapplies the reviewed command on the server and advances one head', async () => {
    const db = dbFor(base, hash(base));
    const result = await persistSpatialCadCommand(db, 'user-1', 'project-1', { baseProjectRevision: 0, baseContentHash: hash(base), documentId: 'doc-1', locks: [], parameterPaths: ['lengthM'], command });
    expect(result).toMatchObject({ ok: true, changedPaths: ['parameters.lengthM'], draft: { projectRevision: 1, document: { parameters: { lengthM: 135 }, revision: 1 } } });
    expect(db.writes.filter(sql => sql.includes('nf_audit_log'))).toHaveLength(1);
  });

  it('fails closed for stale, tampered hash and changed locks without writing', async () => {
    const staleDb = dbFor(base, hash(base));
    const stale = await persistSpatialCadCommand(staleDb, 'user-1', 'project-1', { baseProjectRevision: 2, baseContentHash: hash(base), documentId: 'doc-1', locks: [], parameterPaths: ['lengthM'], command });
    expect(stale).toMatchObject({ ok: false, code: 'REVISION_CONFLICT' });
    expect(staleDb.writes).toEqual([]);
    const tamperedDb = dbFor(base, hash(base));
    const tampered = await persistSpatialCadCommand(tamperedDb, 'user-1', 'project-1', { baseProjectRevision: 0, baseContentHash: 'a'.repeat(64), documentId: 'doc-1', locks: [], parameterPaths: ['lengthM'], command });
    expect(tampered).toMatchObject({ ok: false, code: 'CONTENT_HASH_CONFLICT' });
    expect(tamperedDb.writes).toEqual([]);
    const lock = { id: 'lock-1', target: { kind: 'parameter', objectId: 'doc-1', field: 'lengthM' } };
    const lockDb = dbFor(base, hash(base), [lock]);
    const locked = await persistSpatialCadCommand(lockDb, 'user-1', 'project-1', { baseProjectRevision: 0, baseContentHash: hash(base), documentId: 'doc-1', locks: [lock], parameterPaths: ['lengthM'], command });
    expect(locked).toMatchObject({ ok: false, code: 'LOCK_CONFLICT' });
    expect(lockDb.writes).toEqual([]);
  });

  it('recomputes the stored payload hash before applying', async () => {
    const corrupted = { ...base, parameters: { lengthM: 999 } };
    const db = dbFor(base, hash(base), [], corrupted);
    const result = await persistSpatialCadCommand(db, 'user-1', 'project-1', { baseProjectRevision: 0, baseContentHash: hash(base), documentId: 'doc-1', locks: [], parameterPaths: ['lengthM'], command });
    expect(result).toMatchObject({ ok: false, code: 'CONTENT_HASH_CONFLICT', issues: ['server_document_hash_mismatch'] });
    expect(db.writes).toEqual([]);
  });

  it('compares the client lock projection while preserving server ownership metadata', async () => {
    const lock: SpatialCadLockDto = { id: 'lock-width', target: { kind: 'parameter', objectId: 'doc-1', field: 'width' }, scope: spatialCadLockScope('project-1', 'civil', 'doc-1'), source: 'human', reason: 'edit', createdAt: '2026-01-01T00:00:00.000Z', ownerUserId: 'user-2' };
    const db = dbFor(base, hash(base), [lock]);
    const result = await persistSpatialCadCommand(db, 'user-1', 'project-1', { baseProjectRevision: 0, baseContentHash: hash(base), documentId: 'doc-1', locks: [{ id: lock.id, target: lock.target }], parameterPaths: ['lengthM'], command });
    expect(result).toMatchObject({ ok: true, draft: { locks: [{ id: 'lock-width', ownerUserId: 'user-2' }] } });
  });
});
