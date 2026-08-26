import { createHash, randomUUID } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import {
  applyCanonicalCadCommandV2,
  canonicalCadConsumerDraftJson,
  hashCanonicalCadCommandV2,
  hashCanonicalCadDocumentV2,
  validateCanonicalCadCommandV2,
  validateCanonicalCadDocumentV2,
  type CanonicalCadCommandV2ConsumerDraft,
  type CanonicalCadDocumentV2ConsumerDraft,
  type CanonicalCadExecutionContext,
  type CanonicalCadRevisionRef,
} from './canonicalCadV2ConsumerDraft';

export const CANONICAL_CAD_REVISION_MIGRATION_VERSION = 2026082401;
export const CANONICAL_CAD_REVISION_RECEIPT_SCHEMA =
  'nexyfab.precision-cad.server-canonical-revision-receipt.v1' as const;

export const CANONICAL_CAD_DERIVED_INVALIDATIONS = [
  'exact_geometry',
  'native_document',
  'analysis',
  'drawing',
  'quantity',
  'exchange',
  'qualification',
] as const;

export type CanonicalCadDerivedInvalidation = typeof CANONICAL_CAD_DERIVED_INVALIDATIONS[number];

export interface CanonicalCadRevisionReceipt {
  schema: typeof CANONICAL_CAD_REVISION_RECEIPT_SCHEMA;
  authority: 'SERVER_CANONICAL_DRAFT_REVISION';
  projectId: string;
  documentId: string;
  revision: CanonicalCadRevisionRef;
  parentRevision: CanonicalCadRevisionRef;
  commandId: string;
  commandSha256: string;
  idempotencyKey: string;
  actorId: string;
  compensationForCommandId: string | null;
  changedObjectIds: string[];
  changedRelationshipIds: string[];
  invalidated: CanonicalCadDerivedInvalidation[];
  verification: 'NOT_RUN';
  release: 'HOLD';
  createdAt: string;
  receiptSha256: string;
}

export interface CanonicalCadRevisionHead {
  projectId: string;
  documentId: string;
  revision: CanonicalCadRevisionRef;
  document: CanonicalCadDocumentV2ConsumerDraft;
}

export interface CanonicalCadRevisionInvalidationEvent {
  projectId: string;
  documentId: string;
  revision: CanonicalCadRevisionRef;
  parentRevision: CanonicalCadRevisionRef;
  commandId: string;
  commandSha256: string;
  invalidated: readonly CanonicalCadDerivedInvalidation[];
  at: string;
}

export interface CanonicalCadRevisionAuditEvent extends CanonicalCadRevisionInvalidationEvent {
  action: 'cad.canonical_v2_revision_commit';
  actorId: string;
  idempotencyKey: string;
  receiptSha256: string;
  compensationForCommandId: string | null;
  changedObjectIds: readonly string[];
  changedRelationshipIds: readonly string[];
}

/** Hooks must only use the supplied transaction adapter. Throwing aborts the commit. */
export interface CanonicalCadRevisionTransactionHooks {
  invalidateDerived(tx: DbAdapter, event: CanonicalCadRevisionInvalidationEvent): Promise<void>;
  appendAudit(tx: DbAdapter, event: CanonicalCadRevisionAuditEvent): Promise<void>;
}

export interface CommitCanonicalCadRevisionInput {
  projectId: string;
  documentId: string;
  authenticatedActorId: string;
  command: CanonicalCadCommandV2ConsumerDraft;
  execution: CanonicalCadExecutionContext;
  hooks: CanonicalCadRevisionTransactionHooks;
}

