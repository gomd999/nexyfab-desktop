import { describe, expect, it } from 'vitest';
import type { DbAdapter } from '@/lib/db-adapter';
import {
  canonicalCadConsumerDraftJson,
  createCanonicalCadDocumentV2,
  hashCanonicalCadLockSet,
  sealCanonicalCadCommandV2,
  sealCanonicalCadObjectV2,
  type CanonicalCadActor,
  type CanonicalCadCommandV2ConsumerDraft,
  type CanonicalCadDocumentV2ConsumerDraft,
  type CanonicalCadLockEvidence,
} from './canonicalCadV2ConsumerDraft';
import {
  CANONICAL_CAD_DERIVED_INVALIDATIONS,
  CANONICAL_CAD_REVISION_MIGRATION_VERSION,
  commitCanonicalCadRevision,
  type CanonicalCadRevisionTransactionHooks,
} from './canonicalCadRevisionStore';

type Row = Record<string, unknown>;

const NOW = '2026-08-24T00:30:00.000Z';
const h = (character: string) => character.repeat(64);

function document(): CanonicalCadDocumentV2ConsumerDraft {
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

function command(
  base: CanonicalCadDocumentV2ConsumerDraft,
  overrides: {
    value?: number;
    idempotencyKey?: string;
    commandId?: string;
    nextRevisionId?: string;
    actor?: CanonicalCadActor;
    locks?: CanonicalCadLockEvidence[];
  } = {},
): CanonicalCadCommandV2ConsumerDraft {
  const target = base.objects[0]!;
  const locks = overrides.locks ?? [];
  return sealCanonicalCadCommandV2({
    commandId: overrides.commandId ?? 'command-1',
    idempotencyKey: overrides.idempotencyKey ?? 'idempotency-1',
    projectId: base.projectId,
    documentId: base.documentId,
    baseRevision: base.revision,
    nextRevisionId: overrides.nextRevisionId ?? 'revision-1',
    actor: overrides.actor ?? { kind: 'human', actorId: 'user-1', agentIdentity: null },
    units: base.units,
    coordinateFrame: base.coordinateFrame,
    tolerancePolicy: base.tolerancePolicy,
    preconditions: {
      lockSetSha256: hashCanonicalCadLockSet(locks), locks,
      selectedObjectIds: [target.objectId], parameterPaths: ['payload.width'],
    },
    dependencies: [], compensationForCommandId: null,
    expectedChangedObjectIds: [target.objectId],
    artifacts: { inputs: [], expectedOutputs: [] },
    authorization: { permission: 'EDIT_DOCUMENT', riskClass: 'R2', approvalScope: base.documentId, approvalReceiptSha256: null },
    resourceBudget: { timeoutMs: 10_000, memoryMb: 512, maxIterations: 10, maxRetries: 0 },
    sideEffects: { canonicalDocument: true, externalTransmission: false, quoteOrRfq: false },
    verification: { verifierIds: ['canonical-structure'], blockers: [] },
    timing: { issuedAt: '2026-08-24T00:00:00.000Z', expiresAt: '2026-08-24T01:00:00.000Z' },
    staleIf: { baseRevisionChanges: true, baseContentHashChanges: true },
    operations: [{
      kind: 'update', objectId: target.objectId,
      expectedObjectContentSha256: target.contentSha256,
      payload: { width: overrides.value ?? 1250 },
    }],
  });
}

class FakeDb implements DbAdapter {
  readonly backend = 'postgres' as const;
  migrationAvailable = true;
  forceCasMiss = false;
  forceRevisionInsertMiss = false;
  forceInvalidationInsertMiss = false;
  ddlCalls = 0;
  head: Row;
  revisions: Row[];
  invalidations: Row[] = [];
  downstream: Row[] = [];
  audits: Row[] = [];
  lastCasParams: unknown[] = [];

  constructor(base = document()) {
    this.head = {
      project_id: base.projectId, document_id: base.documentId,
      revision_id: base.revision.revisionId, sequence: base.revision.sequence,
      content_hash: base.revision.contentSha256,
    };
    this.revisions = [{
      id: 'baseline-row', ...this.head,
      parent_revision_id: null, parent_sequence: null, parent_content_hash: null,
      document_json: canonicalCadConsumerDraftJson(base), command_id: null,
      command_sha256: null, idempotency_key: null, command_json: null,
      compensation_for_command_id: null, receipt_json: null, receipt_sha256: null,
      created_by: 'migration', created_at: 1,
    }];
  }

  private revisionByIdentity(params: unknown[]): Row | undefined {
    return this.revisions.find(row => row.project_id === params[0] && row.document_id === params[1]
      && row.revision_id === params[2] && Number(row.sequence) === Number(params[3]) && row.content_hash === params[4]);
  }

  async queryOne<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    if (sql.includes('nf_schema_migrations')) {
      return (this.migrationAvailable
        ? { version: CANONICAL_CAD_REVISION_MIGRATION_VERSION, checksum: h('f') }
        : undefined) as T | undefined;
    }
    if (sql.includes('LIMIT 1') && params.length === 0) return undefined;
    if (sql.includes('FROM nf_cad_canonical_v2_heads')) return { ...this.head } as T;
    if (sql.includes('idempotency_key = ?')) {
      return this.revisions.find(row => row.project_id === params[0] && row.document_id === params[1] && row.idempotency_key === params[2]) as T | undefined;
    }
    if (sql.includes('compensation_for_command_id = ?')) {
      return this.revisions.find(row => row.project_id === params[0] && row.document_id === params[1] && row.compensation_for_command_id === params[2]) as T | undefined;
    }
    if (sql.includes('command_id = ?')) {
      return this.revisions.find(row => row.project_id === params[0] && row.document_id === params[1] && row.command_id === params[2]) as T | undefined;
    }
    if (sql.includes('FROM nf_cad_canonical_v2_revisions')) return this.revisionByIdentity(params) as T | undefined;
    return undefined;
  }

  async queryAll<T>(): Promise<T[]> { return []; }

  async execute(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    if (sql.startsWith('INSERT INTO nf_cad_canonical_v2_revisions')) {
      if (this.forceRevisionInsertMiss) return { changes: 0 };
      const [id, project_id, document_id, revision_id, sequence, content_hash,
        parent_revision_id, parent_sequence, parent_content_hash, document_json,
        command_id, command_sha256, idempotency_key, command_json,
        compensation_for_command_id, receipt_json, receipt_sha256, created_by, created_at] = params;
      this.revisions.push({ id, project_id, document_id, revision_id, sequence, content_hash,
        parent_revision_id, parent_sequence, parent_content_hash, document_json,
        command_id, command_sha256, idempotency_key, command_json,
        compensation_for_command_id, receipt_json, receipt_sha256, created_by, created_at });
      return { changes: 1 };
    }
    if (sql.startsWith('UPDATE nf_cad_canonical_v2_heads')) {
      this.lastCasParams = params;
      const matches = !this.forceCasMiss
        && this.head.project_id === params[4] && this.head.document_id === params[5]
        && this.head.revision_id === params[6] && Number(this.head.sequence) === Number(params[7])
        && this.head.content_hash === params[8];
      if (!matches) return { changes: 0 };
      this.head = { ...this.head, revision_id: params[0], sequence: params[1], content_hash: params[2] };
      return { changes: 1 };
    }
    if (sql.startsWith('INSERT INTO nf_cad_canonical_v2_invalidations')) {
      if (this.forceInvalidationInsertMiss) return { changes: 0 };
      this.invalidations.push({ revision_id: params[0], project_id: params[1], document_id: params[2], scope: params[3] });
      return { changes: 1 };
    }
    if (sql.startsWith('INSERT INTO test_downstream')) { this.downstream.push({ revision_id: params[0] }); return { changes: 1 }; }
    if (sql.startsWith('INSERT INTO test_audit')) { this.audits.push({ receipt_sha256: params[0] }); return { changes: 1 }; }
    return { changes: 0 };
  }

  async executeRaw(): Promise<void> { this.ddlCalls++; throw new Error('request-time DDL forbidden'); }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    const snapshot = structuredClone({
      head: this.head, revisions: this.revisions, invalidations: this.invalidations,
      downstream: this.downstream, audits: this.audits,
    });
    try { return await fn(this); }
    catch (error) {
      this.head = snapshot.head;
      this.revisions = snapshot.revisions;
      this.invalidations = snapshot.invalidations;
      this.downstream = snapshot.downstream;
      this.audits = snapshot.audits;
      throw error;
    }
  }

  async close(): Promise<void> { /* no-op */ }
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

