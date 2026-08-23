import { randomUUID } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';

const SHA256 = /^[a-f0-9]{64}$/;
export const ARCHITECTURE_INTERIOR_HISTORY_SCHEMA = 'nexyfab.architecture-interior-history.v1' as const;
export const ARCHITECTURE_INTERIOR_HISTORY_MAX_EVENTS = 1_000;

export type ArchitectureInteriorHistoryOperation = 'apply' | 'undo' | 'redo';
export type ArchitectureInteriorHistoryEvent = {
  id: string;
  sequence: number;
  operation: ArchitectureInteriorHistoryOperation;
  lineageId: string;
  sourceSequence?: number;
  actorUserId: string;
  commandId: string;
  sourceRevision: number;
  sourceContentHash: string;
  targetRevision: number;
  targetContentHash: string;
  createdAt: number;
};

export type ArchitectureInteriorHistoryState = {
  events: ArchitectureInteriorHistoryEvent[];
  undo?: ArchitectureInteriorHistoryEvent;
  redo?: ArchitectureInteriorHistoryEvent;
};

type StoredHistoryEvent = ArchitectureInteriorHistoryEvent & { source_sequence?: number | null };

export async function ensureArchitectureInteriorHistoryTables(db: DbAdapter): Promise<void> {
  await db.executeRaw(`
    CREATE TABLE IF NOT EXISTS nf_architecture_interior_history (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      sequence BIGINT NOT NULL,
      operation TEXT NOT NULL,
      lineage_id TEXT NOT NULL,
      source_sequence BIGINT,
      actor_user_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      source_revision INTEGER NOT NULL,
      source_content_hash TEXT NOT NULL,
      target_revision INTEGER NOT NULL,
      target_content_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      UNIQUE(tenant_id, project_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_nf_architecture_interior_history_project
      ON nf_architecture_interior_history(tenant_id, project_id, sequence ASC);
  `);
}

function validHash(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value); }
function validLedgerIdentifier(value: unknown, maxLength = 256): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}
function validAppendInput(
  scope: { tenantId: string; projectId: string },
  input: Omit<ArchitectureInteriorHistoryEvent, 'id' | 'sequence' | 'createdAt'> & { createdAt?: number },
): boolean {
  const sourceSequenceValid = input.operation === 'apply'
    ? input.sourceSequence === undefined
    : typeof input.sourceSequence === 'number' && Number.isSafeInteger(input.sourceSequence) && input.sourceSequence > 0;
  return validLedgerIdentifier(scope.tenantId)
    && validLedgerIdentifier(scope.projectId)
    && validLedgerIdentifier(input.actorUserId)
    && validLedgerIdentifier(input.lineageId)
    && validLedgerIdentifier(input.commandId, 512)
    && validHash(input.sourceContentHash)
    && validHash(input.targetContentHash)
    && Number.isSafeInteger(input.sourceRevision)
    && input.sourceRevision >= 0
    && input.targetRevision === input.sourceRevision + 1
    && (input.operation === 'apply' || input.operation === 'undo' || input.operation === 'redo')
    && sourceSequenceValid
    && (input.createdAt === undefined || (Number.isSafeInteger(input.createdAt) && input.createdAt >= 0));
}
function validEvent(value: StoredHistoryEvent): value is ArchitectureInteriorHistoryEvent {
  return typeof value.id === 'string' && value.id.length > 0
    && Number.isSafeInteger(Number(value.sequence)) && Number(value.sequence) > 0
    && (value.operation === 'apply' || value.operation === 'undo' || value.operation === 'redo')
    && typeof value.lineageId === 'string' && value.lineageId.length > 0
    && (value.source_sequence == null || (Number.isSafeInteger(Number(value.source_sequence)) && Number(value.source_sequence) > 0))
    && typeof value.actorUserId === 'string' && value.actorUserId.length > 0
    && typeof value.commandId === 'string' && value.commandId.length > 0
    && Number.isSafeInteger(Number(value.sourceRevision)) && Number(value.sourceRevision) >= 0 && validHash(value.sourceContentHash)
    && Number.isSafeInteger(Number(value.targetRevision)) && Number(value.targetRevision) === Number(value.sourceRevision) + 1 && validHash(value.targetContentHash)
    && Number.isSafeInteger(Number(value.createdAt)) && Number(value.createdAt) >= 0;
}

function normalize(row: StoredHistoryEvent): ArchitectureInteriorHistoryEvent | null {
  if (!validEvent(row)) return null;
  return {
    id: row.id, sequence: Number(row.sequence), operation: row.operation, lineageId: row.lineageId,
    ...(row.source_sequence == null ? {} : { sourceSequence: Number(row.source_sequence) }),
    actorUserId: row.actorUserId, commandId: row.commandId,
    sourceRevision: Number(row.sourceRevision), sourceContentHash: row.sourceContentHash,
    targetRevision: Number(row.targetRevision), targetContentHash: row.targetContentHash, createdAt: Number(row.createdAt),
  };
}

