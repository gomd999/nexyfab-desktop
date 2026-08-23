import { describe, expect, it } from 'vitest';
import {
  DurableExecutionJournal,
  InMemoryExecutionJournalStore,
  hashApproval,
  hashBoundReceipt,
  hashCommand,
  hashRollbackApproval,
  hashWorkspaceBinding,
  sha256,
  type ExecutionCommand,
  type RollbackApproval,
  type UserApproval,
  type WorkspaceBinding,
  verifyExecutionJournalChain,
} from './executionJournal';

const hash = (value: string) => value.repeat(64);

function workspace(revision = 7, contentHash = hash(String.fromCharCode(97))): WorkspaceBinding {
  return { workspaceId: 'workspace-1', projectId: 'project-1', revision, contentHash };
}

function command(amount = 1): ExecutionCommand {
  return { domain: 'mechanical', operation: 'edit-part', arguments: { amount, nested: { b: 2, a: 1 } } };
}

function approvalFor(commandValue: ExecutionCommand, binding: WorkspaceBinding, approvalId = 'approval-1'): UserApproval {
  const commandHash = hashCommand(commandValue);
  const workspaceBindingHash = hashWorkspaceBinding(binding);
  return { approvalId, actorId: 'user-1', approved: true, approvedAt: '2026-08-22T00:01:00.000Z', commandHash, workspaceBindingHash, userInitiated: true };
}

function rollbackApprovalFor(input: {
  executionId: string;
  originalReceiptHash: string;
  failureReason: string;
  workspaceAfter: WorkspaceBinding;
}): RollbackApproval {
  return {
    approvalId: 'rollback-1', actorId: 'user-1', approved: true,
    approvedAt: '2026-08-22T00:02:00.000Z', userInitiated: true,
    originalExecutionId: input.executionId,
    originalReceiptHash: input.originalReceiptHash,
    failureReasonHash: sha256(input.failureReason),
    targetWorkspaceHash: sha256(JSON.stringify({ contentHash: input.workspaceAfter.contentHash, projectId: input.workspaceAfter.projectId, revision: input.workspaceAfter.revision, workspaceId: input.workspaceAfter.workspaceId })),
  };
}

function clockHarness() {
  let time = Date.parse('2026-08-22T00:00:00.000Z');
  return { clock: () => new Date(time).toISOString(), advance: (milliseconds: number) => { time += milliseconds; } };
}

