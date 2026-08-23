import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DbAdapter } from '@/lib/db-adapter';
import { createSpatialCadDocument, type SpatialCadDocument } from './spatialCadCommand';
import { persistSpatialCadDraft, releaseSpatialCadDraftLocks } from './spatialCadDraftStore';
import { spatialCadLockScope, type SpatialCadLockDto } from './spatialCadLocks';
import { stableSpatialCadDocumentJson } from './spatialCadHash';

const hash = (document: SpatialCadDocument) => createHash('sha256').update(stableSpatialCadDocumentJson(document)).digest('hex');

function fakeDb(head: Record<string, unknown> | undefined, documents: Map<number, SpatialCadDocument>) {
  const writes: string[] = [];
  const db: DbAdapter & { writes: string[] } = {
    backend: 'sqlite',
    async queryOne<T>(sql: string, ...params: unknown[]) {
      if (sql.includes('FROM nf_spatial_cad_draft_heads')) return head as T;
      if (sql.includes('FROM nf_spatial_cad_drafts')) {
        const doc = documents.get(Number(params[2]));
        return doc ? { payload_json: JSON.stringify(doc), content_hash: hash(doc), document_revision: doc.revision, created_at: 1 } as T : undefined;
      }
      return undefined;
    },
    async queryAll() { return []; },
    async execute(sql: string, ...params: unknown[]) {
      writes.push(sql);
      if (sql.startsWith('UPDATE nf_spatial_cad_draft_heads') && head) {
        head.project_revision = Number(params[0]);
        head.content_hash = String(params[1]);
        if (sql.includes('locks_json')) head.locks_json = String(params[3]);
        return { changes: 1 };
      }
      if (sql.startsWith('INSERT INTO nf_spatial_cad_drafts')) {
        documents.set(Number(params[3]), JSON.parse(String(params[6])) as SpatialCadDocument);
      }
      if (sql.startsWith('INSERT INTO nf_spatial_cad_draft_heads') && head) {
        head.project_revision = Number(params[2]);
        head.content_hash = String(params[3]);
        head.document_id = String(params[4]);
        head.locks_json = String(params[5]);
      }
      return { changes: 1 };
    },
    async executeRaw() {},
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>) { return fn(db); },
    async close() {},
    writes,
  };
  return db;
}

describe('spatial CAD authoritative human locks', () => {
  it('does not derive locks for the baseline and atomically audits the save', async () => {
    const document = createSpatialCadDocument('building', { width: 10 });
    const db = fakeDb(undefined, new Map());
    const result = await persistSpatialCadDraft(db, 'user-1', 'project-1', -1, document, { documentId: 'doc-1' });
    expect(result).toMatchObject({ ok: true, draft: { locks: [] } });
    expect(db.writes.filter(sql => sql.includes('nf_audit_log'))).toHaveLength(1);
  });

  it('dedupes nested changes into stable top-level human locks and preserves omission', async () => {
    const current = createSpatialCadDocument('civil', { corridor: { width: 10, slope: 1 }, lengthM: 20 });
    const existing: SpatialCadLockDto = { id: 'old', target: { kind: 'parameter', objectId: 'doc-1', field: 'lengthM' }, scope: spatialCadLockScope('project-1', 'civil', 'doc-1'), source: 'human', reason: 'old', createdAt: '2026-01-01T00:00:00.000Z', ownerUserId: 'other' };
    const head = { project_revision: 0, content_hash: hash(current), document_id: 'doc-1', locks_json: JSON.stringify([existing]) };
    const db = fakeDb(head, new Map([[0, current]]));
    const next = { ...current, revision: 1, parameters: { corridor: { width: 12, slope: 2 }, lengthM: 20 } };
    const result = await persistSpatialCadDraft(db, 'user-1', 'project-1', 0, next, { documentId: 'doc-1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.locks?.map(lock => lock.target.field)).toEqual(['corridor', 'lengthM']);
      expect(result.draft.locks?.find(lock => lock.target.field === 'corridor')?.ownerUserId).toBe('user-1');
    }
  });

  it('keeps separate stable ownership when two users edit the same field', async () => {
    const current = createSpatialCadDocument('building', { width: 10 });
    const head = { project_revision: 0, content_hash: hash(current), document_id: 'doc-1', locks_json: '[]' };
    const db = fakeDb(head, new Map([[0, current]]));
    const first = { ...current, revision: 1, parameters: { width: 11 } };
    expect((await persistSpatialCadDraft(db, 'user-1', 'project-1', 0, first, { documentId: 'doc-1' })).ok).toBe(true);
    const second = { ...first, revision: 2, parameters: { width: 12 } };
    const result = await persistSpatialCadDraft(db, 'user-2', 'project-1', 1, second, { documentId: 'doc-1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.locks).toHaveLength(2);
      expect(new Set(result.draft.locks?.map(lock => lock.ownerUserId))).toEqual(new Set(['user-1', 'user-2']));
    }
  });

  it('rejects malformed persisted locks without writing', async () => {
    const current = createSpatialCadDocument('building', { width: 10 });
    const db = fakeDb({ project_revision: 0, content_hash: hash(current), document_id: 'doc-1', locks_json: JSON.stringify([{ id: 'bad' }]) }, new Map([[0, current]]));
    const result = await persistSpatialCadDraft(db, 'user-1', 'project-1', 0, { ...current, revision: 1, parameters: { width: 11 } }, { documentId: 'doc-1' });
    expect(result).toMatchObject({ ok: false, code: 'LOCK_CONFLICT' });
    expect(db.writes).toEqual([]);
  });

  it('releases locks with a lock-only revision and one atomic audit', async () => {
    const current = createSpatialCadDocument('landscape', { widthM: 10 });
    const lock: SpatialCadLockDto = { id: 'human-1', target: { kind: 'parameter', objectId: 'doc-1', field: 'widthM' }, scope: spatialCadLockScope('project-1', 'landscape', 'doc-1'), source: 'human', reason: 'edit', createdAt: '2026-01-01T00:00:00.000Z', ownerUserId: 'user-1' };
    const head = { project_revision: 0, content_hash: hash(current), document_id: 'doc-1', locks_json: JSON.stringify([lock]) };
    const db = fakeDb(head, new Map([[0, current]]));
    const result = await releaseSpatialCadDraftLocks(db, 'user-1', 'project-1', 'landscape', { baseProjectRevision: 0, contentHash: hash(current), documentId: 'doc-1', lockIds: ['human-1'] });
    expect(result).toMatchObject({ ok: true, draft: { projectRevision: 1, contentHash: hash(current), document: { revision: 0 }, locks: [] } });
    expect(db.writes.filter(sql => sql.includes('nf_audit_log'))).toHaveLength(1);
  });
});
