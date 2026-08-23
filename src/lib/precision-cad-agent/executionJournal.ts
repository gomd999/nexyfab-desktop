import { createHash } from 'node:crypto';

export const EXECUTION_JOURNAL_SCHEMA = 'nexyfab.precision-cad-execution-journal.v1' as const;
const ZERO_HASH = '0'.repeat(64);
const SHA256 = /^[a-f0-9]{64}$/i;

export type ExecutionLifecycle = 'PLANNED' | 'APPROVED' | 'EXECUTING' | 'COMMITTED' | 'FAILED' | 'ROLLED_BACK' | 'VERIFIED_UNKNOWN';

export type WorkspaceBinding = {
  workspaceId: string;
  projectId?: string;
  revision: number;
  contentHash: string;
};

export type ExecutionCommand = {
  domain: string;
  operation: string;
  arguments: Readonly<Record<string, unknown>>;
};

export type UserApproval = {
  approvalId: string;
  actorId: string;
  approved: true;
  approvedAt: string;
  commandHash: string;
  workspaceBindingHash: string;
  userInitiated: true;
};

export type RollbackApproval = {
  approvalId: string;
  actorId: string;
  approved: true;
  approvedAt: string;
  originalExecutionId: string;
  originalReceiptHash: string;
  failureReasonHash: string;
  targetWorkspaceHash: string;
  userInitiated: true;
};

export type ExternalArtifactBinding = {
  artifactId: string;
  sha256: string;
  kind?: string;
  objectKey?: string;
};

export type WorkspaceRevision = {
  workspaceId: string;
  projectId?: string;
  revision: number;
  contentHash: string;
};

export type AffectedObject = {
  objectId: string;
  beforeRevision?: number;
  afterRevision?: number;
};

export type JournalEventType =
  | 'PLANNED'
  | 'APPROVED'
  | 'LEASE_ACQUIRED'
  | 'LEASE_TAKEN_OVER'
  | 'COMMITTED'
  | 'FAILED'
  | 'VERIFIED_UNKNOWN'
  | 'ROLLED_BACK';

export type JournalEvent = {
  sequence: number;
  type: JournalEventType;
  at: string;
  data: Readonly<Record<string, unknown>>;
  previousHash: string;
  hash: string;
};

export type ExecutionLease = {
  ownerId: string;
  acquiredAt: string;
  expiresAt: string;
};

export type RollbackReceipt = {
  originalExecutionId: string;
  originalReceiptHash: string;
  failureReason: string;
  approvedBy: string;
  approvalHash: string;
  workspaceAfter: WorkspaceRevision;
  rollbackReceiptHash: string;
};

export type ExecutionJournalReceipt = {
  schema: typeof EXECUTION_JOURNAL_SCHEMA;
  executionId: string;
  idempotencyKey: string;
  lifecycle: ExecutionLifecycle;
  version: number;
  createdAt: string;
  updatedAt: string;
  command: ExecutionCommand;
  commandHash: string;
  workspaceBinding: WorkspaceBinding;
  workspaceBindingHash: string;
  approval?: UserApproval;
  approvalHash?: string;
  persistenceReceiptHash?: string;
  verificationReceiptHash?: string;
  workspace: { before: WorkspaceRevision; after?: WorkspaceRevision };
  affectedObjects: readonly AffectedObject[];
  artifacts: readonly ExternalArtifactBinding[];
  lease?: ExecutionLease;
  failureReason?: string;
  holdReason?: string;
  rollback?: RollbackReceipt;
  events: readonly JournalEvent[];
  headHash: string;
  receiptHash: string;
};

export type PlanExecutionInput = {
  idempotencyKey: string;
  command: ExecutionCommand;
  workspace: WorkspaceBinding;
};

export type JournalErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'STALE_CAS'
  | 'INVALID_TRANSITION'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_INVALID'
  | 'LEASE_HELD'
  | 'LEASE_EXPIRED'
  | 'LEASE_OWNER_MISMATCH'
  | 'ARTIFACT_BINDING_INVALID'
  | 'WORKSPACE_REVISION_INVALID'
  | 'EXECUTION_FAILED'
  | 'COMMIT_RECEIPT_UNCERTAIN'
  | 'ROLLBACK_INVALID';