export type CommitCanonicalCadRevisionResult =
  | {
      ok: true;
      replayed: boolean;
      receipt: CanonicalCadRevisionReceipt;
      document: CanonicalCadDocumentV2ConsumerDraft;
    }
  | { ok: false; code: 'MIGRATION_REQUIRED'; issues: string[] }
  | { ok: false; code: 'INVALID_REQUEST' | 'HOLD' | 'IDEMPOTENCY_CONFLICT' | 'INVALID_COMMAND'; issues: string[] }
  | { ok: false; code: 'REVISION_CONFLICT'; currentRevision: CanonicalCadRevisionRef | null; issues: string[] }
  | { ok: false; code: 'CORRUPT_SERVER_STATE'; issues: string[] };

type HeadRow = {
  project_id: string;
  document_id: string;
  revision_id: string;
  sequence: number;
  content_hash: string;
};

type RevisionRow = {
  id: string;
  project_id: string;
  document_id: string;
  revision_id: string;
  sequence: number;
  content_hash: string;
  parent_revision_id: string | null;
  parent_sequence: number | null;
  parent_content_hash: string | null;
  document_json: string;
  command_id: string | null;
  command_sha256: string | null;
  idempotency_key: string | null;
  command_json: string | null;
  compensation_for_command_id: string | null;
  receipt_json: string | null;
  receipt_sha256: string | null;
  created_by: string;
  created_at: number;
};

class MigrationRequiredError extends Error {
  readonly code = 'MIGRATION_REQUIRED';
}

class HeadCompareAndSwapError extends Error {
  readonly code = 'HEAD_COMPARE_AND_SWAP_FAILED';
}

class RevisionWriteInvariantError extends Error {
  readonly code = 'REVISION_WRITE_INVARIANT_FAILED';
}

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_SERVER_COMMAND_DEPENDENCIES = 256;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function receiptHash(receipt: Omit<CanonicalCadRevisionReceipt, 'receiptSha256'>): string {
  return sha256(canonicalCadConsumerDraftJson(receipt));
}

export function hashCanonicalCadRevisionReceipt(receipt: CanonicalCadRevisionReceipt): string {
  const { receiptSha256: _receiptSha256, ...unsigned } = receipt;
  void _receiptSha256;
  return receiptHash(unsigned);
}

function sameRevision(left: CanonicalCadRevisionRef, right: CanonicalCadRevisionRef): boolean {
  return left.revisionId === right.revisionId
    && left.sequence === right.sequence
    && left.contentSha256 === right.contentSha256;
}

function revisionFromHead(row: HeadRow): CanonicalCadRevisionRef {
  return {
    revisionId: String(row.revision_id),
    sequence: Number(row.sequence),
    contentSha256: String(row.content_hash),
  };
}

function isMigrationRequired(error: unknown): error is MigrationRequiredError {
  return error instanceof MigrationRequiredError;
}

/** Production migration is integration-owned. This function performs read-only checks only. */
export async function assertCanonicalCadRevisionMigration(db: DbAdapter): Promise<void> {
  try {
    const row = await db.queryOne<{ version: number; checksum?: string }>(
      'SELECT version, checksum FROM nf_schema_migrations WHERE version = ?',
      CANONICAL_CAD_REVISION_MIGRATION_VERSION,
    );
    const expectedChecksum = process.env.CANONICAL_CAD_REVISION_MIGRATION_CHECKSUM?.trim();
    const checksumRequired = process.env.NODE_ENV === 'production'
      || process.env.NEXYFAB_COMMERCIAL_MODE === '1'
      || process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE === '1';
    if (!row || Number(row.version) !== CANONICAL_CAD_REVISION_MIGRATION_VERSION
      || !SHA256.test(row.checksum ?? '')
      || (checksumRequired && !expectedChecksum)
      || (expectedChecksum && row.checksum !== expectedChecksum)) {
      throw new MigrationRequiredError('canonical_cad_revision_migration_required');
    }
    // A migration receipt without its tables is not readiness. These are
    // deliberately read-only probes and succeed for empty migrated tables.
    await db.queryOne('SELECT project_id FROM nf_cad_canonical_v2_heads LIMIT 1');
    await db.queryOne('SELECT project_id FROM nf_cad_canonical_v2_revisions LIMIT 1');
    await db.queryOne('SELECT project_id FROM nf_cad_canonical_v2_invalidations LIMIT 1');
    await db.queryOne('SELECT project_id FROM nf_cad_canonical_v2_locks LIMIT 1');
    await db.queryOne('SELECT project_id FROM nf_cad_canonical_v2_audit LIMIT 1');
  } catch (error) {
    if (isMigrationRequired(error)) throw error;
    throw new MigrationRequiredError('canonical_cad_revision_migration_required');
  }
}