export async function readArchitectureInteriorHistory(
  db: DbAdapter,
  scope: { tenantId: string; projectId: string },
): Promise<ArchitectureInteriorHistoryState> {
  const rows = await db.queryAll<StoredHistoryEvent>(
    `SELECT id, sequence, operation, lineage_id AS "lineageId", source_sequence,
            actor_user_id AS "actorUserId", command_id AS "commandId",
            source_revision AS "sourceRevision", source_content_hash AS "sourceContentHash",
            target_revision AS "targetRevision", target_content_hash AS "targetContentHash", created_at AS "createdAt"
     FROM nf_architecture_interior_history WHERE tenant_id = ? AND project_id = ? ORDER BY sequence ASC LIMIT ?`,
    scope.tenantId, scope.projectId, ARCHITECTURE_INTERIOR_HISTORY_MAX_EVENTS + 1,
  );
  const events = rows.map(normalize);
  if (events.some(event => !event)) throw new Error('history_corrupt');
  const normalized = events as ArchitectureInteriorHistoryEvent[];
  if (normalized.length > ARCHITECTURE_INTERIOR_HISTORY_MAX_EVENTS) throw new Error('history_limit_exceeded');
  const bySequence = new Map(normalized.map(event => [event.sequence, event]));
  // Keep the active and reverted operation stacks separate.  The undo/redo
  // rows themselves are ledger records; they are not snapshots to undo again.
  const active: ArchitectureInteriorHistoryEvent[] = [];
  const future: ArchitectureInteriorHistoryEvent[] = [];
  for (const event of normalized) {
    if (event.operation === 'apply') { active.push(event); future.length = 0; continue; }
    if (event.operation === 'undo') {
      const source = event.sourceSequence === undefined ? undefined : bySequence.get(event.sourceSequence);
      if (!source || (source.operation !== 'apply' && source.operation !== 'redo')) throw new Error('history_corrupt');
      if (active.at(-1)?.sequence !== source.sequence) throw new Error('history_corrupt');
      active.pop(); future.push(source); continue;
    }
    const undone = event.sourceSequence === undefined ? undefined : bySequence.get(event.sourceSequence);
    const source = undone?.sourceSequence === undefined ? undefined : bySequence.get(undone.sourceSequence);
    if (!undone || undone.operation !== 'undo' || !source || (source.operation !== 'apply' && source.operation !== 'redo')) throw new Error('history_corrupt');
    if (future.at(-1)?.sequence !== source.sequence) throw new Error('history_corrupt');
    future.pop(); active.push(event);
  }
  return { events: normalized, undo: active.at(-1), redo: future.at(-1) };
}

export async function appendArchitectureInteriorHistoryEvent(
  db: DbAdapter,
  scope: { tenantId: string; projectId: string },
  input: Omit<ArchitectureInteriorHistoryEvent, 'id' | 'sequence' | 'createdAt'> & { createdAt?: number },
): Promise<ArchitectureInteriorHistoryEvent> {
  if (!validAppendInput(scope, input)) throw new Error('history_input_invalid');
  return db.transaction(tx => appendArchitectureInteriorHistoryEventInTransaction(tx, scope, input));
}

/** Append using a caller-owned transaction so workspace CAS and the ledger row
 * commit or roll back together.  The row stores only revision/hash references. */
export async function appendArchitectureInteriorHistoryEventInTransaction(
  tx: DbAdapter,
  scope: { tenantId: string; projectId: string },
  input: Omit<ArchitectureInteriorHistoryEvent, 'id' | 'sequence' | 'createdAt'> & { createdAt?: number },
): Promise<ArchitectureInteriorHistoryEvent> {
  if (!validAppendInput(scope, input)) throw new Error('history_input_invalid');
  const count = await tx.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM nf_architecture_interior_history WHERE tenant_id = ? AND project_id = ?', scope.tenantId, scope.projectId);
  if (Number(count?.count ?? 0) >= ARCHITECTURE_INTERIOR_HISTORY_MAX_EVENTS) throw new Error('history_limit_exceeded');
  const latest = await tx.queryOne<{ sequence: number }>('SELECT sequence FROM nf_architecture_interior_history WHERE tenant_id = ? AND project_id = ? ORDER BY sequence DESC LIMIT 1', scope.tenantId, scope.projectId);
  const event: ArchitectureInteriorHistoryEvent = { ...input, id: randomUUID(), sequence: Number(latest?.sequence ?? 0) + 1, createdAt: input.createdAt ?? Date.now() };
  await tx.execute(
    `INSERT INTO nf_architecture_interior_history
     (id, tenant_id, project_id, sequence, operation, lineage_id, source_sequence, actor_user_id, command_id,
      source_revision, source_content_hash, target_revision, target_content_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    event.id, scope.tenantId, scope.projectId, event.sequence, event.operation, event.lineageId,
    event.sourceSequence ?? null, event.actorUserId, event.commandId, event.sourceRevision,
    event.sourceContentHash, event.targetRevision, event.targetContentHash, event.createdAt,
  );
  return event;
}
