import BetterSqlite from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from '@/lib/ai/designArtifactGraph';
import { commitDesignWorkspaceRevision, createDesignWorkspaceRevision } from '@/lib/ai/designWorkspaceRevision';
import type { ExactClashJobRequest } from './coordinationSpatialModel';
import {
  CAD_WORKSPACE_ENVELOPE_SCHEMA,
  ensureCadWorkspaceRevisionTables,
  hashCadPayload,
  persistCadWorkspaceRevision,
  type CadWorkspaceEnvelopeInput,
} from './workspaceRevisionStore';
import {
  claimNextExactClashJob,
  cancelExactClashJob,
  completeExactClashJob,
  classifyExactClashFailure,
  enqueueExactClashJob,
  ensureSpatialCadJobTables,
  EXACT_CLASH_MAX_ATTEMPTS,
  EXACT_CLASH_RETRY_BACKOFF_MS,
  failExactClashJob,
  failExactClashJobDetailed,
  getSpatialCadJobUsage,
  hashExactClashExecutionReceipt,
  heartbeatExactClashJob,
  listSpatialCadJobs,
  type ExactClashExecutionReceipt,
} from './spatialCadJobStore';

const hash = (char: string) => char.repeat(64);

function sqliteAdapter(database: BetterSqlite.Database): DbAdapter {
  const adapter: DbAdapter = {
    backend: 'sqlite',
    async queryOne<T>(sql: string, ...params: SqlParam[]) { return database.prepare(sql).get(...params) as T | undefined; },
    async queryAll<T>(sql: string, ...params: SqlParam[]) { return database.prepare(sql).all(...params) as T[]; },
    async execute(sql: string, ...params: SqlParam[]) { return { changes: database.prepare(sql).run(...params).changes }; },
    async executeRaw(sql: string) { database.exec(sql); },
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>) {
      database.exec('BEGIN IMMEDIATE');
      try { const value = await fn(adapter); database.exec('COMMIT'); return value; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    async close() { database.close(); },
  };
  return adapter;
}

function envelope(revision: 0 | 1, geometryHash: string, shapeHash: string): CadWorkspaceEnvelopeInput {
  const semantic = { parts: [`part-${revision}`] };
  const documentHash = hashCadPayload(semantic);
  let workspace = createDesignWorkspaceRevision({ projectId: 'project-1', lineageId: 'lineage-1', domain: 'mechanical', documentHash: revision === 0 ? documentHash : hashCadPayload({ parts: ['part-0'] }) });
  if (revision === 1) workspace = commitDesignWorkspaceRevision(workspace, { baseRevision: 0, actor: 'human', mode: 'precision_cad', documentHash, changedTargets: [{ kind: 'base_shape', objectId: 'part-1' }] }).workspace;
  return {
    schema: CAD_WORKSPACE_ENVELOPE_SCHEMA,
    workspace,
    requirements: { payload: { exact: true }, contentHash: hashCadPayload({ exact: true }) },
    semanticDocument: { schema: 'nexyfab.product-decomposition.v1', payload: semantic, contentHash: documentHash },
    geometry: { fidelity: 'exact_brep', contentHash: geometryHash, shapeIdentityHash: shapeHash },
    objectRelations: { payload: [], contentHash: hashCadPayload([]) },
    artifactGraph: { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'project-1', revision, artifacts: [{ id: 'model', kind: 'model', revision, contentHash: geometryHash, state: 'current', inputs: [], verification: { status: 'passed', verifierId: 'exact-kernel', evidenceHash: hash('9'), issues: [] }, staleBecause: [] }], dependencies: [] },
    provenance: [{ sourceId: `import-${revision}`, kind: 'import', contentHash: hash('8') }],
    kernelIdentity: { mode: 'wasm', kernelId: 'occt-7.9', buildSha256: hash('6'), wasmSha256: hash('7'), stubFallback: false },
  };
}

async function fixtureDb() {
  const database = new BetterSqlite(':memory:');
  const db = sqliteAdapter(database);
  await ensureCadWorkspaceRevisionTables(db);
  await ensureSpatialCadJobTables(db);
  const first = await persistCadWorkspaceRevision(db, 'user-1', 'project-1', -1, envelope(0, hash('1'), hash('3')));
  const second = await persistCadWorkspaceRevision(db, 'user-1', 'project-1', 0, envelope(1, hash('2'), hash('4')));
  if (!first.ok || !second.ok) throw new Error('fixture persistence failed');
  const request: ExactClashJobRequest = {
    schema: 'nexyfab.exact-clash-job-request.v1', coordinateSystem: 'EPSG:5186', toleranceMm: 50, documentRevision: 3,
    models: [
      { id: 'architecture', artifactId: first.revisionId, contentHash: hash('1'), shapeIdentityHash: hash('3'), offsetMm: [0, 0, 0] },
      { id: 'mep', artifactId: second.revisionId, contentHash: hash('2'), shapeIdentityHash: hash('4'), offsetMm: [0, 0, 0] },
    ],
  };
  return { db, request, database };
}

describe('spatial exact clash SQLite lifecycle', () => {
  it('requeues allowlisted transient failures with bounded backoff and terminally fails at the attempt cap', async () => {
    expect(classifyExactClashFailure('ARTIFACT_LOAD_FAILED')).toBe('RETRYABLE');
    expect(classifyExactClashFailure('INVALID_INPUT')).toBe('TERMINAL');
    const fixture = await fixtureDb();
    const queued = await enqueueExactClashJob(fixture.db, 'user-1', 'project-1', fixture.request, 'retry-key');
    if (!queued.ok) throw new Error('queue failed');
    let eligibleAt = 2000;
    for (let attempt = 1; attempt <= EXACT_CLASH_MAX_ATTEMPTS; attempt += 1) {
      const claim = await claimNextExactClashJob(fixture.db, 'worker-1', eligibleAt, 60_000);
      expect(claim).not.toBeNull();
      if (!claim) throw new Error(`claim ${attempt} failed`);
      const failedAt = eligibleAt + 1000;
      const failure = await failExactClashJobDetailed(fixture.db, queued.job.id, 'worker-1', claim.leaseToken, 'ARTIFACT_LOAD_FAILED', failedAt);
      expect(failure).toMatchObject({ ok: true, code: attempt < EXACT_CLASH_MAX_ATTEMPTS ? 'RETRY_SCHEDULED' : 'TERMINAL_FAILURE', attempts: attempt, attemptsRemaining: Math.max(0, EXACT_CLASH_MAX_ATTEMPTS - attempt) });
      const [job] = await listSpatialCadJobs(fixture.db, 'project-1');
      if (attempt < EXACT_CLASH_MAX_ATTEMPTS) {
        expect(job).toMatchObject({ status: 'QUEUED', execution: 'NOT_RUN', attempts: attempt, errorCode: 'ARTIFACT_LOAD_FAILED', nextAttemptAt: failedAt + EXACT_CLASH_RETRY_BACKOFF_MS[attempt - 1] });
        expect(await claimNextExactClashJob(fixture.db, 'worker-2', failedAt + EXACT_CLASH_RETRY_BACKOFF_MS[attempt - 1] - 1, 60_000)).toBeNull();
        eligibleAt = failedAt + EXACT_CLASH_RETRY_BACKOFF_MS[attempt - 1];
      } else {
        expect(job).toMatchObject({ status: 'FAILED', execution: 'FAIL', attempts: EXACT_CLASH_MAX_ATTEMPTS, errorCode: 'ARTIFACT_LOAD_FAILED' });
        expect(job?.nextAttemptAt).toBeUndefined();
      }
    }
    fixture.database.close();
  });

  it('records terminal failures without scheduling another attempt', async () => {
    const fixture = await fixtureDb();
    const queued = await enqueueExactClashJob(fixture.db, 'user-1', 'project-1', fixture.request, 'terminal-key');
    if (!queued.ok) throw new Error('queue failed');
    const claim = await claimNextExactClashJob(fixture.db, 'worker-1', 2000, 60_000);
    if (!claim) throw new Error('claim failed');
    expect(await failExactClashJob(fixture.db, queued.job.id, 'worker-1', claim.leaseToken, 'INVALID_INPUT', 3000)).toBe(true);
    const [job] = await listSpatialCadJobs(fixture.db, 'project-1');
    expect(job).toMatchObject({ status: 'FAILED', execution: 'FAIL', attempts: 1, errorCode: 'INVALID_INPUT' });
    expect(job?.nextAttemptAt).toBeUndefined();
    expect(await claimNextExactClashJob(fixture.db, 'worker-2', 1_000_000, 60_000)).toBeNull();
    fixture.database.close();
  });

  it('binds project revisions, leases once, heartbeats and completes with release still NOT_RUN', async () => {
    const database = new BetterSqlite(':memory:');
    const db = sqliteAdapter(database);
    await ensureCadWorkspaceRevisionTables(db);
    await ensureSpatialCadJobTables(db);
    const first = await persistCadWorkspaceRevision(db, 'user-1', 'project-1', -1, envelope(0, hash('1'), hash('3')));
    const second = await persistCadWorkspaceRevision(db, 'user-1', 'project-1', 0, envelope(1, hash('2'), hash('4')));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('fixture persistence failed');
    const request: ExactClashJobRequest = {
      schema: 'nexyfab.exact-clash-job-request.v1', coordinateSystem: 'EPSG:5186', toleranceMm: 50, documentRevision: 3,
      models: [
        { id: 'architecture', artifactId: first.revisionId, contentHash: hash('1'), shapeIdentityHash: hash('3'), offsetMm: [0, 0, 0] },
        { id: 'mep', artifactId: second.revisionId, contentHash: hash('2'), shapeIdentityHash: hash('4'), offsetMm: [0, 0, 0] },
      ],
    };
    const queued = await enqueueExactClashJob(db, 'user-1', 'project-1', request);
    expect(queued).toMatchObject({ ok: true, job: { status: 'QUEUED', execution: 'NOT_RUN', releaseVerification: 'NOT_RUN' } });
    if (!queued.ok) throw new Error('fixture enqueue failed');
    const claimedAt = queued.job.createdAt + 1000;
    const heartbeatAt = claimedAt + 1000;
    const completedAt = heartbeatAt + 1000;
    const claim = await claimNextExactClashJob(db, 'worker-1', claimedAt, 60_000);
    expect(claim).toMatchObject({ job: { id: queued.job.id, status: 'RUNNING', execution: 'RUNNING', attempts: 1 } });
    if (!claim) throw new Error('fixture claim failed');
    await expect(heartbeatExactClashJob(db, queued.job.id, 'worker-1', claim.leaseToken, heartbeatAt, 60_000)).resolves.toBe(true);
    await expect(heartbeatExactClashJob(db, queued.job.id, 'worker-2', claim.leaseToken, heartbeatAt, 60_000)).resolves.toBe(false);
    const core: Omit<ExactClashExecutionReceipt, 'receiptSha256'> = {
      schema: 'nexyfab.exact-clash-execution-receipt.v1', jobId: queued.job.id, requestSha256: hashCadPayload(request),
      workerIdentitySha256: hash('a'), kernelIdentitySha256: hash('b'), engine: 'OCCT', algorithm: 'exact_brep_common_and_distance', stubFallback: false,
      checkedPairs: 1, clashes: [{ id: 'architecture:mep', modelA: 'architecture', modelB: 'mep', classification: 'CLEAR', commonVolumeMm3: 0, minimumDistanceMm: 125 }], completedAt,
    };
    const completed = await completeExactClashJob(db, 'worker-1', claim.leaseToken, { ...core, receiptSha256: hashExactClashExecutionReceipt(core) }, completedAt);
    expect(completed).toMatchObject({ ok: true, job: { status: 'SUCCEEDED', execution: 'PASS', releaseVerification: 'NOT_RUN' } });
    await expect(listSpatialCadJobs(db, 'project-1')).resolves.toEqual([expect.objectContaining({ status: 'SUCCEEDED', execution: 'PASS', releaseVerification: 'NOT_RUN' })]);
    await db.close();
  });

  it('reuses an idempotency key only for the same request and enforces the active cap', async () => {
    const { db, request, database } = await fixtureDb();
    const first = await enqueueExactClashJob(db, 'user-1', 'project-1', request, 'same-key');
    expect(first).toMatchObject({ ok: true, job: { status: 'QUEUED' } });
    if (!first.ok) throw new Error('first enqueue failed');
    const reused = await enqueueExactClashJob(db, 'user-1', 'project-1', request, 'same-key');
    expect(reused).toMatchObject({ ok: true, reused: true, job: { id: first.ok ? first.job.id : '' } });
    const conflict = await enqueueExactClashJob(db, 'user-1', 'project-1', { ...request, toleranceMm: 51 }, 'same-key');
    expect(conflict).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    const otherUser = await enqueueExactClashJob(db, 'user-2', 'project-1', request, 'same-key');
    if (!otherUser.ok) throw new Error('other-user enqueue failed');
    expect(otherUser.job.id).not.toBe(first.job.id);
    const capped = await enqueueExactClashJob(db, 'user-1', 'project-1', request, 'second-key');
    expect(capped).toMatchObject({ ok: false, code: 'ACTIVE_JOB_LIMIT' });
    await expect(getSpatialCadJobUsage(db, 'project-1')).resolves.toEqual({ active: 2, limit: 2 });
    database.close();
  });

  it('cancels queued and running jobs, rejects terminal cancellation, and blocks stale worker completion', async () => {
    const queuedFixture = await fixtureDb();
    const queued = await enqueueExactClashJob(queuedFixture.db, 'user-1', 'project-1', queuedFixture.request, 'queued-key');
    if (!queued.ok) throw new Error('queue failed');
    expect(await cancelExactClashJob(queuedFixture.db, 'project-1', queued.job.id, 2000)).toMatchObject({ ok: true, job: { status: 'CANCELLED', execution: 'NOT_RUN' } });
    expect(await claimNextExactClashJob(queuedFixture.db, 'worker-1', 3000, 60_000)).toBeNull();
    expect(await cancelExactClashJob(queuedFixture.db, 'project-1', queued.job.id, 4000)).toMatchObject({ ok: false, code: 'CANCEL_NOT_ALLOWED' });
    queuedFixture.database.close();

    const runningFixture = await fixtureDb();
    const running = await enqueueExactClashJob(runningFixture.db, 'user-1', 'project-1', runningFixture.request, 'running-key');
    if (!running.ok) throw new Error('queue failed');
    const claim = await claimNextExactClashJob(runningFixture.db, 'worker-1', 2000, 60_000);
    if (!claim) throw new Error('claim failed');
    expect(await cancelExactClashJob(runningFixture.db, 'project-1', running.job.id, 3000)).toMatchObject({ ok: true, job: { status: 'CANCELLED' } });
    const core: Omit<ExactClashExecutionReceipt, 'receiptSha256'> = {
      schema: 'nexyfab.exact-clash-execution-receipt.v1', jobId: running.job.id, requestSha256: hashCadPayload(runningFixture.request),
      workerIdentitySha256: hash('a'), kernelIdentitySha256: hash('b'), engine: 'OCCT', algorithm: 'exact_brep_common_and_distance', stubFallback: false,
      checkedPairs: 1, clashes: [{ id: 'architecture:mep', modelA: 'architecture', modelB: 'mep', classification: 'CLEAR', commonVolumeMm3: 0, minimumDistanceMm: 125 }], completedAt: 4000,
    };
    expect(await completeExactClashJob(runningFixture.db, 'worker-1', claim.leaseToken, { ...core, receiptSha256: hashExactClashExecutionReceipt(core) }, 4000)).toMatchObject({ ok: false, code: 'LEASE_REJECTED' });
    runningFixture.database.close();
  });
});
