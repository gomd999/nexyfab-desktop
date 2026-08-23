import type { DbAdapter } from '@/lib/db-adapter';
import {
  EXECUTION_JOURNAL_SCHEMA,
  canonicalJson,
  hashApproval,
  hashCommand,
  hashReceipt,
  hashWorkspaceBinding,
  sha256,
  verifyExecutionJournalChain,
  type CompareAndSwapResult,
  type ExecutionCommand,
  type ExecutionJournalReceipt,
  type JournalEvent,
  type WorkspaceBinding,
} from './executionJournal';

export const COMMERCIAL_EXECUTION_MIGRATION_VERSION = 2026082202;
const SHA256 = /^[a-f0-9]{64}$/;
export type DbJournalStoreError = 'MIGRATION_REQUIRED' | 'NOT_FOUND' | 'STALE_CAS' | 'IDEMPOTENCY_CONFLICT' | 'INVALID_RECEIPT';

function eventHash(event: Omit<JournalEvent, 'hash'>): string {
  return sha256(canonicalJson({ schema: EXECUTION_JOURNAL_SCHEMA, purpose: 'event', ...event }));
}
function appendEvent(receipt: ExecutionJournalReceipt, type: JournalEvent['type'], at: string, data: Record<string, unknown>): ExecutionJournalReceipt {
  const eventWithoutHash: Omit<JournalEvent, 'hash'> = { sequence: receipt.events.length, type, at, data, previousHash: receipt.headHash };
  const event = { ...eventWithoutHash, hash: eventHash(eventWithoutHash) };
  const next = { ...receipt, version: receipt.version + 1, updatedAt: at, events: [...receipt.events, event], headHash: event.hash };
  return { ...next, receiptHash: hashReceipt(next) };
}
function rowReceipt(row: Record<string, unknown>): ExecutionJournalReceipt | null {
  try {
    const receipt = JSON.parse(String(row.receipt_json)) as ExecutionJournalReceipt;
    return verifyExecutionJournalChain(receipt) ? receipt : null;
  } catch { return null; }
}
function receiptParams(receipt: ExecutionJournalReceipt): unknown[] {
  return [receipt.executionId, receipt.idempotencyKey, receipt.workspaceBinding.projectId ?? receipt.workspace.before.workspaceId, receipt.workspace.before.workspaceId, receipt.workspace.before.revision, receipt.workspace.before.contentHash, receipt.commandHash, receipt.approvalHash ?? null, receipt.persistenceReceiptHash ?? null, receipt.verificationReceiptHash ?? null, receipt.lifecycle, receipt.version, canonicalJson(receipt), receipt.receiptHash, receipt.lease?.ownerId ?? null, receipt.lease ? Date.parse(receipt.lease.expiresAt) : null, Date.parse(receipt.createdAt), Date.parse(receipt.updatedAt)];
}

export async function assertCommercialExecutionMigration(db: DbAdapter): Promise<void> {
  const row = await db.queryOne<{ version: number; checksum?: string }>('SELECT version, checksum FROM nf_schema_migrations WHERE version = ?', COMMERCIAL_EXECUTION_MIGRATION_VERSION).catch(() => undefined);
  const expected = process.env.POSTGRES_MIGRATION_CHECKSUM?.trim();
  if (!row || Number(row.version) !== COMMERCIAL_EXECUTION_MIGRATION_VERSION || !SHA256.test(row.checksum ?? '') || (expected && row.checksum !== expected)) {
    throw new Error(`commercial_execution_migration_required:v${COMMERCIAL_EXECUTION_MIGRATION_VERSION}`);
  }
}

function immutableReceiptIdentityMatches(current: ExecutionJournalReceipt, next: ExecutionJournalReceipt, executionId: string): boolean {
  return next.schema === current.schema
    && next.executionId === executionId && current.executionId === executionId
    && next.idempotencyKey === current.idempotencyKey
    && next.createdAt === current.createdAt
    && next.commandHash === current.commandHash
    && next.workspaceBindingHash === current.workspaceBindingHash
    && canonicalJson(next.command) === canonicalJson(current.command)
    && canonicalJson(next.workspaceBinding) === canonicalJson(current.workspaceBinding)
    && canonicalJson(next.workspace.before) === canonicalJson(current.workspace.before)
    && next.events.length > current.events.length
    && canonicalJson(next.events.slice(0, current.events.length)) === canonicalJson(current.events);
}

export class DbExecutionJournalStore {
  constructor(private readonly db: DbAdapter) {}

