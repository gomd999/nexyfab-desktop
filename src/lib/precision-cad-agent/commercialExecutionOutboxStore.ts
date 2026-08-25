import { createHash, randomBytes } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import { canonicalCommercialExecution, validateCommercialExecutionJob, type CommercialExecutionJob, type CommercialWorkerReceipt } from '../../../packages/job-contracts/src/commercialPrecisionExecution';
import { verifyCommercialWorkerReceipt, type TrustedCommercialWorker } from './commercialWorkerReceipt';
import { consumeDbApprovalChallenge, fullBoundaryCommandHash, hashBoundaryArguments, type ApprovalConsumeInput } from './commercialAgentExecutionBoundary';
import { appendJournalEvent, canonicalJson, hashReceipt, verifyExecutionJournalChain, type ExecutionJournalReceipt } from './executionJournal';
import { assertCommercialWorkerIoMigration } from './commercialWorkerIo';

export const COMMERCIAL_OUTBOX_MIGRATION_VERSION = 2026082502;
export type CommercialOutboxRow = { job: CommercialExecutionJob; jobHash: string; status: 'PENDING' | 'CLAIMED' | 'SENT' | 'HOLD' | 'DONE' | 'VERIFIED_UNKNOWN'; attempt: number; leaseGeneration: number; leaseOwner?: string; leaseExpiresAt?: number; capability: string; capabilityHash: string };
export type OutboxResult = { ok: true; row: CommercialOutboxRow; replayed?: boolean } | { ok: false; code: 'MIGRATION_REQUIRED' | 'INVALID_JOB' | 'CONFLICT' | 'NOT_FOUND' | 'LEASE_HELD' | 'CAPABILITY_INVALID' | 'RECEIPT_INVALID' | 'RECEIPT_REPLAY' };
const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const nowMs = () => Date.now();
function rowFromDb(row: Record<string, unknown>): CommercialOutboxRow { const storedJob = JSON.parse(String(row.job_json)) as CommercialExecutionJob; const attempt = Number(row.attempt), leaseGeneration = Number(row.lease_generation); return { job: { ...storedJob, attempt, leaseGeneration }, jobHash: String(row.job_hash), status: row.status as CommercialOutboxRow['status'], attempt, leaseGeneration, ...(row.lease_owner ? { leaseOwner: String(row.lease_owner) } : {}), ...(row.lease_expires_at ? { leaseExpiresAt: Number(row.lease_expires_at) } : {}), capability: '', capabilityHash: String(row.capability_hash ?? '') }; }
function validApprovedJournal(input: { approval: ApprovalConsumeInput; job: CommercialExecutionJob; journal: { idempotencyKey: string; receiptJson: string; receiptHash: string; approvalHash: string; createdAt: number; updatedAt: number } }): boolean {
  if (Buffer.byteLength(input.journal.receiptJson, 'utf8') > 1024 * 1024) return false;
  try {
    const receipt = JSON.parse(input.journal.receiptJson) as ExecutionJournalReceipt;
    const args = receipt.command?.arguments as Record<string, unknown> | undefined;
    return canonicalJson(receipt) === input.journal.receiptJson
      && verifyExecutionJournalChain(receipt)
      && receipt.lifecycle === 'APPROVED'
      && receipt.executionId === input.job.executionId
      && receipt.idempotencyKey === input.journal.idempotencyKey
      && receipt.commandHash === input.job.commandHash
      && receipt.version === input.job.journalVersion
      && receipt.receiptHash === input.journal.receiptHash
      && hashReceipt(receipt) === input.journal.receiptHash
      && receipt.approvalHash === input.journal.approvalHash
      && receipt.approval?.approvalId === `boundary:${input.approval.challengeId}`
      && receipt.approval.actorId === input.approval.actorId
      && receipt.command.domain === 'precision-cad-agent'
      && receipt.command.operation === input.job.tool
      && !!args
      && hashBoundaryArguments(args.toolArguments) === input.job.argumentsHash
      && args.tenantId === input.job.tenantId
      && args.projectId === input.job.projectId
      && args.workspaceId === input.job.workspaceId
      && args.workspaceRevision === input.job.workspaceRevision
      && args.modelContentHash === input.job.workspaceContentHash
      && args.generationRunId === input.job.generationRunId
      && args.generationStateRevision === input.job.generationStateRevision
      && args.generationProgramSha256 === input.job.generationProgramSha256
      && args.targetSha256 === input.job.targetHash
      && receipt.workspaceBinding.workspaceId === input.job.workspaceId
      && receipt.workspaceBinding.projectId === input.job.projectId
      && receipt.workspaceBinding.revision === input.job.workspaceRevision
      && receipt.workspaceBinding.contentHash === input.job.workspaceContentHash
      && Date.parse(receipt.createdAt) === input.journal.createdAt
      && Date.parse(receipt.updatedAt) === input.journal.updatedAt;
  } catch { return false; }
}