function parseDocumentRow(row: RevisionRow): CanonicalCadDocumentV2ConsumerDraft | null {
  try {
    const document = JSON.parse(row.document_json) as CanonicalCadDocumentV2ConsumerDraft;
    if (validateCanonicalCadDocumentV2(document).length) return null;
    if (hashCanonicalCadDocumentV2(document) !== document.revision.contentSha256) return null;
    if (document.projectId !== row.project_id || document.documentId !== row.document_id) return null;
    if (document.revision.revisionId !== row.revision_id
      || document.revision.sequence !== Number(row.sequence)
      || document.revision.contentSha256 !== row.content_hash) return null;
    return document;
  } catch {
    return null;
  }
}

function parseReceiptRow(row: RevisionRow): CanonicalCadRevisionReceipt | null {
  if (!row.command_id || !row.command_sha256 || !row.idempotency_key
    || !row.command_json || !row.receipt_json || !row.receipt_sha256) return null;
  try {
    const command = JSON.parse(row.command_json) as CanonicalCadCommandV2ConsumerDraft;
    if (validateCanonicalCadCommandV2(command).length
      || hashCanonicalCadCommandV2(command) !== row.command_sha256
      || command.projectId !== row.project_id || command.documentId !== row.document_id
      || command.commandId !== row.command_id || command.idempotencyKey !== row.idempotency_key
      || command.nextRevisionId !== row.revision_id) return null;
    const receipt = JSON.parse(row.receipt_json) as CanonicalCadRevisionReceipt;
    if (receipt.schema !== CANONICAL_CAD_REVISION_RECEIPT_SCHEMA
      || receipt.authority !== 'SERVER_CANONICAL_DRAFT_REVISION'
      || receipt.projectId !== row.project_id || receipt.documentId !== row.document_id
      || receipt.commandId !== row.command_id || receipt.commandSha256 !== row.command_sha256
      || receipt.idempotencyKey !== row.idempotency_key
      || receipt.actorId !== command.actor.actorId || receipt.actorId !== row.created_by
      || receipt.compensationForCommandId !== command.compensationForCommandId
      || row.compensation_for_command_id !== command.compensationForCommandId
      || receipt.receiptSha256 !== row.receipt_sha256
      || hashCanonicalCadRevisionReceipt(receipt) !== row.receipt_sha256
      || receipt.revision.revisionId !== row.revision_id
      || receipt.revision.sequence !== Number(row.sequence)
      || receipt.revision.contentSha256 !== row.content_hash
      || !row.parent_revision_id || row.parent_sequence === null || !row.parent_content_hash
      || receipt.parentRevision.revisionId !== row.parent_revision_id
      || receipt.parentRevision.sequence !== Number(row.parent_sequence)
      || receipt.parentRevision.contentSha256 !== row.parent_content_hash
      || !sameRevision(receipt.parentRevision, command.baseRevision)
      || Date.parse(receipt.createdAt) !== Number(row.created_at)
      || receipt.verification !== 'NOT_RUN' || receipt.release !== 'HOLD'
      || canonicalCadConsumerDraftJson(receipt.invalidated) !== canonicalCadConsumerDraftJson(CANONICAL_CAD_DERIVED_INVALIDATIONS)) return null;
    return receipt;
  } catch {
    return null;
  }
}

