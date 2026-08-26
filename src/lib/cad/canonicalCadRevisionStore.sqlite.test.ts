import BetterSqlite from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import {
  canonicalCadConsumerDraftJson,
  createCanonicalCadDocumentV2,
  hashCanonicalCadLockSet,
  sealCanonicalCadCommandV2,
  sealCanonicalCadObjectV2,
  type CanonicalCadDocumentV2ConsumerDraft,
} from './canonicalCadV2ConsumerDraft';
import {
  CANONICAL_CAD_DERIVED_INVALIDATIONS,
  CANONICAL_CAD_REVISION_MIGRATION_VERSION,
  commitCanonicalCadRevision,
  readCanonicalCadRevisionHead,
  type CanonicalCadRevisionTransactionHooks,
} from './canonicalCadRevisionStore';

const NOW = '2026-08-24T00:30:00.000Z';
const h = (character: string) => character.repeat(64);

const SCHEMA = `
  CREATE TABLE nf_schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at BIGINT NOT NULL, checksum TEXT NOT NULL);
  CREATE TABLE nf_cad_canonical_v2_revisions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    parent_revision_id TEXT,
    parent_sequence INTEGER,
    parent_content_hash TEXT,
    document_json TEXT NOT NULL,
    command_id TEXT,
    command_sha256 TEXT,
    idempotency_key TEXT,
    command_json TEXT,
    compensation_for_command_id TEXT,
    receipt_json TEXT,
    receipt_sha256 TEXT,
    created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    UNIQUE(project_id, document_id, revision_id),
    UNIQUE(project_id, document_id, sequence),
    UNIQUE(project_id, document_id, command_id),
    UNIQUE(project_id, document_id, idempotency_key)
  );
  CREATE UNIQUE INDEX ux_nf_cad_v2_compensation_once
    ON nf_cad_canonical_v2_revisions(project_id, document_id, compensation_for_command_id)
    WHERE compensation_for_command_id IS NOT NULL;
  CREATE TABLE nf_cad_canonical_v2_heads (
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY(project_id, document_id)
  );
  CREATE TABLE nf_cad_canonical_v2_invalidations (
    revision_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY(revision_id, scope)
  );
  CREATE TABLE nf_cad_canonical_v2_locks (
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    lock_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    object_id TEXT,
    field_path TEXT,
    owner_actor_id TEXT NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY(project_id, document_id, lock_id)
  );
  CREATE TABLE nf_cad_canonical_v2_audit (
    receipt_sha256 TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    event_json TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE TABLE test_downstream (revision_id TEXT PRIMARY KEY);
  CREATE TABLE test_audit (receipt_sha256 TEXT PRIMARY KEY);
`;