function journalFromRow(row: Record<string, unknown> | undefined): ExecutionJournalReceipt | null {
  if (!row || typeof row.receipt_json !== 'string' || Buffer.byteLength(row.receipt_json, 'utf8') > 1024 * 1024) return null;
  try {
    const receipt = JSON.parse(row.receipt_json) as ExecutionJournalReceipt;
    return canonicalJson(receipt) === row.receipt_json
      && verifyExecutionJournalChain(receipt)
      && receipt.receiptHash === row.receipt_hash
      && hashReceipt(receipt) === row.receipt_hash
      && receipt.lifecycle === row.lifecycle
      && receipt.version === Number(row.version)
      ? receipt
      : null;
  } catch { return null; }
}

function journalMatchesClaimJob(receipt: ExecutionJournalReceipt, job: CommercialExecutionJob): boolean {
  return receipt.lifecycle === 'APPROVED'
    && receipt.executionId === job.executionId
    && receipt.version === job.journalVersion
    && receipt.commandHash === job.commandHash
    && receipt.workspace.before.workspaceId === job.workspaceId
    && receipt.workspace.before.projectId === job.projectId
    && receipt.workspace.before.revision === job.workspaceRevision
    && receipt.workspace.before.contentHash === job.workspaceContentHash
    && receipt.approval?.approved === true
    && receipt.approval.userInitiated === true;
}
export async function assertCommercialOutboxMigration(db: DbAdapter): Promise<void> {
  try { await assertCommercialWorkerIoMigration(db); }
  catch { throw new Error(`commercial_outbox_migration_required:v${COMMERCIAL_OUTBOX_MIGRATION_VERSION}`); }
}

async function insertCommercialInputArtifact(db: DbAdapter, job: CommercialExecutionJob, at: number): Promise<void> {
  const input = job.inputArtifact;
  if (!input) throw new Error('commercial_input_artifact_required');
  const inserted = await db.execute(
    'INSERT INTO nf_precision_cad_commercial_input_artifacts (job_id, execution_id, tenant_id, project_id, artifact_id, object_key, content_sha256, byte_length, media_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    job.jobId, job.executionId, job.tenantId, job.projectId, input.artifactId,
    input.objectKey, input.contentSha256, input.byteLength, input.mediaType, at,
  );
  if (inserted.changes !== 1) throw new Error('commercial_input_artifact_conflict');
}

async function exactCommercialInputArtifact(db: DbAdapter, job: CommercialExecutionJob): Promise<boolean> {
  const input = job.inputArtifact;
  if (!input) return false;
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT execution_id, tenant_id, project_id, artifact_id, object_key, content_sha256, byte_length, media_type FROM nf_precision_cad_commercial_input_artifacts WHERE job_id = ?',
    job.jobId,
  );
  return !!row
    && row.execution_id === job.executionId
    && row.tenant_id === job.tenantId
    && row.project_id === job.projectId
    && row.artifact_id === input.artifactId
    && row.object_key === input.objectKey
    && row.content_sha256 === input.contentSha256
    && Number(row.byte_length) === input.byteLength
    && row.media_type === input.mediaType;
}

