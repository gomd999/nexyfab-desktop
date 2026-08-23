import { describe, expect, it, vi } from 'vitest';
import { persistCommercialWorkerResult } from './commercialWorkerPersistenceCoordinator';
import { makeCommercialPersistenceFixture } from './commercialWorkerPersistenceCoordinator.testFixture';

function input(fixture: ReturnType<typeof makeCommercialPersistenceFixture>) {
  return { db: fixture.db, artifactStore: fixture.artifactStore, receipt: fixture.workerReceipt, expected: fixture.expected as never, trustedWorkers: fixture.trustedWorkers, metadata: fixture.workerMetadata, parserReceipt: fixture.parserReceipt, trustedParser: fixture.trustedParser, now: Date.parse('2026-08-22T12:01:00.000Z') };
}

describe('commercial worker persistence PostgreSQL transaction contract', () => {
  it('commits exact artifacts, parser/persistence receipts, workspace CAS, journal and outbox atomically', async () => {
    const fixture = makeCommercialPersistenceFixture(); const executor = vi.fn();
    const result = await persistCommercialWorkerResult(input(fixture));
    expect(result).toMatchObject({ ok: true, status: 'COMMITTED', executionId: fixture.workerReceipt.executionId });
    expect(executor).not.toHaveBeenCalled();
    const state = fixture.db.readState();
    expect(state.journal.lifecycle).toBe('COMMITTED');
    expect(state.outbox.status).toBe('DONE');
    expect(state.head).toEqual({ revision: 5, content_hash: fixture.parserReceipt.workspaceAfter.contentHash });
    expect(state.snapshots).toHaveLength(3);
    expect(state.parserReceipts).toHaveLength(1);
    expect(state.persistenceReceipts).toHaveLength(1);
    expect(state.workspaceCommits).toHaveLength(1);
    expect(state.events).toHaveLength(1);
    expect(state.workerReceiptRows).toHaveLength(1);
  });

  it('response-loss retry is an exact persistence replay and never copies or executes again', async () => {
    const fixture = makeCommercialPersistenceFixture(); const first = await persistCommercialWorkerResult(input(fixture));
    expect(first.ok).toBe(true);
    const put = vi.spyOn(fixture.artifactStore, 'putImmutable'); const executor = vi.fn();
    const replay = await persistCommercialWorkerResult(input(fixture));
    expect(replay).toMatchObject({ ok: true, status: 'REPLAY', executionId: fixture.workerReceipt.executionId });
    expect(put).not.toHaveBeenCalled(); expect(executor).not.toHaveBeenCalled();
  });

  it('rolls back all DB-visible rows on a mid-transaction failure while leaving only orphan snapshots', async () => {
    const fixture = makeCommercialPersistenceFixture(); const before = fixture.db.readState(); fixture.db.failOn = 'nf_precision_cad_commercial_persistence_receipts';
    const result = await persistCommercialWorkerResult(input(fixture));
    expect(result).toMatchObject({ ok: false, status: 'HOLD', code: 'PERSISTENCE_CONFLICT' });
    expect(fixture.db.readState()).toEqual(before);
    const stored = await fixture.artifactStore.read('private/commercial-snapshots/tenant-1/project-1/not-used/model-1');
    expect(stored).toBeNull();
    const keys = [...(fixture.artifactStore as unknown as { values: Map<string, Uint8Array> }).values.keys()];
    expect(keys.some(key => key.startsWith(`private/commercial-snapshots/tenant-1/project-1/${fixture.workerReceipt.executionId}/`))).toBe(true);
  });

  it('does not advance a stale workspace head and leaves the copied snapshot as explicit orphan', async () => {
    const fixture = makeCommercialPersistenceFixture();
    const state = fixture.db.readState(); state.head = { revision: 3, content_hash: 'z'.repeat(64) }; fixture.db.restore(state);
    const result = await persistCommercialWorkerResult(input(fixture));
    expect(result).toMatchObject({ ok: false, status: 'HOLD', code: 'WORKSPACE_STALE' });
    expect(fixture.db.readState().journal.lifecycle).toBe('EXECUTING');
    expect(fixture.db.readState().outbox.status).toBe('VERIFIED_UNKNOWN');
  });

  it('holds parser manifest transplant before any DB mutation', async () => {
    const fixture = makeCommercialPersistenceFixture(); fixture.parserReceipt.manifest[0]!.objectKey = 'commercial-snapshots/transplanted';
    const before = fixture.db.readState();
    const result = await persistCommercialWorkerResult(input(fixture));
    expect(result).toMatchObject({ ok: false, status: 'HOLD', code: 'PARSER_INVALID' });
    expect(fixture.db.readState()).toEqual(before);
  });

  it('fails closed on migration/backend boundary and performs no request-time DDL', async () => {
    const fixture = makeCommercialPersistenceFixture(); fixture.db.failOn = 'nf_schema_migrations';
    const result = await persistCommercialWorkerResult(input(fixture));
    expect(result).toMatchObject({ ok: false, status: 'HOLD', code: 'MIGRATION_REQUIRED' });
  });
});