export type JournalSuccess = { ok: true; receipt: ExecutionJournalReceipt; replayed?: boolean };
export type JournalFailure = { ok: false; code: JournalErrorCode; message: string; receipt?: ExecutionJournalReceipt };
export type JournalResult = JournalSuccess | JournalFailure;

export type CompareAndSwapResult =
  | { ok: true; receipt: ExecutionJournalReceipt }
  | { ok: false; code: 'NOT_FOUND' | 'STALE_CAS' | 'IDEMPOTENCY_CONFLICT'; receipt?: ExecutionJournalReceipt };

export interface ExecutionJournalStore {
  get(executionId: string): ExecutionJournalReceipt | null;
  getByIdempotencyKey(idempotencyKey: string): ExecutionJournalReceipt | null;
  create(receipt: ExecutionJournalReceipt): CompareAndSwapResult;
  compareAndSwap(executionId: string, expectedVersion: number, next: ExecutionJournalReceipt): CompareAndSwapResult;
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function canonicalNormalizedJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical_value_not_finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalNormalizedJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalNormalizedJson(record[key])}`).join(',')}}`;
  }
  throw new Error('canonical_value_unsupported');
}

/** Stable JSON used by every command, approval, workspace, event, and receipt hash. */
export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('canonical_value_unsupported');
  return canonicalNormalizedJson(JSON.parse(serialized) as unknown);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Hash the complete canonical persistence or verification receipt payload. */
export function hashBoundReceipt(value: unknown): string {
  return sha256(canonicalJson({ schema: EXECUTION_JOURNAL_SCHEMA, purpose: 'bound-receipt', value }));
}

export function hashCommand(command: ExecutionCommand): string {
  return sha256(canonicalJson({ schema: EXECUTION_JOURNAL_SCHEMA, purpose: 'command', command }));
}

export function hashWorkspaceBinding(binding: WorkspaceBinding): string {
  return sha256(canonicalJson({ schema: EXECUTION_JOURNAL_SCHEMA, purpose: 'workspace-binding', binding }));
}

export function hashApproval(approval: UserApproval): string {
  return sha256(canonicalJson({ schema: EXECUTION_JOURNAL_SCHEMA, purpose: 'approval', approval }));
}

export function hashRollbackApproval(approval: RollbackApproval): string {
  return sha256(canonicalJson({ schema: EXECUTION_JOURNAL_SCHEMA, purpose: 'rollback-approval', approval }));
}

export function hashReceipt(receipt: ExecutionJournalReceipt): string {
  const { receiptHash: _receiptHash, ...withoutHash } = receipt;
  return sha256(canonicalJson(withoutHash));
}

function eventHash(input: Omit<JournalEvent, 'hash'>): string {
  return sha256(canonicalJson({ schema: EXECUTION_JOURNAL_SCHEMA, purpose: 'event', ...input }));
}

function validId(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value);
}

function assertInput(input: PlanExecutionInput): void {
  if (!validId(input.idempotencyKey)) throw new Error('idempotency_key_required');
  if (!validId(input.command?.domain) || !validId(input.command?.operation) || !input.command.arguments || Array.isArray(input.command.arguments)) throw new Error('command_invalid');
  if (!validId(input.workspace?.workspaceId) || (input.workspace.projectId !== undefined && !validId(input.workspace.projectId))
    || !Number.isSafeInteger(input.workspace.revision) || input.workspace.revision < 0 || !validHash(input.workspace.contentHash)) throw new Error('workspace_binding_invalid');
  try {
    const encoded = JSON.stringify(input.command.arguments);
    if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > 256 * 1024) throw new Error('command_arguments_not_json');
    canonicalJson(input.command.arguments);
  } catch {
    throw new Error('command_arguments_not_json');
  }
}

function assertApproval(approval: UserApproval, commandHash: string, workspaceBindingHash: string): void {
  if (!approval || approval.approved !== true || approval.userInitiated !== true || !validId(approval.approvalId)
    || !validId(approval.actorId) || !validId(approval.approvedAt) || approval.commandHash !== commandHash
    || approval.workspaceBindingHash !== workspaceBindingHash || !validHash(approval.commandHash) || !validHash(approval.workspaceBindingHash)) throw new Error('approval_invalid');
}