  async get(executionId: string): Promise<ExecutionJournalReceipt | null> {
    await assertCommercialExecutionMigration(this.db);
    const row = await this.db.queryOne<Record<string, unknown>>('SELECT receipt_json FROM nf_precision_cad_execution_journal WHERE execution_id = ?', executionId);
    return row ? rowReceipt(row) : null;
  }
  async getByIdempotencyKey(idempotencyKey: string): Promise<ExecutionJournalReceipt | null> {
    await assertCommercialExecutionMigration(this.db);
    const row = await this.db.queryOne<Record<string, unknown>>('SELECT receipt_json FROM nf_precision_cad_execution_journal WHERE idempotency_key = ?', idempotencyKey);
    return row ? rowReceipt(row) : null;
  }
  async create(receipt: ExecutionJournalReceipt): Promise<CompareAndSwapResult> {
    if (!verifyExecutionJournalChain(receipt)) return { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
    await assertCommercialExecutionMigration(this.db);
    try {
      return await this.db.transaction(async tx => {
        const existing = await tx.queryOne<Record<string, unknown>>('SELECT receipt_json FROM nf_precision_cad_execution_journal WHERE idempotency_key = ?', receipt.idempotencyKey);
        if (existing) return { ok: false as const, code: 'IDEMPOTENCY_CONFLICT' as const, receipt: rowReceipt(existing) ?? undefined };
        await tx.execute(`INSERT INTO nf_precision_cad_execution_journal (execution_id, idempotency_key, project_id, workspace_id, workspace_revision, workspace_content_hash, command_hash, approval_hash, persistence_receipt_hash, verification_receipt_hash, lifecycle, version, receipt_json, receipt_hash, lease_owner_id, lease_expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...receiptParams(receipt));
        await this.insertEvents(tx, receipt, 0);
        return { ok: true as const, receipt };
      });
    } catch {
      const raced = await this.getByIdempotencyKey(receipt.idempotencyKey);
      return raced ? { ok: false, code: 'IDEMPOTENCY_CONFLICT', receipt: raced } : { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
    }
  }
  async compareAndSwap(executionId: string, expectedVersion: number, next: ExecutionJournalReceipt): Promise<CompareAndSwapResult> {
    await assertCommercialExecutionMigration(this.db);
    if (!verifyExecutionJournalChain(next) || next.version !== expectedVersion + 1) return { ok: false, code: 'STALE_CAS' };
    return this.db.transaction(async tx => {
      const row = await tx.queryOne<Record<string, unknown>>('SELECT receipt_json, version FROM nf_precision_cad_execution_journal WHERE execution_id = ?', executionId);
      if (!row) return { ok: false as const, code: 'NOT_FOUND' as const };
      const current = rowReceipt(row); if (!current) return { ok: false as const, code: 'STALE_CAS' as const };
      if (Number(row.version) !== expectedVersion || current.version !== expectedVersion || !immutableReceiptIdentityMatches(current, next, executionId)) return { ok: false as const, code: 'STALE_CAS' as const, receipt: current };
      const updated = await tx.execute(`UPDATE nf_precision_cad_execution_journal SET lifecycle = ?, version = ?, receipt_json = ?, receipt_hash = ?, approval_hash = ?, persistence_receipt_hash = ?, verification_receipt_hash = ?, lease_owner_id = ?, lease_expires_at = ?, updated_at = ? WHERE execution_id = ? AND version = ?`, next.lifecycle, next.version, canonicalJson(next), next.receiptHash, next.approvalHash ?? null, next.persistenceReceiptHash ?? null, next.verificationReceiptHash ?? null, next.lease?.ownerId ?? null, next.lease ? Date.parse(next.lease.expiresAt) : null, Date.parse(next.updatedAt), executionId, expectedVersion);
      if (updated.changes !== 1) {
        const raced = await tx.queryOne<Record<string, unknown>>('SELECT receipt_json FROM nf_precision_cad_execution_journal WHERE execution_id = ?', executionId);
        return { ok: false as const, code: 'STALE_CAS' as const, receipt: (raced && rowReceipt(raced)) || current };
      }
      await this.insertEvents(tx, next, current.events.length);
      return { ok: true as const, receipt: next };
    });
  }
  async createApproved(input: { executionId: string; idempotencyKey: string; command: ExecutionCommand; workspace: WorkspaceBinding; approval: NonNullable<ExecutionJournalReceipt['approval']>; now: string }): Promise<CompareAndSwapResult> {
    await assertCommercialExecutionMigration(this.db);
    return this.db.transaction(tx => this.createApprovedInTransaction(tx, input));
  }
  async createApprovedInTransaction(db: DbAdapter, input: { executionId: string; idempotencyKey: string; command: ExecutionCommand; workspace: WorkspaceBinding; approval: NonNullable<ExecutionJournalReceipt['approval']>; now: string }): Promise<CompareAndSwapResult> {
    const commandHash = hashCommand(input.command); const workspaceBindingHash = hashWorkspaceBinding(input.workspace);
    if (input.approval.commandHash !== commandHash || input.approval.workspaceBindingHash !== workspaceBindingHash) return { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
    const planned: ExecutionJournalReceipt = { schema: EXECUTION_JOURNAL_SCHEMA, executionId: input.executionId, idempotencyKey: input.idempotencyKey, lifecycle: 'PLANNED', version: 0, createdAt: input.now, updatedAt: input.now, command: input.command, commandHash, workspaceBinding: input.workspace, workspaceBindingHash, workspace: { before: input.workspace }, affectedObjects: [], artifacts: [], events: [], headHash: '0'.repeat(64), receiptHash: '0'.repeat(64) };
    const p = appendEvent(planned, 'PLANNED', input.now, { commandHash, workspaceBindingHash });
    const approved = appendEvent({ ...p, lifecycle: 'APPROVED', approval: input.approval, approvalHash: hashApproval(input.approval) }, 'APPROVED', input.now, { approvalHash: hashApproval(input.approval), actorId: input.approval.actorId });
    const existing = await db.queryOne<Record<string, unknown>>('SELECT receipt_json FROM nf_precision_cad_execution_journal WHERE idempotency_key = ?', input.idempotencyKey);
    if (existing) return { ok: false, code: 'IDEMPOTENCY_CONFLICT', receipt: rowReceipt(existing) ?? undefined };
    await db.execute(`INSERT INTO nf_precision_cad_execution_journal (execution_id, idempotency_key, project_id, workspace_id, workspace_revision, workspace_content_hash, command_hash, approval_hash, persistence_receipt_hash, verification_receipt_hash, lifecycle, version, receipt_json, receipt_hash, lease_owner_id, lease_expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...receiptParams(approved));
    await this.insertEvents(db, approved, 0);
    return { ok: true, receipt: approved };
  }
  async beginExecuting(executionId: string, expectedVersion: number, ownerId: string, now: string, leaseMs = 300_000): Promise<CompareAndSwapResult> {
    if (!ownerId || ownerId.length > 256 || !Number.isSafeInteger(leaseMs) || leaseMs <= 0 || leaseMs > 86_400_000) return { ok: false, code: 'STALE_CAS' };
    const current = await this.get(executionId);
    if (!current || current.version !== expectedVersion || current.lifecycle !== 'APPROVED' || !current.approval?.approved) return { ok: false, code: current ? 'STALE_CAS' : 'NOT_FOUND', ...(current ? { receipt: current } : {}) };
    const nowMs = Date.parse(now); if (!Number.isFinite(nowMs)) return { ok: false, code: 'STALE_CAS', receipt: current };
    const lease = { ownerId, acquiredAt: now, expiresAt: new Date(nowMs + leaseMs).toISOString() };
    const next = appendEvent({ ...current, lifecycle: 'EXECUTING', lease }, 'LEASE_ACQUIRED', now, { ownerId, expiresAt: lease.expiresAt });
    return this.compareAndSwap(executionId, expectedVersion, next);
  }
  async recoverExpiredLeases(now = Date.now(), limit = 100): Promise<{ executionId: string; status: 'HOLD' }[]> {
    await assertCommercialExecutionMigration(this.db);
    const boundedLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : 100;
    const rows = await this.db.queryAll<Record<string, unknown>>('SELECT receipt_json FROM nf_precision_cad_execution_journal WHERE lifecycle = ? AND lease_expires_at <= ? ORDER BY lease_expires_at ASC LIMIT ?', 'EXECUTING', now, boundedLimit);
    const held: { executionId: string; status: 'HOLD' }[] = [];
    for (const row of rows) {
      const current = rowReceipt(row); if (!current) continue;
      const next = appendEvent({ ...current, lifecycle: 'VERIFIED_UNKNOWN', holdReason: 'lease_expired_authoritative_receipt_required', lease: undefined }, 'VERIFIED_UNKNOWN', new Date(now).toISOString(), { reason: 'lease_expired_authoritative_receipt_required', hold: true });
      const result = await this.compareAndSwap(current.executionId, current.version, next);
      if (result.ok) held.push({ executionId: current.executionId, status: 'HOLD' });
    }
    return held;
  }
  private async insertEvents(db: DbAdapter, receipt: ExecutionJournalReceipt, from: number): Promise<void> {
    for (const event of receipt.events.slice(from)) await db.execute('INSERT INTO nf_precision_cad_execution_events (execution_id, sequence, event_type, event_at, data_json, previous_hash, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?)', receipt.executionId, event.sequence, event.type, event.at, canonicalJson(event.data), event.previousHash, event.hash);
  }
}
