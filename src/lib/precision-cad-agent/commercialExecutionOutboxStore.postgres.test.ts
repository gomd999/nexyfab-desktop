import { describe, expect, it, vi } from 'vitest';
import { canonicalCommercialExecution } from '../../../packages/job-contracts/src/commercialPrecisionExecution';
import { enqueueCommercialExecutionTransaction } from './commercialExecutionOutboxStore';
import { makeEnqueueFixture, NOW } from './commercialExecutionOutboxStore.testFixture';
import { canonicalJson, DurableExecutionJournal, hashReceipt, type ExecutionJournalReceipt } from './executionJournal';

describe('commercial enqueue PostgreSQL transaction contract', () => {
  vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM', 'f'.repeat(64)); vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082502', 'f'.repeat(64)); vi.stubEnv('NEXYFAB_COMMERCIAL_MODE', '1');
  it('atomically consumes approval, writes journal+claim+outbox, and never executes network/worker', async () => {
    const fixture = await makeEnqueueFixture(); const executor = vi.fn();
    const result = await enqueueCommercialExecutionTransaction(fixture.input);
    expect(result).toMatchObject({ ok: true }); expect(executor).not.toHaveBeenCalled();
    const state = fixture.db.readState();
    expect(Number(state.challenge.consumed_at)).toBeGreaterThanOrEqual(NOW);
    expect(state.journal).toMatchObject({ execution_id: fixture.input.job.executionId, idempotency_key: fixture.input.journal.idempotencyKey, receipt_json: fixture.input.journal.receiptJson, receipt_hash: fixture.input.journal.receiptHash, approval_hash: fixture.input.journal.approvalHash });
    expect(state.claim).toMatchObject({ challenge_id: fixture.challenge.challengeId, call_id: fixture.input.job.callId, arguments_hash: fixture.input.job.argumentsHash });
    expect(state.outbox).toMatchObject({ job_id: fixture.input.job.jobId, job_hash: result.ok ? result.row.jobHash : '', job_json: canonicalCommercialExecution(fixture.input.job) });
    expect(state.inputArtifact).toMatchObject({ job_id: fixture.input.job.jobId, artifact_id: fixture.input.job.inputArtifact?.artifactId, content_sha256: fixture.input.job.inputArtifact?.contentSha256 });
  });

  it('returns replay only for byte-exact job/journal/challenge/claim binding', async () => {
    const fixture = await makeEnqueueFixture(); const first = await enqueueCommercialExecutionTransaction(fixture.input); expect(first.ok).toBe(true);
    const replay = await enqueueCommercialExecutionTransaction(fixture.input); expect(replay).toMatchObject({ ok: true, replayed: true });
    const before = fixture.db.readState(); const substituted = { ...fixture.input, job: { ...fixture.input.job, targetHash: 'e'.repeat(64) } };
    const conflict = await enqueueCommercialExecutionTransaction(substituted); expect(conflict).toMatchObject({ ok: false, code: 'CONFLICT' }); expect(fixture.db.readState()).toEqual(before);
    const receiptConflict = await enqueueCommercialExecutionTransaction({ ...fixture.input, journal: { ...fixture.input.journal, receiptJson: fixture.input.journal.receiptJson + 'x' } });
    expect(receiptConflict).toMatchObject({ ok: false, code: 'CONFLICT' }); expect(fixture.db.readState()).toEqual(before);
  });

  it.each(['UPDATE nf_precision_cad_approval_challenges', 'INSERT INTO nf_precision_cad_execution_journal', 'INSERT INTO nf_precision_cad_tool_claims', 'INSERT INTO nf_precision_cad_commercial_outbox'])('rolls back challenge consumption and every row when %s fails', async failOn => {
    const fixture = await makeEnqueueFixture(); const before = fixture.db.readState(); fixture.db.failOn = failOn;
    const result = await enqueueCommercialExecutionTransaction(fixture.input);
    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' }); expect(fixture.db.readState()).toEqual(before); expect(fixture.db.ddlCalls).toBe(0);
  });

  it('rolls back all writes when commit acknowledgement fails', async () => {
    const fixture = await makeEnqueueFixture(); const before = fixture.db.readState(); fixture.db.failCommit = true;
    expect(await enqueueCommercialExecutionTransaction(fixture.input)).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(fixture.db.readState()).toEqual(before); expect(fixture.db.readState().challenge.consumed_at).toBeNull();
  });

  it('rolls back on stale head before consume and never mutates challenge or rows', async () => {
    const fixture = await makeEnqueueFixture(); const state = fixture.db.readState(); state.head.revision = 6; fixture.db.restore(state); const before = fixture.db.readState();
    const result = await enqueueCommercialExecutionTransaction(fixture.input);
    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' }); expect(fixture.db.readState()).toEqual(before); expect(fixture.db.readState().challenge.consumed_at).toBeNull();
  });

  it('serializes concurrent same-key requests to one commit and one exact replay', async () => {
    const fixture = await makeEnqueueFixture(); const [left, right] = await Promise.all([enqueueCommercialExecutionTransaction(fixture.input), enqueueCommercialExecutionTransaction(fixture.input)]);
    expect([left.ok, right.ok].filter(Boolean)).toHaveLength(2); expect([left, right].filter(item => item.ok && item.replayed)).toHaveLength(1); expect(fixture.db.readState().claim).toBeTruthy();
  });

  it('allows only one simultaneous claim when the idempotency key or challenge is substituted', async () => {
    const fixture = await makeEnqueueFixture(); const original = JSON.parse(fixture.input.journal.receiptJson) as ExecutionJournalReceipt; const clock = () => new Date(NOW).toISOString(); const engine = new DurableExecutionJournal(undefined, clock); const planned = engine.plan({ idempotencyKey: 'idem-other', command: original.command, workspace: original.workspaceBinding }); if (!planned.ok) throw new Error('alternate_plan_failed'); const approved = engine.approve(planned.receipt.executionId, { ...original.approval!, commandHash: planned.receipt.commandHash, workspaceBindingHash: planned.receipt.workspaceBindingHash }); if (!approved.ok || !approved.receipt.approvalHash) throw new Error('alternate_approval_failed');
    const substituted = { ...fixture.input, job: { ...fixture.input.job, jobId: 'job-other', executionId: approved.receipt.executionId, commandHash: approved.receipt.commandHash, journalVersion: approved.receipt.version }, journal: { idempotencyKey: approved.receipt.idempotencyKey, receiptJson: canonicalJson(approved.receipt), receiptHash: hashReceipt(approved.receipt), approvalHash: approved.receipt.approvalHash, createdAt: Date.parse(approved.receipt.createdAt), updatedAt: Date.parse(approved.receipt.updatedAt) } };
    const [left, right] = await Promise.all([enqueueCommercialExecutionTransaction(fixture.input), enqueueCommercialExecutionTransaction(substituted)]);
    expect([left, right].filter(item => item.ok)).toHaveLength(1); expect([left, right].filter(item => !item.ok && item.code === 'CONFLICT')).toHaveLength(1);
    const state = fixture.db.readState(); expect(state.journal).toBeTruthy(); expect(state.claim).toBeTruthy(); expect(state.outbox).toBeTruthy();
  });

  it('fails closed with missing migration/checksum and performs zero mutation/DDL', async () => {
    const fixture = await makeEnqueueFixture(); fixture.db.migrationAvailable = false; const before = fixture.db.readState(); const result = await enqueueCommercialExecutionTransaction(fixture.input);
    expect(result).toMatchObject({ ok: false, code: 'MIGRATION_REQUIRED' }); expect(fixture.db.readState()).toEqual(before);
  });
});