function assertRollbackApproval(input: {
  approval: RollbackApproval;
  executionId: string;
  originalReceiptHash: string;
  failureReason: string;
  workspaceAfter: WorkspaceRevision;
}): void {
  const { approval } = input;
  if (!approval || approval.approved !== true || approval.userInitiated !== true
    || !validId(approval.approvalId) || !validId(approval.actorId)
    || !Number.isFinite(Date.parse(approval.approvedAt))
    || approval.originalExecutionId !== input.executionId
    || approval.originalReceiptHash !== input.originalReceiptHash
    || approval.failureReasonHash !== sha256(input.failureReason)
    || approval.targetWorkspaceHash !== sha256(canonicalJson(input.workspaceAfter))
    || !validHash(approval.originalReceiptHash)
    || !validHash(approval.failureReasonHash)
    || !validHash(approval.targetWorkspaceHash)) throw new Error('rollback_approval_invalid');
}

function assertWorkspaceAfter(before: WorkspaceRevision, after: WorkspaceRevision): void {
  if (!validId(after.workspaceId) || after.workspaceId !== before.workspaceId || (after.projectId ?? null) !== (before.projectId ?? null)
    || !Number.isSafeInteger(after.revision) || after.revision <= before.revision || !validHash(after.contentHash)) throw new Error('workspace_revision_invalid');
}

function validateArtifacts(artifacts: readonly ExternalArtifactBinding[]): void {
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    if (!validId(artifact.artifactId) || !validHash(artifact.sha256) || seen.has(artifact.artifactId)) throw new Error('artifact_binding_invalid');
    seen.add(artifact.artifactId);
  }
}

function validateObjects(objects: readonly AffectedObject[]): void {
  const seen = new Set<string>();
  for (const object of objects) {
    if (!validId(object.objectId) || seen.has(object.objectId)) throw new Error('affected_object_invalid');
    seen.add(object.objectId);
  }
}

export function appendJournalEvent(receipt: ExecutionJournalReceipt, type: JournalEventType, at: string, data: Readonly<Record<string, unknown>>): ExecutionJournalReceipt {
  const withoutEventHash: Omit<JournalEvent, 'hash'> = { sequence: receipt.events.length, type, at, data: clone(data), previousHash: receipt.headHash };
  const event: JournalEvent = { ...withoutEventHash, hash: eventHash(withoutEventHash) };
  const next = { ...receipt, updatedAt: at, version: receipt.version + 1, events: [...receipt.events, event], headHash: event.hash };
  return { ...next, receiptHash: hashReceipt(next) };
}
const appendEvent = appendJournalEvent;

function failure(code: JournalErrorCode, message: string, receipt?: ExecutionJournalReceipt): JournalFailure {
  return { ok: false, code, message, ...(receipt ? { receipt: clone(receipt) } : {}) };
}

function success(receipt: ExecutionJournalReceipt, replayed = false): JournalSuccess {
  return { ok: true, receipt: clone(receipt), ...(replayed ? { replayed: true } : {}) };
}

export class InMemoryExecutionJournalStore implements ExecutionJournalStore {
  private readonly records = new Map<string, ExecutionJournalReceipt>();
  private readonly keys = new Map<string, string>();

  get(executionId: string): ExecutionJournalReceipt | null {
    const value = this.records.get(executionId);
    return value ? clone(value) : null;
  }

  getByIdempotencyKey(idempotencyKey: string): ExecutionJournalReceipt | null {
    const executionId = this.keys.get(idempotencyKey);
    return executionId ? this.get(executionId) : null;
  }

  create(receipt: ExecutionJournalReceipt): CompareAndSwapResult {
    const existingId = this.keys.get(receipt.idempotencyKey);
    if (existingId) {
      const existing = this.records.get(existingId);
      return { ok: false, code: 'IDEMPOTENCY_CONFLICT', ...(existing ? { receipt: clone(existing) } : {}) };
    }
    if (this.records.has(receipt.executionId)) return { ok: false, code: 'IDEMPOTENCY_CONFLICT', receipt: clone(this.records.get(receipt.executionId)!) };
    this.records.set(receipt.executionId, clone(receipt));
    this.keys.set(receipt.idempotencyKey, receipt.executionId);
    return { ok: true, receipt: clone(receipt) };
  }

