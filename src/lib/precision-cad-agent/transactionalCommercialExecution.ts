import { consumeDbApprovalChallenge, hashBoundaryArguments, type ApprovalConsumeInput } from './commercialAgentExecutionBoundary';
import { DbExecutionJournalStore } from './dbExecutionJournalStore';
import { hashCommand, hashWorkspaceBinding, type ExecutionCommand, type ExecutionJournalReceipt } from './executionJournal';
import type { DbAdapter } from '@/lib/db-adapter';

export type DurableWorkerContract = { submit(input: { executionId: string; projectId: string; workspaceRevision: number; commandHash: string }): Promise<{ accepted: true; workerReceiptId: string } | { accepted: false; reason: string }> };
export type TransactionalCommercialExecutionInput = {
  db: DbAdapter;
  approval: ApprovalConsumeInput;
  approvalSecret: string;
  idempotencyKey: string;
  executionId: string;
  command: ExecutionCommand;
  now?: number;
  nowIso?: string;
  durableWorker?: DurableWorkerContract;
};
export type TransactionalCommercialExecutionResult =
  | { ok: true; status: 'QUEUED' | 'REPLAY'; executionId: string; workerStarted: boolean; receipt: ExecutionJournalReceipt; workerReceiptId?: string }
  | { ok: false; status: 'HOLD'; code: 'DURABLE_WORKER_CONTRACT_REQUIRED' | 'APPROVAL_INVALID' | 'WORKSPACE_STALE' | 'PAYLOAD_SUBSTITUTION' | 'JOURNAL_CONFLICT' | 'MIGRATION_REQUIRED'; httpStatus: 202 | 409 | 503; executionId?: string; receipt?: ExecutionJournalReceipt };

function validKey(value: unknown): boolean { return typeof value === 'string' && value.length > 0 && value.length <= 256; }
class TransactionAbort extends Error {
  constructor(readonly result: { code: 'APPROVAL_INVALID' | 'WORKSPACE_STALE' | 'PAYLOAD_SUBSTITUTION' | 'JOURNAL_CONFLICT'; executionId?: string }) { super(result.code); }
}