async function revisionRowForHead(db: DbAdapter, head: HeadRow): Promise<RevisionRow | undefined> {
  return db.queryOne<RevisionRow>(
    `SELECT id, project_id, document_id, revision_id, sequence, content_hash,
            parent_revision_id, parent_sequence, parent_content_hash, document_json,
            command_id, command_sha256, idempotency_key, command_json,
            compensation_for_command_id, receipt_json, receipt_sha256, created_by, created_at
       FROM nf_cad_canonical_v2_revisions
      WHERE project_id = ? AND document_id = ? AND revision_id = ? AND sequence = ? AND content_hash = ?`,
    head.project_id, head.document_id, head.revision_id, Number(head.sequence), head.content_hash,
  );
}

async function loadHead(db: DbAdapter, projectId: string, documentId: string): Promise<
  | { ok: true; head: CanonicalCadRevisionHead; row: RevisionRow }
  | { ok: false; code: 'NOT_FOUND' | 'CORRUPT_SERVER_STATE'; issues: string[] }
> {
  const row = await db.queryOne<HeadRow>(
    'SELECT project_id, document_id, revision_id, sequence, content_hash FROM nf_cad_canonical_v2_heads WHERE project_id = ? AND document_id = ?',
    projectId, documentId,
  );
  if (!row) return { ok: false, code: 'NOT_FOUND', issues: ['canonical_head_not_found'] };
  const revisionRow = await revisionRowForHead(db, row);
  if (!revisionRow) return { ok: false, code: 'CORRUPT_SERVER_STATE', issues: ['canonical_head_revision_missing'] };
  const document = parseDocumentRow(revisionRow);
  if (!document || !sameRevision(document.revision, revisionFromHead(row))) {
    return { ok: false, code: 'CORRUPT_SERVER_STATE', issues: ['canonical_head_revision_corrupt'] };
  }
  return { ok: true, head: { projectId, documentId, revision: document.revision, document }, row: revisionRow };
}

export async function readCanonicalCadRevisionHead(
  db: DbAdapter,
  projectId: string,
  documentId: string,
): Promise<
  | { ok: true; head: CanonicalCadRevisionHead }
  | { ok: false; code: 'MIGRATION_REQUIRED' | 'NOT_FOUND' | 'CORRUPT_SERVER_STATE'; issues: string[] }
> {
  try {
    await assertCanonicalCadRevisionMigration(db);
  } catch (error) {
    if (isMigrationRequired(error)) return { ok: false, code: 'MIGRATION_REQUIRED', issues: [error.message] };
    throw error;
  }
  const result = await loadHead(db, projectId, documentId);
  return result.ok ? { ok: true, head: result.head } : result;
}

async function findIdempotencyRow(
  db: DbAdapter,
  projectId: string,
  documentId: string,
  idempotencyKey: string,
): Promise<RevisionRow | undefined> {
  return db.queryOne<RevisionRow>(
    `SELECT id, project_id, document_id, revision_id, sequence, content_hash,
            parent_revision_id, parent_sequence, parent_content_hash, document_json,
            command_id, command_sha256, idempotency_key, command_json,
            compensation_for_command_id, receipt_json, receipt_sha256, created_by, created_at
       FROM nf_cad_canonical_v2_revisions
      WHERE project_id = ? AND document_id = ? AND idempotency_key = ?`,
    projectId, documentId, idempotencyKey,
  );
}

function exactReplay(
  row: RevisionRow,
  command: CanonicalCadCommandV2ConsumerDraft,
): CommitCanonicalCadRevisionResult {
  const document = parseDocumentRow(row);
  const receipt = parseReceiptRow(row);
  if (!document || !receipt) return { ok: false, code: 'CORRUPT_SERVER_STATE', issues: ['idempotency_receipt_corrupt'] };
  let sameCommand = false;
  try {
    sameCommand = row.command_sha256 === command.commandSha256
      && canonicalCadConsumerDraftJson(JSON.parse(row.command_json!)) === canonicalCadConsumerDraftJson(command);
  } catch {
    return { ok: false, code: 'CORRUPT_SERVER_STATE', issues: ['idempotency_command_corrupt'] };
  }
  if (!sameCommand) return { ok: false, code: 'IDEMPOTENCY_CONFLICT', issues: ['idempotency_key_payload_conflict'] };
  return { ok: true, replayed: true, receipt, document };
}