  compareAndSwap(executionId: string, expectedVersion: number, next: ExecutionJournalReceipt): CompareAndSwapResult {
    const current = this.records.get(executionId);
    if (!current) return { ok: false, code: 'NOT_FOUND' };
    if (current.version !== expectedVersion) return { ok: false, code: 'STALE_CAS', receipt: clone(current) };
    const keyOwner = this.keys.get(next.idempotencyKey);
    if (keyOwner && keyOwner !== executionId) return { ok: false, code: 'IDEMPOTENCY_CONFLICT', receipt: clone(current) };
    this.records.set(executionId, clone(next));
    this.keys.set(next.idempotencyKey, executionId);
    return { ok: true, receipt: clone(next) };
  }
}

export type PrepareExecutionResult =
  | { ok: true; workspaceAfter: WorkspaceRevision; affectedObjects: readonly AffectedObject[]; artifacts: readonly ExternalArtifactBinding[]; persistenceReceipt?: unknown; verificationReceipt?: unknown }
  | { ok: false; reason: string };

export type CommitWorkspaceResult =
  | { ok: true; workspaceAfter: WorkspaceRevision }
  | { ok: false; reason: string; uncertain: boolean };

export type ExecutionContext = {
  executionId: string;
  commandHash: string;
  workspaceBefore: WorkspaceRevision;
  ownerId: string;
};

export type CrashRecoveryDecision =
  | { decision: 'NO_ACTION'; receipt: ExecutionJournalReceipt }
  | { decision: 'WAIT_FOR_LEASE'; receipt: ExecutionJournalReceipt; lease: ExecutionLease }
  | { decision: 'TAKEOVER_REQUIRED'; receipt: ExecutionJournalReceipt }
  | { decision: 'HOLD_VERIFIED_UNKNOWN'; receipt: ExecutionJournalReceipt };

export type JournalClock = () => string;

export class DurableExecutionJournal {
  private readonly store: ExecutionJournalStore;
  private readonly clock: JournalClock;
  private sequence = 0;

  constructor(store: ExecutionJournalStore = new InMemoryExecutionJournalStore(), clock: JournalClock = () => new Date().toISOString()) {
    this.store = store;
    this.clock = clock;
  }

  get(executionId: string): ExecutionJournalReceipt | null { return this.store.get(executionId); }