export class CommercialExecutionOutboxStore {
  constructor(private readonly db: DbAdapter) {}
  async enqueue(job: CommercialExecutionJob, at = nowMs()): Promise<OutboxResult> {
    if (validateCommercialExecutionJob(job).length) return { ok: false, code: 'INVALID_JOB' };
    try { await assertCommercialOutboxMigration(this.db); } catch { return { ok: false, code: 'MIGRATION_REQUIRED' }; }
    const jobJson = canonicalCommercialExecution(job); const jobHash = hash(jobJson);
    const existing = await this.db.queryOne<Record<string, unknown>>('SELECT * FROM nf_precision_cad_commercial_outbox WHERE job_id = ?', job.jobId);
    if (existing) { const row = rowFromDb(existing); return row.jobHash === jobHash && await exactCommercialInputArtifact(this.db, job) ? { ok: true, row, replayed: true } : { ok: false, code: 'CONFLICT' }; }
    try {
      await this.db.transaction(async tx => {
        const inserted = await tx.execute('INSERT INTO nf_precision_cad_commercial_outbox (job_id, tenant_id, project_id, execution_id, generation_run_id, job_hash, job_json, status, attempt, lease_generation, lease_owner, lease_expires_at, capability_hash, available_at, created_at, updated_at, last_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', job.jobId, job.tenantId, job.projectId, job.executionId, job.generationRunId, jobHash, jobJson, 'PENDING', job.attempt, job.leaseGeneration, null, null, null, at, at, at, null);
        if (inserted.changes !== 1) throw new Error('outbox_conflict');
        await insertCommercialInputArtifact(tx, job, at);
      });
      const row = await this.db.queryOne<Record<string, unknown>>('SELECT * FROM nf_precision_cad_commercial_outbox WHERE job_id = ?', job.jobId); if (!row) return { ok: false, code: 'NOT_FOUND' }; return { ok: true, row: rowFromDb(row) };
    } catch { const raced = await this.db.queryOne<Record<string, unknown>>('SELECT * FROM nf_precision_cad_commercial_outbox WHERE job_id = ?', job.jobId); return raced && rowFromDb(raced).jobHash === jobHash && await exactCommercialInputArtifact(this.db, job) ? { ok: true, row: rowFromDb(raced), replayed: true } : { ok: false, code: 'CONFLICT' }; }
  }
  async claim(owner: string, secret: string, at = nowMs(), leaseMs = 15 * 60_000): Promise<OutboxResult> {
    if (!owner || !secret || leaseMs < 30_000 || leaseMs > 30 * 60_000) return { ok: false, code: 'INVALID_JOB' };
    await assertCommercialOutboxMigration(this.db);
    try {
      return await this.db.transaction(async tx => {
        const candidate = await tx.queryOne<Record<string, unknown>>('SELECT * FROM nf_precision_cad_commercial_outbox WHERE status = ? AND available_at <= ? ORDER BY available_at ASC LIMIT 1', 'PENDING', at);
        if (!candidate) return { ok: false, code: 'NOT_FOUND' } as OutboxResult;
        const current = rowFromDb(candidate);
        const journalRow = await tx.queryOne<Record<string, unknown>>('SELECT lifecycle, version, receipt_json, receipt_hash FROM nf_precision_cad_execution_journal WHERE execution_id = ?', current.job.executionId);
        const journal = journalFromRow(journalRow);
        if (!journal || !journalMatchesClaimJob(journal, current.job)) return { ok: false, code: 'INVALID_JOB' } as OutboxResult;
        const nextAttempt = current.attempt; const nextGeneration = current.leaseGeneration + 1; const capability = randomBytes(32).toString('base64url'); const capabilityHash = hash(capability);
        const expiresAt = at + leaseMs; const acquiredAtIso = new Date(at).toISOString(); const expiresAtIso = new Date(expiresAt).toISOString();
        const updated = await tx.execute('UPDATE nf_precision_cad_commercial_outbox SET status = ?, attempt = ?, lease_generation = ?, lease_owner = ?, lease_expires_at = ?, capability_hash = ?, updated_at = ? WHERE job_id = ? AND status = ? AND available_at <= ?', 'CLAIMED', nextAttempt, nextGeneration, owner, expiresAt, capabilityHash, at, current.job.jobId, 'PENDING', at);
        if (updated.changes !== 1) return { ok: false, code: 'LEASE_HELD' } as OutboxResult;
        const executing = appendJournalEvent({ ...journal, lifecycle: 'EXECUTING', lease: { ownerId: owner, acquiredAt: acquiredAtIso, expiresAt: expiresAtIso } }, 'LEASE_ACQUIRED', acquiredAtIso, { ownerId: owner, expiresAt: expiresAtIso });
        const journalUpdated = await tx.execute('UPDATE nf_precision_cad_execution_journal SET lifecycle = ?, version = ?, receipt_json = ?, receipt_hash = ?, lease_owner_id = ?, lease_expires_at = ?, updated_at = ? WHERE execution_id = ? AND lifecycle = ? AND version = ? AND receipt_hash = ?', 'EXECUTING', executing.version, canonicalJson(executing), executing.receiptHash, owner, expiresAt, at, journal.executionId, 'APPROVED', journal.version, journal.receiptHash);
        if (journalUpdated.changes !== 1) throw new Error('journal_claim_cas_failed');
        const event = executing.events.at(-1)!;
        const eventInserted = await tx.execute('INSERT INTO nf_precision_cad_execution_events (execution_id, sequence, event_type, event_at, data_json, previous_hash, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?)', executing.executionId, event.sequence, event.type, event.at, canonicalJson(event.data), event.previousHash, event.hash);
        if (eventInserted.changes !== 1) throw new Error('journal_claim_event_failed');
        return { ok: true, row: { ...current, job: { ...current.job, attempt: nextAttempt, leaseGeneration: nextGeneration }, status: 'CLAIMED', attempt: nextAttempt, leaseGeneration: nextGeneration, leaseOwner: owner, leaseExpiresAt: expiresAt, capability, capabilityHash } } as OutboxResult;
      });
    } catch { return { ok: false, code: 'LEASE_HELD' }; }
  }
  async markSent(jobId: string, owner: string, capability: string, at = nowMs()): Promise<OutboxResult> { await assertCommercialOutboxMigration(this.db); const current = await this.read(jobId); if (!current) return { ok: false, code: 'NOT_FOUND' }; if (current.status !== 'CLAIMED' || current.leaseOwner !== owner || current.capabilityHash !== hash(capability)) return { ok: false, code: 'CAPABILITY_INVALID' }; const updated = await this.db.execute('UPDATE nf_precision_cad_commercial_outbox SET status = ?, updated_at = ? WHERE job_id = ? AND status = ? AND lease_owner = ? AND capability_hash = ?', 'SENT', at, jobId, 'CLAIMED', owner, current.capabilityHash); if (updated.changes !== 1) return { ok: false, code: 'CAPABILITY_INVALID' }; return { ok: true, row: { ...current, status: 'SENT' } }; }
  async hold(jobId: string, reason: string, at = nowMs()): Promise<OutboxResult> { await assertCommercialOutboxMigration(this.db); const current = await this.read(jobId); if (!current) return { ok: false, code: 'NOT_FOUND' }; await this.db.execute('UPDATE nf_precision_cad_commercial_outbox SET status = ?, last_error = ?, updated_at = ? WHERE job_id = ?', 'HOLD', reason.slice(0, 512), at, jobId); return { ok: true, row: { ...current, status: 'HOLD' } }; }
  async recoverExpiredClaims(at = nowMs()): Promise<number> {
    await assertCommercialOutboxMigration(this.db);
    const rows = await this.db.queryAll<Record<string, unknown>>('SELECT job_id, execution_id FROM nf_precision_cad_commercial_outbox WHERE status = ? AND lease_expires_at <= ?', 'CLAIMED', at);
    let count = 0;
    for (const row of rows) {
      try {
        count += await this.db.transaction(async tx => {
          const journalRow = await tx.queryOne<Record<string, unknown>>('SELECT lifecycle, version, receipt_json, receipt_hash FROM nf_precision_cad_execution_journal WHERE execution_id = ?', String(row.execution_id));
          const journal = journalFromRow(journalRow);
          if (!journal || (journal.lifecycle !== 'EXECUTING' && journal.lifecycle !== 'VERIFIED_UNKNOWN')) return 0;
          if (journal.lifecycle === 'EXECUTING') {
            const recoveredAt = new Date(at).toISOString();
            const unknown = appendJournalEvent({ ...journal, lifecycle: 'VERIFIED_UNKNOWN', holdReason: 'lease_expired_authoritative_receipt_required', lease: undefined }, 'VERIFIED_UNKNOWN', recoveredAt, { reason: 'lease_expired_authoritative_receipt_required', hold: true });
            const journalUpdated = await tx.execute('UPDATE nf_precision_cad_execution_journal SET lifecycle = ?, version = ?, receipt_json = ?, receipt_hash = ?, lease_owner_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE execution_id = ? AND lifecycle = ? AND version = ? AND receipt_hash = ?', 'VERIFIED_UNKNOWN', unknown.version, canonicalJson(unknown), unknown.receiptHash, at, journal.executionId, 'EXECUTING', journal.version, journal.receiptHash);
            if (journalUpdated.changes !== 1) throw new Error('journal_recovery_cas_failed');
            const event = unknown.events.at(-1)!;
            const eventInserted = await tx.execute('INSERT INTO nf_precision_cad_execution_events (execution_id, sequence, event_type, event_at, data_json, previous_hash, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?)', unknown.executionId, event.sequence, event.type, event.at, canonicalJson(event.data), event.previousHash, event.hash);
            if (eventInserted.changes !== 1) throw new Error('journal_recovery_event_failed');
          }
          const updated = await tx.execute('UPDATE nf_precision_cad_commercial_outbox SET status = ?, last_error = ?, lease_owner = NULL, lease_expires_at = NULL, capability_hash = NULL, updated_at = ? WHERE job_id = ? AND status = ? AND lease_expires_at <= ?', 'VERIFIED_UNKNOWN', 'lease_expired_authoritative_receipt_required', at, String(row.job_id), 'CLAIMED', at);
          if (updated.changes !== 1) throw new Error('outbox_recovery_cas_failed');
          return 1;
        });
      } catch { /* a concurrent recovery owns this row */ }
    }
    return count;
  }
  async acceptReceipt(input: { receipt: CommercialWorkerReceipt; expected: Parameters<typeof verifyCommercialWorkerReceipt>[0]['expected']; trustedWorkers: Readonly<Record<string, TrustedCommercialWorker>>; now?: number }): Promise<OutboxResult> {
    await assertCommercialOutboxMigration(this.db); const current = await this.read(input.receipt.jobId); if (!current) return { ok: false, code: 'NOT_FOUND' }; const verified = verifyCommercialWorkerReceipt({ ...input, expected: { ...input.expected, attempt: current.attempt, leaseGeneration: current.leaseGeneration, leaseCapabilityHash: current.capabilityHash } }); if (!verified.ok) return { ok: false, code: 'RECEIPT_INVALID' }; if (current.attempt !== input.receipt.attempt || current.leaseGeneration !== input.receipt.leaseGeneration || current.capabilityHash !== input.receipt.leaseCapabilityHash || current.jobHash === '' || !current.leaseExpiresAt || Date.parse(input.receipt.completedAt) > current.leaseExpiresAt) return { ok: false, code: 'CAPABILITY_INVALID' }; if (current.status !== 'CLAIMED' && current.status !== 'SENT') { const old = await this.db.queryOne<{ receipt_hash: string }>('SELECT receipt_hash FROM nf_precision_cad_commercial_callbacks WHERE execution_id = ?', input.receipt.executionId); return old?.receipt_hash === verified.receiptHash ? { ok: true, row: current, replayed: true } : { ok: false, code: 'RECEIPT_REPLAY' }; } const safeStatus: CommercialOutboxRow['status'] = input.receipt.status === 'PASS' || input.receipt.status === 'VERIFIED_UNKNOWN' ? 'VERIFIED_UNKNOWN' : 'HOLD'; return this.db.transaction(async tx => { const inserted = await tx.execute('INSERT INTO nf_precision_cad_commercial_callbacks (execution_id, tenant_id, project_id, generation_run_id, journal_version, lease_generation, attempt, receipt_hash, receipt_json, received_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (execution_id) DO NOTHING', input.receipt.executionId, input.receipt.tenantId, input.receipt.projectId, input.receipt.generationRunId, input.receipt.journalVersion, input.receipt.leaseGeneration, input.receipt.attempt, verified.receiptHash, canonicalCommercialExecution(input.receipt), input.now ?? nowMs(), input.receipt.status); if (inserted.changes !== 1) return { ok: false, code: 'RECEIPT_REPLAY' } as OutboxResult; for (const artifact of input.receipt.outputArtifacts) { const artifactInserted = await tx.execute('INSERT INTO nf_precision_cad_commercial_worker_artifacts (execution_id, artifact_id, artifact_role, object_key, content_sha256, byte_length, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (execution_id, artifact_id) DO NOTHING', input.receipt.executionId, artifact.artifactId, artifact.role, artifact.objectKey, artifact.contentSha256, artifact.byteLength, input.now ?? nowMs()); if (artifactInserted.changes !== 1) throw new Error('worker_artifact_metadata_conflict'); } const updated = await tx.execute('UPDATE nf_precision_cad_commercial_outbox SET status = ?, last_error = ?, updated_at = ? WHERE job_id = ? AND status IN (?, ?) AND lease_generation = ? AND capability_hash = ?', safeStatus, safeStatus === 'VERIFIED_UNKNOWN' ? 'worker_pass_requires_authoritative_persistence_verification' : 'worker_hold', input.now ?? nowMs(), input.receipt.jobId, 'CLAIMED', 'SENT', current.leaseGeneration, current.capabilityHash); if (updated.changes !== 1) throw new Error('outbox_callback_cas_failed'); return { ok: true, row: { ...current, status: safeStatus } } as OutboxResult; }); }
  async read(jobId: string): Promise<CommercialOutboxRow | null> { const row = await this.db.queryOne<Record<string, unknown>>('SELECT * FROM nf_precision_cad_commercial_outbox WHERE job_id = ?', jobId); return row ? rowFromDb(row) : null; }
}