async function validateCommandLineage(
  db: DbAdapter,
  command: CanonicalCadCommandV2ConsumerDraft,
): Promise<string[]> {
  const issues: string[] = [];
  if (command.dependencies.length > MAX_SERVER_COMMAND_DEPENDENCIES) {
    return ['command_dependency_limit_exceeded'];
  }
  for (const dependency of command.dependencies) {
    const row = await db.queryOne<{ sequence: number; command_sha256: string | null }>(
      'SELECT sequence, command_sha256 FROM nf_cad_canonical_v2_revisions WHERE project_id = ? AND document_id = ? AND command_id = ?',
      command.projectId, command.documentId, dependency,
    );
    if (!row || !row.command_sha256 || Number(row.sequence) > command.baseRevision.sequence) issues.push(`command_dependency_missing:${dependency}`);
  }
  if (command.compensationForCommandId) {
    const target = await db.queryOne<{ sequence: number; command_sha256: string | null }>(
      'SELECT sequence, command_sha256 FROM nf_cad_canonical_v2_revisions WHERE project_id = ? AND document_id = ? AND command_id = ?',
      command.projectId, command.documentId, command.compensationForCommandId,
    );
    if (!target || !target.command_sha256 || Number(target.sequence) > command.baseRevision.sequence) issues.push('compensation_target_missing');
    const existing = await db.queryOne<{ command_id: string }>(
      'SELECT command_id FROM nf_cad_canonical_v2_revisions WHERE project_id = ? AND document_id = ? AND compensation_for_command_id = ?',
      command.projectId, command.documentId, command.compensationForCommandId,
    );
    if (existing) issues.push('compensation_already_committed');
  }
  return issues;
}

function makeReceipt(input: {
  command: CanonicalCadCommandV2ConsumerDraft;
  document: CanonicalCadDocumentV2ConsumerDraft;
  changedObjectIds: string[];
  changedRelationshipIds: string[];
  createdAt: string;
}): CanonicalCadRevisionReceipt {
  const unsigned: Omit<CanonicalCadRevisionReceipt, 'receiptSha256'> = {
    schema: CANONICAL_CAD_REVISION_RECEIPT_SCHEMA,
    authority: 'SERVER_CANONICAL_DRAFT_REVISION',
    projectId: input.command.projectId,
    documentId: input.command.documentId,
    revision: structuredClone(input.document.revision),
    parentRevision: structuredClone(input.command.baseRevision),
    commandId: input.command.commandId,
    commandSha256: input.command.commandSha256,
    idempotencyKey: input.command.idempotencyKey,
    actorId: input.command.actor.actorId,
    compensationForCommandId: input.command.compensationForCommandId,
    changedObjectIds: [...input.changedObjectIds],
    changedRelationshipIds: [...input.changedRelationshipIds],
    invalidated: [...CANONICAL_CAD_DERIVED_INVALIDATIONS],
    verification: 'NOT_RUN',
    release: 'HOLD',
    createdAt: input.createdAt,
  };
  return { ...unsigned, receiptSha256: receiptHash(unsigned) };
}

async function currentRevisionAfterFailure(
  db: DbAdapter,
  projectId: string,
  documentId: string,
): Promise<CanonicalCadRevisionRef | null> {
  try {
    const row = await db.queryOne<HeadRow>(
      'SELECT project_id, document_id, revision_id, sequence, content_hash FROM nf_cad_canonical_v2_heads WHERE project_id = ? AND document_id = ?',
      projectId, documentId,
    );
    return row ? revisionFromHead(row) : null;
  } catch {
    return null;
  }
}