export async function executeTransactionalCommercial(input: TransactionalCommercialExecutionInput): Promise<TransactionalCommercialExecutionResult> {
  if (!validKey(input.idempotencyKey) || !validKey(input.executionId) || !input.command || !input.approval) return { ok: false, status: 'HOLD', code: 'PAYLOAD_SUBSTITUTION', httpStatus: 409 };
  const now = input.now ?? Date.now(); const nowIso = input.nowIso ?? new Date(now).toISOString();
  const commandHash = hashCommand(input.command); const workspaceHash = hashWorkspaceBinding({ workspaceId: input.approval.workspaceId, projectId: input.approval.projectId, revision: input.approval.workspaceRevision, contentHash: input.approval.workspaceContentHash });
  const store = new DbExecutionJournalStore(input.db);
  try {
    const replay = await store.getByIdempotencyKey(input.idempotencyKey);
    if (replay) {
      if (replay.commandHash !== commandHash || replay.workspaceBindingHash !== workspaceHash) return { ok: false, status: 'HOLD', code: 'PAYLOAD_SUBSTITUTION', httpStatus: 409, executionId: replay.executionId, receipt: replay };
      return { ok: true, status: 'REPLAY', executionId: replay.executionId, workerStarted: false, receipt: replay };
    }
    const transaction = await input.db.transaction(async tx => {
      const head = await tx.queryOne<{ revision: number; content_hash: string }>('SELECT revision, content_hash FROM nf_cad_workspace_heads WHERE project_id = ?', input.approval.projectId);
      if (!head || Number(head.revision) !== input.approval.workspaceRevision || head.content_hash !== input.approval.workspaceContentHash) throw new TransactionAbort({ code: 'WORKSPACE_STALE' });
      const consumed = await consumeDbApprovalChallenge(tx, input.approval, input.approvalSecret, now);
      if (!consumed.ok) throw new TransactionAbort({ code: 'APPROVAL_INVALID' });
      const argumentsHash = hashBoundaryArguments(input.command.arguments);
      if (input.command.operation !== input.approval.tool || argumentsHash !== hashBoundaryArguments(input.approval.arguments)) throw new TransactionAbort({ code: 'PAYLOAD_SUBSTITUTION' });
      const approved = await store.createApprovedInTransaction(tx, { executionId: input.executionId, idempotencyKey: input.idempotencyKey, command: input.command, workspace: { workspaceId: input.approval.workspaceId, projectId: input.approval.projectId, revision: input.approval.workspaceRevision, contentHash: input.approval.workspaceContentHash }, approval: { approvalId: `boundary:${input.approval.challengeId}`, actorId: input.approval.actorId, approved: true, approvedAt: nowIso, commandHash, workspaceBindingHash: workspaceHash, userInitiated: true }, now: nowIso });
      if (!approved.ok) throw new TransactionAbort({ code: 'JOURNAL_CONFLICT', executionId: approved.receipt?.executionId });
      const claimed = await tx.execute('INSERT INTO nf_precision_cad_tool_claims (project_id, workspace_revision, call_id, arguments_hash, challenge_id, execution_id, claimed_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (project_id, workspace_revision, call_id) DO NOTHING', input.approval.projectId, input.approval.workspaceRevision, input.approval.callId, argumentsHash, input.approval.challengeId, input.executionId, now);
      if (claimed.changes !== 1) {
        const existing = await tx.queryOne<{ arguments_hash: string; execution_id: string }>('SELECT arguments_hash, execution_id FROM nf_precision_cad_tool_claims WHERE project_id = ? AND workspace_revision = ? AND call_id = ?', input.approval.projectId, input.approval.workspaceRevision, input.approval.callId);
        throw new TransactionAbort({ code: existing?.arguments_hash === argumentsHash ? 'JOURNAL_CONFLICT' : 'PAYLOAD_SUBSTITUTION', executionId: existing?.execution_id });
      }
      return { ok: true as const, receipt: approved.receipt };
    }).catch(error => {
      if (error instanceof TransactionAbort) return { ok: false as const, ...error.result };
      throw error;
    });
    if (!transaction.ok) return { ok: false, status: 'HOLD', code: transaction.code, httpStatus: transaction.code === 'WORKSPACE_STALE' || transaction.code === 'PAYLOAD_SUBSTITUTION' || transaction.code === 'APPROVAL_INVALID' ? 409 : 503, executionId: transaction.executionId };
    if (!input.durableWorker) return { ok: false, status: 'HOLD', code: 'DURABLE_WORKER_CONTRACT_REQUIRED', httpStatus: 202, executionId: transaction.receipt.executionId, receipt: transaction.receipt };
    const executing = await store.beginExecuting(transaction.receipt.executionId, transaction.receipt.version, `orchestrator:${transaction.receipt.executionId}`, nowIso);
    if (!executing.ok) return { ok: false, status: 'HOLD', code: 'JOURNAL_CONFLICT', httpStatus: 503, executionId: transaction.receipt.executionId, receipt: executing.receipt };
    const submitted = await input.durableWorker.submit({ executionId: executing.receipt.executionId, projectId: input.approval.projectId, workspaceRevision: input.approval.workspaceRevision, commandHash });
    if (!submitted.accepted) return { ok: false, status: 'HOLD', code: 'DURABLE_WORKER_CONTRACT_REQUIRED', httpStatus: 202, executionId: executing.receipt.executionId, receipt: executing.receipt };
    return { ok: true, status: 'QUEUED', executionId: executing.receipt.executionId, workerStarted: true, workerReceiptId: submitted.workerReceiptId, receipt: executing.receipt };
  } catch (error) {
    const code = String(error).includes('migration_required') ? 'MIGRATION_REQUIRED' : 'JOURNAL_CONFLICT';
    return { ok: false, status: 'HOLD', code, httpStatus: code === 'MIGRATION_REQUIRED' ? 503 : 503, executionId: input.executionId };
  }
}