/** The only v3 enqueue path: approval consume, workspace CAS, claim, journal, immutable input, and outbox share one DB transaction. */
export async function enqueueCommercialExecutionTransaction(input: { db: DbAdapter; approval: ApprovalConsumeInput; approvalSecret: string; job: CommercialExecutionJob; journal: { idempotencyKey: string; receiptJson: string; receiptHash: string; approvalHash: string; createdAt: number; updatedAt: number } }): Promise<OutboxResult> {
  if (validateCommercialExecutionJob(input.job).length) return { ok: false, code: 'INVALID_JOB' };
  try { await assertCommercialOutboxMigration(input.db); } catch { return { ok: false, code: 'MIGRATION_REQUIRED' }; }
  const jobJson = canonicalCommercialExecution(input.job), jobHash = hash(jobJson);
  const exactReplay = async (db: DbAdapter): Promise<OutboxResult | undefined> => {
    const row = await db.queryOne<Record<string, unknown>>('SELECT o.* FROM nf_precision_cad_commercial_outbox o JOIN nf_precision_cad_execution_journal j ON j.execution_id = o.execution_id WHERE j.idempotency_key = ?', input.journal.idempotencyKey);
    if (!row) return undefined;
    const replay = rowFromDb(row);
    const journal = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_precision_cad_execution_journal WHERE execution_id = ?', replay.job.executionId);
    const claim = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_precision_cad_tool_claims WHERE execution_id = ?', replay.job.executionId);
    const challenge = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_precision_cad_approval_challenges WHERE challenge_id = ?', input.approval.challengeId);
    const exactInput = await exactCommercialInputArtifact(db, input.job);
    const exact = exactInput
      && replay.jobHash === jobHash
      && String(row.job_json) === jobJson
      && String(row.execution_id) === input.job.executionId
      && String(row.tenant_id) === input.job.tenantId
      && String(row.project_id) === input.job.projectId
      && String(row.generation_run_id) === input.job.generationRunId
      && Number(row.attempt) === input.job.attempt
      && Number(row.lease_generation) === input.job.leaseGeneration
      && journal
      && String(journal.idempotency_key) === input.journal.idempotencyKey
      && String(journal.command_hash) === input.job.commandHash
      && Number(journal.version) === input.job.journalVersion
      && String(journal.receipt_json) === input.journal.receiptJson
      && String(journal.receipt_hash) === input.journal.receiptHash
      && String(journal.approval_hash) === input.journal.approvalHash
      && claim
      && String(claim.project_id) === input.job.projectId
      && Number(claim.workspace_revision) === input.job.workspaceRevision
      && String(claim.call_id) === input.job.callId
      && String(claim.arguments_hash) === input.job.argumentsHash
      && String(claim.challenge_id) === input.approval.challengeId
      && challenge
      && String(challenge.challenge_id) === input.approval.challengeId
      && String(challenge.nonce) === input.approval.nonce
      && String(challenge.mac) === input.approval.mac
      && String(challenge.actor_id) === input.approval.actorId
      && String(challenge.role) === input.approval.role
      && String(challenge.project_id) === input.approval.projectId
      && String(challenge.workspace_id) === input.approval.workspaceId
      && Number(challenge.workspace_revision) === input.approval.workspaceRevision
      && String(challenge.workspace_content_hash) === input.approval.workspaceContentHash
      && String(challenge.tool) === input.approval.tool
      && String(challenge.scope) === input.approval.scope
      && String(challenge.call_id) === input.approval.callId
      && String(challenge.arguments_hash) === hashBoundaryArguments(input.approval.arguments)
      && String(challenge.command_hash) === fullBoundaryCommandHash(input.approval);
    return exact ? { ok: true, row: replay, replayed: true } : { ok: false, code: 'CONFLICT' };
  };
  const replay = await exactReplay(input.db); if (replay) return replay;
  if (!validApprovedJournal(input)) return { ok: false, code: 'INVALID_JOB' };
  try {
    return await input.db.transaction(async tx => {
      const head = await tx.queryOne<{ revision: number; content_hash: string }>('SELECT revision, content_hash FROM nf_cad_workspace_heads WHERE project_id = ?', input.job.projectId);
      if (!head || Number(head.revision) !== input.job.workspaceRevision || head.content_hash !== input.job.workspaceContentHash) throw new Error('workspace_conflict');
      const approvalBindingMatches = input.job.projectId === input.approval.projectId
        && input.job.workspaceId === input.approval.workspaceId
        && input.job.workspaceRevision === input.approval.workspaceRevision
        && input.job.workspaceContentHash === input.approval.workspaceContentHash
        && input.job.tool === input.approval.tool
        && input.job.scope === input.approval.scope
        && input.job.callId === input.approval.callId
        && input.job.argumentsHash === hashBoundaryArguments(input.approval.arguments);
      if (!approvalBindingMatches) throw new Error('approval_job_binding_conflict');
      const consumed = await consumeDbApprovalChallenge(tx, input.approval, input.approvalSecret); if (!consumed.ok) throw new Error('approval_invalid');
      const now = input.journal.createdAt;
      const journalInsert = await tx.execute('INSERT INTO nf_precision_cad_execution_journal (execution_id, idempotency_key, project_id, workspace_id, workspace_revision, workspace_content_hash, command_hash, approval_hash, lifecycle, version, receipt_json, receipt_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', input.job.executionId, input.journal.idempotencyKey, input.job.projectId, input.job.workspaceId, input.job.workspaceRevision, input.job.workspaceContentHash, input.job.commandHash, input.journal.approvalHash, 'APPROVED', input.job.journalVersion, input.journal.receiptJson, input.journal.receiptHash, input.journal.createdAt, input.journal.updatedAt);
      if (journalInsert.changes !== 1) throw new Error('journal_conflict');
      const claim = await tx.execute('INSERT INTO nf_precision_cad_tool_claims (project_id, workspace_revision, call_id, arguments_hash, challenge_id, execution_id, claimed_at) VALUES (?, ?, ?, ?, ?, ?, ?)', input.job.projectId, input.job.workspaceRevision, input.job.callId, input.job.argumentsHash, input.approval.challengeId, input.job.executionId, now);
      if (claim.changes !== 1) throw new Error('claim_conflict');
      const outbox = await tx.execute('INSERT INTO nf_precision_cad_commercial_outbox (job_id, tenant_id, project_id, execution_id, generation_run_id, job_hash, job_json, status, attempt, lease_generation, available_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', input.job.jobId, input.job.tenantId, input.job.projectId, input.job.executionId, input.job.generationRunId, jobHash, jobJson, 'PENDING', input.job.attempt, input.job.leaseGeneration, now, now, now);
      if (outbox.changes !== 1) throw new Error('outbox_conflict');
      await insertCommercialInputArtifact(tx, input.job, now);
      return { ok: true, row: { job: input.job, jobHash, status: 'PENDING', attempt: input.job.attempt, leaseGeneration: input.job.leaseGeneration, capability: '', capabilityHash: '' } };
    });
  } catch {
    return (await exactReplay(input.db)) ?? { ok: false, code: 'CONFLICT' };
  }
}