  plan(input: PlanExecutionInput): JournalResult {
    try { assertInput(input); } catch (error) { return failure('INVALID_INPUT', String(error instanceof Error ? error.message : error)); }
    const commandHash = hashCommand(input.command);
    const workspaceBindingHash = hashWorkspaceBinding(input.workspace);
    const existing = this.store.getByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      if (existing.commandHash !== commandHash || existing.workspaceBindingHash !== workspaceBindingHash) return failure('IDEMPOTENCY_CONFLICT', 'Idempotency key is already bound to a different command or workspace.', existing);
      return success(existing, true);
    }
    const now = this.clock();
    const executionId = `exec-${sha256(`${input.idempotencyKey}:${commandHash}:${this.sequence++}`).slice(0, 24)}`;
    const initial: ExecutionJournalReceipt = {
      schema: EXECUTION_JOURNAL_SCHEMA,
      executionId,
      idempotencyKey: input.idempotencyKey,
      lifecycle: 'PLANNED',
      version: 0,
      createdAt: now,
      updatedAt: now,
      command: clone(input.command),
      commandHash,
      workspaceBinding: clone(input.workspace),
      workspaceBindingHash,
      workspace: { before: clone(input.workspace) },
      affectedObjects: [],
      artifacts: [],
      events: [],
      headHash: ZERO_HASH,
      receiptHash: ZERO_HASH,
    };
    const planned = appendEvent(initial, 'PLANNED', now, { commandHash, workspaceBindingHash });
    const created = this.store.create(planned);
    if (!created.ok) {
      const raced = this.store.getByIdempotencyKey(input.idempotencyKey);
      if (raced && raced.commandHash === commandHash && raced.workspaceBindingHash === workspaceBindingHash) return success(raced, true);
      return failure(created.code, 'Could not create an idempotent execution journal record.', created.receipt);
    }
    return success(created.receipt);
  }

  approve(executionId: string, approval: UserApproval, expectedVersion?: number): JournalResult {
    const current = this.store.get(executionId);
    if (!current) return failure('NOT_FOUND', 'Execution does not exist.');
    if (current.lifecycle !== 'PLANNED') return failure('INVALID_TRANSITION', `Cannot approve from ${current.lifecycle}.`, current);
    try { assertApproval(approval, current.commandHash, current.workspaceBindingHash); } catch { return failure('APPROVAL_INVALID', 'Approval is not explicitly bound to this command and workspace.', current); }
    const next = appendEvent({ ...current, lifecycle: 'APPROVED', approval: clone(approval), approvalHash: hashApproval(approval) }, 'APPROVED', this.clock(), { approvalHash: hashApproval(approval), actorId: approval.actorId });
    return this.cas(current, next, expectedVersion);
  }

  begin(executionId: string, ownerId: string, leaseMs = 30_000, expectedVersion?: number): JournalResult {
    const current = this.store.get(executionId);
    if (!current) return failure('NOT_FOUND', 'Execution does not exist.');
    if (!validId(ownerId) || !Number.isSafeInteger(leaseMs) || leaseMs <= 0 || leaseMs > 86_400_000) return failure('INVALID_INPUT', 'Invalid lease owner or duration.', current);
    const now = this.clock();
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) return failure('INVALID_INPUT', 'Clock must return an ISO timestamp.', current);
    if (current.lifecycle === 'EXECUTING' && current.lease) {
      const expiry = Date.parse(current.lease.expiresAt);
      if (current.lease.ownerId !== ownerId && expiry > nowMs) return failure('LEASE_HELD', 'Execution lease is held by another owner.', current);
      if (current.lease.ownerId === ownerId && expiry > nowMs) return success(current, true);
      if (expiry <= nowMs) {
        const lease = { ownerId, acquiredAt: now, expiresAt: new Date(nowMs + leaseMs).toISOString() };
        const next = appendEvent({ ...current, lease }, 'LEASE_TAKEN_OVER', now, { previousOwnerId: current.lease.ownerId, ownerId });
        return this.cas(current, next, expectedVersion);
      }
    }
    if (current.lifecycle !== 'APPROVED') return failure('INVALID_TRANSITION', `Cannot begin from ${current.lifecycle}.`, current);
    if (!current.approval?.approved) return failure('APPROVAL_REQUIRED', 'Explicit user approval is required before execution.', current);
    const lease = { ownerId, acquiredAt: now, expiresAt: new Date(nowMs + leaseMs).toISOString() };
    const next = appendEvent({ ...current, lifecycle: 'EXECUTING', lease }, 'LEASE_ACQUIRED', now, { ownerId, expiresAt: lease.expiresAt });
    return this.cas(current, next, expectedVersion);
  }

  async execute(input: {
    executionId: string;
    ownerId: string;
    leaseMs?: number;
    prepare: (context: ExecutionContext) => Promise<PrepareExecutionResult> | PrepareExecutionResult;
    commitWorkspace: (candidate: WorkspaceRevision, context: ExecutionContext) => Promise<CommitWorkspaceResult> | CommitWorkspaceResult;
  }): Promise<JournalResult> {
    const began = this.begin(input.executionId, input.ownerId, input.leaseMs);
    if (!began.ok) return began;
    const running = began.receipt;
    const context: ExecutionContext = { executionId: running.executionId, commandHash: running.commandHash, workspaceBefore: clone(running.workspace.before), ownerId: input.ownerId };
    let prepared: PrepareExecutionResult;
    try { prepared = await input.prepare(context); } catch (error) { return this.failRunning(running, input.ownerId, `prepare_failed:${String(error instanceof Error ? error.message : error)}`); }
    if (!prepared.ok) return this.failRunning(running, input.ownerId, prepared.reason);
    try {
      assertWorkspaceAfter(running.workspace.before, prepared.workspaceAfter);
      validateObjects(prepared.affectedObjects);
      validateArtifacts(prepared.artifacts);
    } catch (error) { return this.failRunning(running, input.ownerId, String(error instanceof Error ? error.message : error)); }
    const leaseBeforeCommit = this.store.get(running.executionId);
    if (!leaseBeforeCommit || leaseBeforeCommit.lifecycle !== 'EXECUTING' || leaseBeforeCommit.lease?.ownerId !== input.ownerId) return failure('LEASE_OWNER_MISMATCH', 'Execution lease is no longer owned by this worker.', leaseBeforeCommit ?? running);
    if (Date.parse(leaseBeforeCommit.lease.expiresAt) <= Date.parse(this.clock())) return failure('LEASE_EXPIRED', 'Execution lease expired before workspace commit; no commit was attempted.', leaseBeforeCommit);
    let committed: CommitWorkspaceResult;
    try { committed = await input.commitWorkspace(clone(prepared.workspaceAfter), context); } catch (error) {
      return this.markUnknown(running, input.ownerId, `commit_callback_threw:${String(error instanceof Error ? error.message : error)}`);
    }
    if (!committed.ok) return committed.uncertain ? this.markUnknown(running, input.ownerId, committed.reason) : this.failRunning(running, input.ownerId, committed.reason);
    if (canonicalJson(committed.workspaceAfter) !== canonicalJson(prepared.workspaceAfter)) return this.markUnknown(running, input.ownerId, 'workspace_commit_receipt_mismatch');
    const current = this.store.get(running.executionId);
    if (!current || current.lifecycle !== 'EXECUTING' || current.lease?.ownerId !== input.ownerId) return this.markUnknown(running, input.ownerId, 'lease_or_receipt_changed_after_workspace_commit');
    let persistenceReceiptHash: string | undefined;
    let verificationReceiptHash: string | undefined;
    try {
      persistenceReceiptHash = prepared.persistenceReceipt === undefined ? undefined : hashBoundReceipt(prepared.persistenceReceipt);
      verificationReceiptHash = prepared.verificationReceipt === undefined ? undefined : hashBoundReceipt(prepared.verificationReceipt);
    } catch { return this.markUnknown(running, input.ownerId, 'receipt_hash_generation_failed'); }
    const next = appendEvent({ ...current, lifecycle: 'COMMITTED', workspace: { ...current.workspace, after: clone(committed.workspaceAfter) }, affectedObjects: clone(prepared.affectedObjects), artifacts: clone(prepared.artifacts), persistenceReceiptHash, verificationReceiptHash, lease: undefined }, 'COMMITTED', this.clock(), { revision: committed.workspaceAfter.revision, contentHash: committed.workspaceAfter.contentHash, persistenceReceiptHash, verificationReceiptHash });
    const result = this.cas(current, next);
    return result.ok ? result : this.markUnknown(current, input.ownerId, 'commit_receipt_cas_failed');
  }

  rollback(input: { executionId: string; approval: RollbackApproval; failureReason: string; workspaceAfter: WorkspaceRevision; expectedVersion?: number }): JournalResult {
    const current = this.store.get(input.executionId);
    if (!current) return failure('NOT_FOUND', 'Execution does not exist.');
    if (current.lifecycle !== 'COMMITTED' && current.lifecycle !== 'VERIFIED_UNKNOWN') return failure('ROLLBACK_INVALID', `Cannot roll back from ${current.lifecycle}.`, current);
    if (!validId(input.failureReason)) return failure('ROLLBACK_INVALID', 'Rollback failure reason is required.', current);
    try {
      assertWorkspaceAfter(current.workspace.after ?? current.workspace.before, input.workspaceAfter);
      assertRollbackApproval({
        approval: input.approval,
        executionId: current.executionId,
        originalReceiptHash: current.receiptHash,
        failureReason: input.failureReason,
        workspaceAfter: input.workspaceAfter,
      });
    } catch (error) { return failure('ROLLBACK_INVALID', String(error instanceof Error ? error.message : error), current); }
    const originalReceiptHash = current.receiptHash;
    const baseRollback = { originalExecutionId: current.executionId, originalReceiptHash, failureReason: input.failureReason, approvedBy: input.approval.actorId, approvalHash: hashRollbackApproval(input.approval), workspaceAfter: clone(input.workspaceAfter), rollbackReceiptHash: '' };
    const rollbackReceiptHash = sha256(canonicalJson({ schema: EXECUTION_JOURNAL_SCHEMA, purpose: 'rollback-receipt', ...baseRollback }));
    const rollbackReceipt: RollbackReceipt = { ...baseRollback, rollbackReceiptHash };
    const next = appendEvent({ ...current, lifecycle: 'ROLLED_BACK', rollback: rollbackReceipt, workspace: { ...current.workspace, after: clone(input.workspaceAfter) }, holdReason: undefined }, 'ROLLED_BACK', this.clock(), { originalExecutionId: current.executionId, originalReceiptHash, failureReason: input.failureReason, rollbackReceiptHash });
    return this.cas(current, next, input.expectedVersion);
  }

  recover(executionId: string): CrashRecoveryDecision | JournalFailure {
    const current = this.store.get(executionId);
    if (!current) return failure('NOT_FOUND', 'Execution does not exist.');
    if (current.lifecycle === 'VERIFIED_UNKNOWN') return { decision: 'HOLD_VERIFIED_UNKNOWN', receipt: current };
    if (current.lifecycle !== 'EXECUTING') return { decision: 'NO_ACTION', receipt: current };
    if (!current.lease) return { decision: 'TAKEOVER_REQUIRED', receipt: current };
    if (Date.parse(current.lease.expiresAt) <= Date.parse(this.clock())) return { decision: 'TAKEOVER_REQUIRED', receipt: current };
    return { decision: 'WAIT_FOR_LEASE', receipt: current, lease: current.lease };
  }

  private cas(current: ExecutionJournalReceipt, next: ExecutionJournalReceipt, expectedVersion?: number): JournalResult {
    const result = this.store.compareAndSwap(current.executionId, expectedVersion ?? current.version, next);
    if (!result.ok) return failure(result.code, result.code === 'STALE_CAS' ? 'Execution changed; retry with the latest receipt.' : 'Execution journal CAS failed.', result.receipt ?? current);
    return success(result.receipt);
  }

  private failRunning(current: ExecutionJournalReceipt, ownerId: string, reason: string): JournalResult {
    const latest = this.store.get(current.executionId) ?? current;
    if (latest.lifecycle !== 'EXECUTING' || latest.lease?.ownerId !== ownerId) return failure('LEASE_OWNER_MISMATCH', 'Execution lease is no longer owned by this worker.', latest);
    const next = appendEvent({ ...latest, lifecycle: 'FAILED', failureReason: reason, lease: undefined }, 'FAILED', this.clock(), { reason });
    const result = this.cas(latest, next);
    return result.ok ? failure('EXECUTION_FAILED', reason, result.receipt) : { ...result, code: 'EXECUTION_FAILED' };
  }

  private markUnknown(current: ExecutionJournalReceipt, ownerId: string, reason: string): JournalResult {
    const latest = this.store.get(current.executionId) ?? current;
    if (latest.lifecycle !== 'EXECUTING' || latest.lease?.ownerId !== ownerId) return failure('COMMIT_RECEIPT_UNCERTAIN', `VERIFIED_UNKNOWN/HOLD: ${reason}`, latest);
    const next = appendEvent({ ...latest, lifecycle: 'VERIFIED_UNKNOWN', holdReason: reason, lease: undefined }, 'VERIFIED_UNKNOWN', this.clock(), { reason, hold: true });
    const result = this.cas(latest, next);
    return result.ok ? failure('COMMIT_RECEIPT_UNCERTAIN', `VERIFIED_UNKNOWN/HOLD: ${reason}`, result.receipt) : failure('COMMIT_RECEIPT_UNCERTAIN', `VERIFIED_UNKNOWN/HOLD: ${reason}`, result.receipt ?? latest);
  }
}

export function verifyExecutionJournalChain(receipt: ExecutionJournalReceipt): boolean {
  if (receipt.schema !== EXECUTION_JOURNAL_SCHEMA || !receipt.events.length) return false;
  let previous = ZERO_HASH;
  for (let index = 0; index < receipt.events.length; index += 1) {
    const event = receipt.events[index];
    if (event.sequence !== index || event.previousHash !== previous || event.hash !== eventHash({ sequence: event.sequence, type: event.type, at: event.at, data: event.data, previousHash: event.previousHash })) return false;
    previous = event.hash;
  }
  return receipt.headHash === previous && receipt.receiptHash === hashReceipt(receipt);
}