export async function commitCanonicalCadRevision(
  db: DbAdapter,
  input: CommitCanonicalCadRevisionInput,
): Promise<CommitCanonicalCadRevisionResult> {
  try {
    await assertCanonicalCadRevisionMigration(db);
  } catch (error) {
    if (isMigrationRequired(error)) return { ok: false, code: 'MIGRATION_REQUIRED', issues: [error.message] };
    throw error;
  }

  const commandIssues = validateCanonicalCadCommandV2(input?.command);
  if (!input || typeof input.projectId !== 'string' || typeof input.documentId !== 'string'
    || typeof input.authenticatedActorId !== 'string' || !input.projectId.trim()
    || !input.documentId.trim() || !input.authenticatedActorId.trim()
    || input.command?.projectId !== input.projectId || input.command?.documentId !== input.documentId) {
    commandIssues.push('request_command_identity_mismatch');
  }
  if (!input?.hooks || typeof input.hooks.invalidateDerived !== 'function' || typeof input.hooks.appendAudit !== 'function') {
    commandIssues.push('transaction_hooks_required');
  }
  if (commandIssues.length) return { ok: false, code: 'INVALID_REQUEST', issues: [...new Set(commandIssues)] };
  if (input.command.actor.kind !== 'human') return { ok: false, code: 'HOLD', issues: ['non_human_actor_hold'] };
  if (input.command.actor.actorId !== input.authenticatedActorId) {
    return { ok: false, code: 'INVALID_REQUEST', issues: ['authenticated_actor_mismatch'] };
  }

  try {
    return await db.transaction(async tx => {
      const prior = await findIdempotencyRow(tx, input.projectId, input.documentId, input.command.idempotencyKey);
      if (prior) return exactReplay(prior, input.command);

      const sameCommandId = await tx.queryOne<{ command_sha256: string | null }>(
        'SELECT command_sha256 FROM nf_cad_canonical_v2_revisions WHERE project_id = ? AND document_id = ? AND command_id = ?',
        input.projectId, input.documentId, input.command.commandId,
      );
      if (sameCommandId) return { ok: false, code: 'IDEMPOTENCY_CONFLICT', issues: ['command_id_already_used'] } as const;

      const current = await loadHead(tx, input.projectId, input.documentId);
      if (!current.ok) {
        if (current.code === 'CORRUPT_SERVER_STATE') {
          return { ok: false, code: 'CORRUPT_SERVER_STATE', issues: current.issues } as const;
        }
        return { ok: false, code: 'REVISION_CONFLICT', currentRevision: null, issues: current.issues } as const;
      }
      if (!sameRevision(current.head.revision, input.command.baseRevision)) {
        return { ok: false, code: 'REVISION_CONFLICT', currentRevision: current.head.revision, issues: ['stale_base_revision'] } as const;
      }

      const lineageIssues = await validateCommandLineage(tx, input.command);
      if (lineageIssues.length) return { ok: false, code: 'INVALID_COMMAND', issues: lineageIssues } as const;

      const reduction = applyCanonicalCadCommandV2(current.head.document, input.command, input.execution);
      if (!reduction.committed) return { ok: false, code: 'INVALID_COMMAND', issues: reduction.issues } as const;
      const createdAt = input.execution.evaluatedAt;
      const receipt = makeReceipt({
        command: input.command,
        document: reduction.document,
        changedObjectIds: reduction.changedObjectIds,
        changedRelationshipIds: reduction.changedRelationshipIds,
        createdAt,
      });

      const inserted = await tx.execute(
        `INSERT INTO nf_cad_canonical_v2_revisions
          (id, project_id, document_id, revision_id, sequence, content_hash,
           parent_revision_id, parent_sequence, parent_content_hash, document_json,
           command_id, command_sha256, idempotency_key, command_json,
           compensation_for_command_id, receipt_json, receipt_sha256, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(), input.projectId, input.documentId,
        reduction.document.revision.revisionId, reduction.document.revision.sequence, reduction.document.revision.contentSha256,
        current.head.revision.revisionId, current.head.revision.sequence, current.head.revision.contentSha256,
        canonicalCadConsumerDraftJson(reduction.document),
        input.command.commandId, input.command.commandSha256, input.command.idempotencyKey,
        canonicalCadConsumerDraftJson(input.command), input.command.compensationForCommandId,
        canonicalCadConsumerDraftJson(receipt), receipt.receiptSha256, input.authenticatedActorId, Date.parse(createdAt),
      );
      if (inserted.changes !== 1) throw new RevisionWriteInvariantError('canonical_revision_insert_failed');

      const updated = await tx.execute(
        `UPDATE nf_cad_canonical_v2_heads
            SET revision_id = ?, sequence = ?, content_hash = ?, updated_at = ?
          WHERE project_id = ? AND document_id = ?
            AND revision_id = ? AND sequence = ? AND content_hash = ?`,
        reduction.document.revision.revisionId, reduction.document.revision.sequence,
        reduction.document.revision.contentSha256, Date.parse(createdAt), input.projectId, input.documentId,
        current.head.revision.revisionId, current.head.revision.sequence, current.head.revision.contentSha256,
      );
      if (updated.changes !== 1) throw new HeadCompareAndSwapError('canonical_head_compare_and_swap_failed');

      for (const scope of CANONICAL_CAD_DERIVED_INVALIDATIONS) {
        const invalidated = await tx.execute(
          `INSERT INTO nf_cad_canonical_v2_invalidations
            (revision_id, project_id, document_id, scope, reason_code, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          reduction.document.revision.revisionId, input.projectId, input.documentId,
          scope, 'UPSTREAM_CANONICAL_REVISION_CHANGED', Date.parse(createdAt),
        );
        if (invalidated.changes !== 1) throw new RevisionWriteInvariantError(`canonical_invalidation_insert_failed:${scope}`);
      }

      const invalidationEvent: CanonicalCadRevisionInvalidationEvent = {
        projectId: input.projectId,
        documentId: input.documentId,
        revision: structuredClone(reduction.document.revision),
        parentRevision: structuredClone(current.head.revision),
        commandId: input.command.commandId,
        commandSha256: input.command.commandSha256,
        invalidated: [...CANONICAL_CAD_DERIVED_INVALIDATIONS],
        at: createdAt,
      };
      await input.hooks.invalidateDerived(tx, invalidationEvent);
      await input.hooks.appendAudit(tx, {
        ...invalidationEvent,
        action: 'cad.canonical_v2_revision_commit',
        actorId: input.authenticatedActorId,
        idempotencyKey: input.command.idempotencyKey,
        receiptSha256: receipt.receiptSha256,
        compensationForCommandId: input.command.compensationForCommandId,
        changedObjectIds: reduction.changedObjectIds,
        changedRelationshipIds: reduction.changedRelationshipIds,
      });
      return { ok: true, replayed: false, receipt, document: reduction.document } as const;
    });
  } catch (error) {
    // A lost response or uniqueness race may have committed in another
    // transaction. Only an exact durable command is replayable.
    const raced = await findIdempotencyRow(db, input.projectId, input.documentId, input.command.idempotencyKey).catch(() => undefined);
    if (raced) return exactReplay(raced, input.command);
    if (error instanceof HeadCompareAndSwapError) {
      return {
        ok: false,
        code: 'REVISION_CONFLICT',
        currentRevision: await currentRevisionAfterFailure(db, input.projectId, input.documentId),
        issues: [error.message],
      };
    }
    if (error instanceof RevisionWriteInvariantError) {
      return { ok: false, code: 'CORRUPT_SERVER_STATE', issues: [error.message] };
    }
    throw error;
  }
}