function input(db: FakeDb, draftCommand = command(document()), currentLocks: CanonicalCadLockEvidence[] = []) {
  return {
    projectId: 'project-1', documentId: 'document-1', authenticatedActorId: 'user-1',
    command: draftCommand, execution: { currentLocks, evaluatedAt: NOW }, hooks: hooks(),
  };
}

describe('canonical CAD v2 server revision store', () => {
  it('fails closed without the integration migration and never emits DDL', async () => {
    const db = new FakeDb(); db.migrationAvailable = false;
    await expect(commitCanonicalCadRevision(db, input(db))).resolves.toMatchObject({ ok: false, code: 'MIGRATION_REQUIRED' });
    expect(db.revisions).toHaveLength(1);
    expect(db.ddlCalls).toBe(0);
  });

  it('requires the reviewed checksum configuration in commercial mode', async () => {
    const previousMode = process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE;
    const previousChecksum = process.env.CANONICAL_CAD_REVISION_MIGRATION_CHECKSUM;
    process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE = '1';
    delete process.env.CANONICAL_CAD_REVISION_MIGRATION_CHECKSUM;
    try {
      await expect(commitCanonicalCadRevision(new FakeDb(), input(new FakeDb()))).resolves.toMatchObject({ ok: false, code: 'MIGRATION_REQUIRED' });
      process.env.CANONICAL_CAD_REVISION_MIGRATION_CHECKSUM = h('e');
      await expect(commitCanonicalCadRevision(new FakeDb(), input(new FakeDb()))).resolves.toMatchObject({ ok: false, code: 'MIGRATION_REQUIRED' });
    } finally {
      if (previousMode === undefined) delete process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE;
      else process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE = previousMode;
      if (previousChecksum === undefined) delete process.env.CANONICAL_CAD_REVISION_MIGRATION_CHECKSUM;
      else process.env.CANONICAL_CAD_REVISION_MIGRATION_CHECKSUM = previousChecksum;
    }
  });

  it('commits one immutable revision with full-triplet CAS, invalidations and audit', async () => {
    const db = new FakeDb();
    const result = await commitCanonicalCadRevision(db, input(db));
    expect(result).toMatchObject({ ok: true, replayed: false, receipt: { authority: 'SERVER_CANONICAL_DRAFT_REVISION', verification: 'NOT_RUN', release: 'HOLD' } });
    expect(db.revisions).toHaveLength(2);
    expect(db.invalidations.map(row => row.scope)).toEqual(CANONICAL_CAD_DERIVED_INVALIDATIONS);
    expect(db.downstream).toHaveLength(1);
    expect(db.audits).toHaveLength(1);
    const base = document().revision;
    expect(db.lastCasParams.slice(6, 9)).toEqual([base.revisionId, base.sequence, base.contentSha256]);
  });

  it('returns the exact durable receipt on replay and rejects key payload substitution', async () => {
    const db = new FakeDb(); const original = command(document());
    const first = await commitCanonicalCadRevision(db, input(db, original));
    const replay = await commitCanonicalCadRevision(db, input(db, original));
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(replay.ok && first.ok && replay.receipt).toEqual(first.ok ? first.receipt : null);
    expect(db.revisions).toHaveLength(2);
    const substituted = command(document(), { value: 1400, idempotencyKey: original.idempotencyKey });
    await expect(commitCanonicalCadRevision(db, input(db, substituted))).resolves.toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(db.revisions).toHaveLength(2);
  });

  it('holds non-human actors, binds the authenticated human, and uses live lock/time context', async () => {
    const base = document();
    const agent = command(base, { actor: { kind: 'agent', actorId: 'agent-1', agentIdentity: { agentId: 'agent-1', modelId: 'model-1', promptSha256: h('a') } } });
    await expect(commitCanonicalCadRevision(new FakeDb(), { ...input(new FakeDb(), agent), authenticatedActorId: 'agent-1' })).resolves.toMatchObject({ ok: false, code: 'HOLD' });
    await expect(commitCanonicalCadRevision(new FakeDb(), { ...input(new FakeDb()), authenticatedActorId: 'other-user' })).resolves.toMatchObject({ ok: false, code: 'INVALID_REQUEST', issues: ['authenticated_actor_mismatch'] });

    const liveLock: CanonicalCadLockEvidence = { lockId: 'lock-1', scope: 'object', objectId: base.objects[0]!.objectId, fieldPath: null, ownerActorId: 'reviewer-1', source: 'authority' };
    await expect(commitCanonicalCadRevision(new FakeDb(), input(new FakeDb(), command(base), [liveLock]))).resolves.toMatchObject({ ok: false, code: 'INVALID_COMMAND', issues: expect.arrayContaining(['lock_snapshot_stale']) });
    await expect(commitCanonicalCadRevision(new FakeDb(), { ...input(new FakeDb(), command(base)), execution: { currentLocks: [], evaluatedAt: '2026-08-24T01:00:00.000Z' } })).resolves.toMatchObject({ ok: false, code: 'INVALID_COMMAND', issues: expect.arrayContaining(['command_expired']) });
  });

  it('rehashes the stored head and fails closed on corruption', async () => {
    const db = new FakeDb(); db.revisions[0]!.document_json = JSON.stringify({ bad: true });
    await expect(commitCanonicalCadRevision(db, input(db))).resolves.toMatchObject({ ok: false, code: 'CORRUPT_SERVER_STATE' });
    expect(db.revisions).toHaveLength(1);
  });

  it('throws inside the transaction on CAS miss and leaves no orphan revision', async () => {
    const db = new FakeDb(); db.forceCasMiss = true;
    await expect(commitCanonicalCadRevision(db, input(db))).resolves.toMatchObject({ ok: false, code: 'REVISION_CONFLICT' });
    expect(db.revisions).toHaveLength(1);
    expect(db.invalidations).toHaveLength(0);
    expect(db.head.sequence).toBe(0);
  });

  it('fails closed and rolls back if a revision or invalidation write affects no row', async () => {
    for (const failure of ['revision', 'invalidation'] as const) {
      const db = new FakeDb();
      if (failure === 'revision') db.forceRevisionInsertMiss = true;
      else db.forceInvalidationInsertMiss = true;
      await expect(commitCanonicalCadRevision(db, input(db))).resolves.toMatchObject({ ok: false, code: 'CORRUPT_SERVER_STATE' });
      expect(db.revisions).toHaveLength(1);
      expect(db.invalidations).toHaveLength(0);
      expect(db.head.sequence).toBe(0);
    }
  });

  it('rolls revision, head and invalidations back when the audit adapter fails', async () => {
    const db = new FakeDb();
    await expect(commitCanonicalCadRevision(db, { ...input(db), hooks: hooks(true) })).rejects.toThrow('audit_failed');
    expect(db.revisions).toHaveLength(1);
    expect(db.invalidations).toHaveLength(0);
    expect(db.downstream).toHaveLength(0);
    expect(db.head.sequence).toBe(0);
  });
});