describe('durable precision CAD execution journal', () => {
  it('canonicalizes and hashes command, approval, and workspace bindings', () => {
    const binding = workspace();
    const first = command();
    expect(hashCommand(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashCommand({ ...first, arguments: { nested: { a: 1, b: 2 }, amount: 1 } })).toBe(hashCommand(first));
    expect(hashCommand(command(2))).not.toBe(hashCommand(first));
    expect(hashWorkspaceBinding(binding)).toBe(hashWorkspaceBinding({ ...binding }));
    expect(hashApproval(approvalFor(first, binding))).toMatch(/^[a-f0-9]{64}$/);
    const withOmittedValue = { ...first, arguments: { ...first.arguments, omitted: undefined } };
    expect(hashCommand(withOmittedValue)).toBe(hashCommand(first));
  });

  it('survives JSON persistence and rejects non-JSON command graphs', () => {
    const journal = new DurableExecutionJournal();
    const planned = journal.plan({ idempotencyKey: 'json-roundtrip', command: command(), workspace: workspace() });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const persisted = JSON.parse(JSON.stringify(planned.receipt));
    expect(verifyExecutionJournalChain(persisted)).toBe(true);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(journal.plan({ idempotencyKey: 'cyclic', command: { ...command(), arguments: cyclic }, workspace: workspace() }))
      .toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  });

  it('requires an idempotency key and returns an exact replay for the same binding', () => {
    const { clock } = clockHarness();
    const journal = new DurableExecutionJournal(new InMemoryExecutionJournalStore(), clock);
    expect(journal.plan({ idempotencyKey: '', command: command(), workspace: workspace() })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    const first = journal.plan({ idempotencyKey: 'key-1', command: command(), workspace: workspace() });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(verifyExecutionJournalChain(first.receipt)).toBe(true);
    const replay = journal.plan({ idempotencyKey: 'key-1', command: command(), workspace: workspace() });
    expect(replay).toMatchObject({ ok: true, replayed: true, receipt: { executionId: first.receipt.executionId, lifecycle: 'PLANNED' } });
    expect(journal.plan({ idempotencyKey: 'key-1', command: command(2), workspace: workspace() })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(journal.plan({ idempotencyKey: 'key-1', command: command(), workspace: workspace(8) })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('enforces explicit approval, stale CAS, and the lifecycle order', () => {
    const { clock } = clockHarness();
    const journal = new DurableExecutionJournal(new InMemoryExecutionJournalStore(), clock);
    const binding = workspace();
    const planned = journal.plan({ idempotencyKey: 'key-2', command: command(), workspace: binding });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(journal.begin(planned.receipt.executionId, 'worker-1')).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
    const approved = journal.approve(planned.receipt.executionId, approvalFor(command(), binding));
    expect(approved).toMatchObject({ ok: true, receipt: { lifecycle: 'APPROVED' } });
    if (!approved.ok) return;
    expect(journal.begin(planned.receipt.executionId, 'worker-1', 30_000, planned.receipt.version)).toMatchObject({ ok: false, code: 'STALE_CAS' });
    const running = journal.begin(planned.receipt.executionId, 'worker-1');
    expect(running).toMatchObject({ ok: true, receipt: { lifecycle: 'EXECUTING', lease: { ownerId: 'worker-1' } } });
  });

  it('fails a preparation callback without invoking workspace commit', async () => {
    const { clock } = clockHarness();
    const journal = new DurableExecutionJournal(new InMemoryExecutionJournalStore(), clock);
    const binding = workspace();
    const planned = journal.plan({ idempotencyKey: 'key-3', command: command(), workspace: binding });
    if (!planned.ok) throw new Error('plan failed');
    const approved = journal.approve(planned.receipt.executionId, approvalFor(command(), binding));
    if (!approved.ok) throw new Error('approval failed');
    let commitCalls = 0;
    const result = await journal.execute({
      executionId: planned.receipt.executionId,
      ownerId: 'worker-1',
      prepare: () => ({ ok: false, reason: 'kernel_validation_failed' }),
      commitWorkspace: () => { commitCalls += 1; return { ok: true, workspaceAfter: { ...binding, revision: 8, contentHash: hash('b') } }; },
    });
    expect(result).toMatchObject({ ok: false, code: 'EXECUTION_FAILED', receipt: { lifecycle: 'FAILED' } });
    if (result.receipt) expect(result.receipt.workspace.after).toBeUndefined();
    expect(commitCalls).toBe(0);
    if (result.receipt) expect(verifyExecutionJournalChain(result.receipt)).toBe(true);
  });

  it('binds external artifact SHA and records before/after, objects, and artifacts', async () => {
    const { clock } = clockHarness();
    const journal = new DurableExecutionJournal(new InMemoryExecutionJournalStore(), clock);
    const binding = workspace();
    const planned = journal.plan({ idempotencyKey: 'key-4', command: command(), workspace: binding });
    if (!planned.ok) throw new Error('plan failed');
    const approved = journal.approve(planned.receipt.executionId, approvalFor(command(), binding));
    if (!approved.ok) throw new Error('approval failed');
    const after = { ...binding, revision: 8, contentHash: hash('b') };
    const result = await journal.execute({
      executionId: planned.receipt.executionId,
      ownerId: 'worker-1',
      prepare: () => ({ ok: true, workspaceAfter: after, affectedObjects: [{ objectId: 'part-1', beforeRevision: 7, afterRevision: 8 }], artifacts: [{ artifactId: 'step-1', sha256: hash('c'), kind: 'step' }] }),
      commitWorkspace: candidate => ({ ok: true, workspaceAfter: candidate }),
    });
    expect(result).toMatchObject({ ok: true, receipt: { lifecycle: 'COMMITTED', workspace: { before: binding, after }, affectedObjects: [{ objectId: 'part-1' }], artifacts: [{ artifactId: 'step-1', sha256: hash('c') }] } });
    if (result.ok) expect(verifyExecutionJournalChain(result.receipt)).toBe(true);
  });

  it('binds complete persistence and verification receipts and rejects event/receipt tampering', async () => {
    const { clock } = clockHarness();
    const journal = new DurableExecutionJournal(new InMemoryExecutionJournalStore(), clock);
    const binding = workspace();
    const planned = journal.plan({ idempotencyKey: 'key-receipt-binding', command: command(), workspace: binding });
    if (!planned.ok) throw new Error('plan failed');
    const approved = journal.approve(planned.receipt.executionId, approvalFor(command(), binding));
    if (!approved.ok) throw new Error('approval failed');
    const persistenceReceipt = { schema: 'persistence.v1', artifactSha256: hash('persistence'), bytes: 12, nested: { b: 2, a: 1 } };
    const verificationReceipt = { schema: 'verification.v1', status: 'passed', checks: ['geometry', 'binding'] };
    const committed = await journal.execute({
      executionId: planned.receipt.executionId, ownerId: 'worker-1',
      prepare: () => ({ ok: true, workspaceAfter: { ...binding, revision: 8, contentHash: hash('b') }, affectedObjects: [], artifacts: [], persistenceReceipt, verificationReceipt }),
      commitWorkspace: candidate => ({ ok: true, workspaceAfter: candidate }),
    });
    expect(committed).toMatchObject({ ok: true, receipt: { persistenceReceiptHash: hashBoundReceipt(persistenceReceipt), verificationReceiptHash: hashBoundReceipt(verificationReceipt) } });
    if (!committed.ok) return;
    expect(verifyExecutionJournalChain(committed.receipt)).toBe(true);
    expect(verifyExecutionJournalChain({ ...committed.receipt, persistenceReceiptHash: hashBoundReceipt({ ...persistenceReceipt, bytes: 13 }) })).toBe(false);
    const tamperedEvent = { ...committed.receipt.events[committed.receipt.events.length - 1]!, data: { forged: true } };
    expect(verifyExecutionJournalChain({ ...committed.receipt, events: [...committed.receipt.events.slice(0, -1), tamperedEvent] })).toBe(false);
  });

  it('holds VERIFIED_UNKNOWN when workspace commit succeeded but receipt CAS fails', async () => {
    const { clock } = clockHarness();
    class FailCommitReceiptCasStore extends InMemoryExecutionJournalStore {
      private failed = false;
      override compareAndSwap(...args: Parameters<InMemoryExecutionJournalStore['compareAndSwap']>) {
        if (!this.failed && args[2].lifecycle === 'COMMITTED') { this.failed = true; return { ok: false as const, code: 'STALE_CAS' as const, receipt: this.get(args[0]) ?? undefined }; }
        return super.compareAndSwap(...args);
      }
    }
    const journal = new DurableExecutionJournal(new FailCommitReceiptCasStore(), clock);
    const binding = workspace();
    const planned = journal.plan({ idempotencyKey: 'key-5', command: command(), workspace: binding });
    if (!planned.ok) throw new Error('plan failed');
    const approved = journal.approve(planned.receipt.executionId, approvalFor(command(), binding));
    if (!approved.ok) throw new Error('approval failed');
    const result = await journal.execute({
      executionId: planned.receipt.executionId,
      ownerId: 'worker-1',
      prepare: () => ({ ok: true, workspaceAfter: { ...binding, revision: 8, contentHash: hash('d') }, affectedObjects: [], artifacts: [] }),
      commitWorkspace: candidate => ({ ok: true, workspaceAfter: candidate }),
    });
    expect(result).toMatchObject({ ok: false, code: 'COMMIT_RECEIPT_UNCERTAIN', receipt: { lifecycle: 'VERIFIED_UNKNOWN', holdReason: 'commit_receipt_cas_failed' } });
    if (result.receipt) expect(result.receipt.lifecycle).toBe('VERIFIED_UNKNOWN');
  });

  it('supports lease expiry takeover and deterministic crash-recovery decisions', () => {
    const harness = clockHarness();
    const journal = new DurableExecutionJournal(new InMemoryExecutionJournalStore(), harness.clock);
    const binding = workspace();
    const planned = journal.plan({ idempotencyKey: 'key-6', command: command(), workspace: binding });
    if (!planned.ok) throw new Error('plan failed');
    const approved = journal.approve(planned.receipt.executionId, approvalFor(command(), binding));
    if (!approved.ok) throw new Error('approval failed');
    const running = journal.begin(planned.receipt.executionId, 'worker-a', 100);
    if (!running.ok) throw new Error('begin failed');
    expect(journal.recover(running.receipt.executionId)).toMatchObject({ decision: 'WAIT_FOR_LEASE' });
    expect(journal.begin(running.receipt.executionId, 'worker-b')).toMatchObject({ ok: false, code: 'LEASE_HELD' });
    harness.advance(101);
    expect(journal.recover(running.receipt.executionId)).toMatchObject({ decision: 'TAKEOVER_REQUIRED' });
    expect(journal.begin(running.receipt.executionId, 'worker-b', 100)).toMatchObject({ ok: true, receipt: { lifecycle: 'EXECUTING', lease: { ownerId: 'worker-b' } } });
  });

  it('does not call workspace commit after the execution lease expires', async () => {
    const harness = clockHarness();
    const journal = new DurableExecutionJournal(new InMemoryExecutionJournalStore(), harness.clock);
    const binding = workspace();
    const planned = journal.plan({ idempotencyKey: 'key-6b', command: command(), workspace: binding });
    if (!planned.ok) throw new Error('plan failed');
    const approved = journal.approve(planned.receipt.executionId, approvalFor(command(), binding));
    if (!approved.ok) throw new Error('approval failed');
    let commits = 0;
    const result = await journal.execute({
      executionId: planned.receipt.executionId,
      ownerId: 'worker-a',
      leaseMs: 100,
      prepare: () => { harness.advance(101); return { ok: true, workspaceAfter: { ...binding, revision: 8, contentHash: hash('a') }, affectedObjects: [], artifacts: [] }; },
      commitWorkspace: candidate => { commits += 1; return { ok: true, workspaceAfter: candidate }; },
    });
    expect(result).toMatchObject({ ok: false, code: 'LEASE_EXPIRED' });
    expect(commits).toBe(0);
  });

  it('binds a rollback receipt to the original execution and explicit rollback approval', async () => {
    const { clock } = clockHarness();
    const journal = new DurableExecutionJournal(new InMemoryExecutionJournalStore(), clock);
    const binding = workspace();
    const commandValue = command();
    const planned = journal.plan({ idempotencyKey: 'key-7', command: commandValue, workspace: binding });
    if (!planned.ok) throw new Error('plan failed');
    const approval = approvalFor(commandValue, binding);
    const approved = journal.approve(planned.receipt.executionId, approval);
    if (!approved.ok) throw new Error('approval failed');
    const committed = await journal.execute({
      executionId: planned.receipt.executionId,
      ownerId: 'worker-1',
      prepare: () => ({ ok: true, workspaceAfter: { ...binding, revision: 8, contentHash: hash('e') }, affectedObjects: [], artifacts: [] }),
      commitWorkspace: candidate => ({ ok: true, workspaceAfter: candidate }),
    });
    if (!committed.ok) throw new Error('commit failed');
    const workspaceAfter = { ...binding, revision: 9, contentHash: hash('f') };
    const rollbackApproval = rollbackApprovalFor({ executionId: committed.receipt.executionId, originalReceiptHash: committed.receipt.receiptHash, failureReason: 'post_commit_verification_failed', workspaceAfter });
    expect(hashRollbackApproval(rollbackApproval)).toMatch(/^[a-f0-9]{64}$/);
    expect(journal.rollback({ executionId: committed.receipt.executionId, approval: { ...rollbackApproval, failureReasonHash: hash('0') }, failureReason: 'post_commit_verification_failed', workspaceAfter })).toMatchObject({ ok: false, code: 'ROLLBACK_INVALID' });
    expect(journal.rollback({ executionId: committed.receipt.executionId, approval: rollbackApproval, failureReason: 'different_reason', workspaceAfter })).toMatchObject({ ok: false, code: 'ROLLBACK_INVALID' });
    const rolledBack = journal.rollback({ executionId: committed.receipt.executionId, approval: rollbackApproval, failureReason: 'post_commit_verification_failed', workspaceAfter });
    expect(rolledBack).toMatchObject({ ok: true, receipt: { lifecycle: 'ROLLED_BACK', rollback: { originalExecutionId: committed.receipt.executionId, originalReceiptHash: committed.receipt.receiptHash, failureReason: 'post_commit_verification_failed', approvedBy: 'user-1' } } });
    if (rolledBack.ok) expect(verifyExecutionJournalChain(rolledBack.receipt)).toBe(true);
  });

  it('serializes concurrent planning on one idempotency key', async () => {
    const journal = new DurableExecutionJournal();
    const requests = await Promise.all(Array.from({ length: 12 }, () => Promise.resolve(journal.plan({ idempotencyKey: 'concurrent-key', command: command(), workspace: workspace() }))));
    const executionIds = new Set(requests.filter(item => item.ok).map(item => item.receipt.executionId));
    expect(executionIds.size).toBe(1);
    expect(requests.filter(item => item.ok && item.replayed).length).toBe(11);
  });
});