function sqliteAdapter(database: BetterSqlite.Database): DbAdapter & { rawCalls: number } {
  const adapter: DbAdapter & { rawCalls: number } = {
    backend: 'sqlite', rawCalls: 0,
    async queryOne<T>(sql: string, ...params: SqlParam[]) { return database.prepare(sql).get(...params) as T | undefined; },
    async queryAll<T>(sql: string, ...params: SqlParam[]) { return database.prepare(sql).all(...params) as T[]; },
    async execute(sql: string, ...params: SqlParam[]) { return { changes: database.prepare(sql).run(...params).changes }; },
    async executeRaw(sql: string) { adapter.rawCalls++; database.exec(sql); },
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>) {
      database.exec('BEGIN IMMEDIATE');
      try { const result = await fn(adapter); database.exec('COMMIT'); return result; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    async close() { database.close(); },
  };
  return adapter;
}

function baseDocument(): CanonicalCadDocumentV2ConsumerDraft {
  const wall = sealCanonicalCadObjectV2({
    objectId: 'building:wall-1', namespace: 'building', objectKind: 'building.wall',
    objectRevision: 0, payload: { width: 1000 }, transform: null,
  });
  return createCanonicalCadDocumentV2({
    projectId: 'project-1', documentId: 'document-1', domains: ['building'],
    revision: { revisionId: 'revision-0', sequence: 0, contentSha256: h('0') },
    units: { length: 'mm', angle: 'deg' },
    coordinateFrame: { frameId: 'project-frame', parentFrameId: null, origin: [0, 0, 0], rotationDeg: [0, 0, 0] },
    tolerancePolicy: { linear: 0.01, angularDeg: 0.1 },
    objects: [wall], relationships: [],
    sourceBindings: [{ schema: 'source.v1', revision: '0', contentSha256: h('a') }],
  });
}

function nextCommand(base: CanonicalCadDocumentV2ConsumerDraft, value = 1250) {
  const target = base.objects[0]!;
  return sealCanonicalCadCommandV2({
    commandId: 'command-1', idempotencyKey: 'idempotency-1',
    projectId: base.projectId, documentId: base.documentId, baseRevision: base.revision,
    nextRevisionId: 'revision-1', actor: { kind: 'human', actorId: 'user-1', agentIdentity: null },
    units: base.units, coordinateFrame: base.coordinateFrame, tolerancePolicy: base.tolerancePolicy,
    preconditions: { lockSetSha256: hashCanonicalCadLockSet([]), locks: [], selectedObjectIds: [target.objectId], parameterPaths: ['payload.width'] },
    dependencies: [], compensationForCommandId: null, expectedChangedObjectIds: [target.objectId],
    artifacts: { inputs: [], expectedOutputs: [] },
    authorization: { permission: 'EDIT_DOCUMENT', riskClass: 'R2', approvalScope: base.documentId, approvalReceiptSha256: null },
    resourceBudget: { timeoutMs: 10_000, memoryMb: 512, maxIterations: 10, maxRetries: 0 },
    sideEffects: { canonicalDocument: true, externalTransmission: false, quoteOrRfq: false },
    verification: { verifierIds: ['canonical-structure'], blockers: [] },
    timing: { issuedAt: '2026-08-24T00:00:00.000Z', expiresAt: '2026-08-24T01:00:00.000Z' },
    staleIf: { baseRevisionChanges: true, baseContentHashChanges: true },
    operations: [{ kind: 'update', objectId: target.objectId, expectedObjectContentSha256: target.contentSha256, payload: { width: value } }],
  });
}

function setup() {
  const database = new BetterSqlite(':memory:');
  database.exec(SCHEMA);
  database.prepare('INSERT INTO nf_schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)')
    .run(CANONICAL_CAD_REVISION_MIGRATION_VERSION, 'canonical-cad-v2-revisions', 1, h('f'));
  const base = baseDocument();
  database.prepare(`INSERT INTO nf_cad_canonical_v2_revisions
    (id, project_id, document_id, revision_id, sequence, content_hash,
     parent_revision_id, parent_sequence, parent_content_hash, document_json,
     command_id, command_sha256, idempotency_key, command_json,
     compensation_for_command_id, receipt_json, receipt_sha256, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`)
    .run('baseline-row', base.projectId, base.documentId, base.revision.revisionId,
      base.revision.sequence, base.revision.contentSha256, canonicalCadConsumerDraftJson(base), 'migration', 1);
  database.prepare('INSERT INTO nf_cad_canonical_v2_heads (project_id, document_id, revision_id, sequence, content_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(base.projectId, base.documentId, base.revision.revisionId, base.revision.sequence, base.revision.contentSha256, 1);
  const db = sqliteAdapter(database);
  return { database, db, base };
}

function hooks(failAudit = false): CanonicalCadRevisionTransactionHooks {
  return {
    async invalidateDerived(tx, event) {
      await tx.execute('INSERT INTO test_downstream (revision_id) VALUES (?)', event.revision.revisionId);
    },
    async appendAudit(tx, event) {
      if (failAudit) throw new Error('audit_failed');
      await tx.execute('INSERT INTO test_audit (receipt_sha256) VALUES (?)', event.receiptSha256);
    },
  };
}

describe('canonical CAD v2 SQLite revision transaction', () => {
  it('commits, reads, and exactly replays without request-time DDL', async () => {
    const { database, db, base } = setup(); const draftCommand = nextCommand(base);
    const request = { projectId: base.projectId, documentId: base.documentId, authenticatedActorId: 'user-1', command: draftCommand, execution: { currentLocks: [], evaluatedAt: NOW }, hooks: hooks() };
    const first = await commitCanonicalCadRevision(db, request);
    expect(first).toMatchObject({ ok: true, replayed: false, document: { revision: { sequence: 1 } } });
    expect(await readCanonicalCadRevisionHead(db, base.projectId, base.documentId)).toMatchObject({ ok: true, head: { revision: { sequence: 1 } } });
    const replay = await commitCanonicalCadRevision(db, request);
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(replay.ok && first.ok && replay.receipt).toEqual(first.ok ? first.receipt : null);
    expect(database.prepare('SELECT COUNT(*) AS count FROM nf_cad_canonical_v2_revisions').get()).toMatchObject({ count: 2 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM nf_cad_canonical_v2_invalidations').get()).toMatchObject({ count: CANONICAL_CAD_DERIVED_INVALIDATIONS.length });
    expect(database.prepare('SELECT COUNT(*) AS count FROM test_audit').get()).toMatchObject({ count: 1 });
    expect(db.rawCalls).toBe(0);
    await db.close();
  });

  it('rolls every write back when audit fails', async () => {
    const { database, db, base } = setup();
    await expect(commitCanonicalCadRevision(db, {
      projectId: base.projectId, documentId: base.documentId, authenticatedActorId: 'user-1',
      command: nextCommand(base), execution: { currentLocks: [], evaluatedAt: NOW }, hooks: hooks(true),
    })).rejects.toThrow('audit_failed');
    expect(database.prepare('SELECT COUNT(*) AS count FROM nf_cad_canonical_v2_revisions').get()).toMatchObject({ count: 1 });
    expect(database.prepare('SELECT sequence FROM nf_cad_canonical_v2_heads').get()).toMatchObject({ sequence: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM nf_cad_canonical_v2_invalidations').get()).toMatchObject({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM test_downstream').get()).toMatchObject({ count: 0 });
    await db.close();
  });

  it('turns a zero-row CAS into a rollback and leaves no orphan revision', async () => {
    const { database, db, base } = setup();
    database.exec(`CREATE TRIGGER force_cad_head_cas_miss BEFORE UPDATE ON nf_cad_canonical_v2_heads
      BEGIN SELECT RAISE(IGNORE); END;`);
    const result = await commitCanonicalCadRevision(db, {
      projectId: base.projectId, documentId: base.documentId, authenticatedActorId: 'user-1',
      command: nextCommand(base), execution: { currentLocks: [], evaluatedAt: NOW }, hooks: hooks(),
    });
    expect(result).toMatchObject({ ok: false, code: 'REVISION_CONFLICT' });
    expect(database.prepare('SELECT COUNT(*) AS count FROM nf_cad_canonical_v2_revisions').get()).toMatchObject({ count: 1 });
    expect(database.prepare('SELECT sequence FROM nf_cad_canonical_v2_heads').get()).toMatchObject({ sequence: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM nf_cad_canonical_v2_invalidations').get()).toMatchObject({ count: 0 });
    await db.close();
  });
});
