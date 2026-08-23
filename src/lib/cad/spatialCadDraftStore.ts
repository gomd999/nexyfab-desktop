import { createHash, randomUUID } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import {
  applySpatialCadCommand,
  validateSpatialCadCommand,
  validateSpatialCadDocument,
  type SpatialCadCommand,
  type SpatialCadDocument,
  type SpatialCadDomain,
} from './spatialCadCommand';
import { diffCadWorkspacePaths } from './workspaceRevisionStore';
import { stableSpatialCadDocumentJson } from './spatialCadHash';
import { normalizeSpatialCadLocks, releaseSpatialCadLocks, spatialCadLockScope, type SpatialCadLockDto } from './spatialCadLocks';

export interface StoredSpatialCadDraft {
  projectId: string;
  projectRevision: number;
  contentHash: string;
  document: SpatialCadDocument;
  savedAt: number;
  documentId?: string;
  locks?: SpatialCadLockDto[];
  lockIssues?: string[];
}

export type PersistSpatialCadDraftResult =
  | { ok: true; draft: StoredSpatialCadDraft }
  | { ok: false; code: 'INVALID_DRAFT'; issues: string[] }
  | { ok: false; code: 'REVISION_CONFLICT'; currentRevision: number; conflictPaths: string[] }
  | { ok: false; code: 'DOCUMENT_ID_CONFLICT' | 'LOCK_CONFLICT'; issues: string[] };

export type SpatialCadLock = { id: string; target: { kind: string; objectId: string; field?: string } };
export type PersistSpatialCadCommandResult =
  | { ok: true; draft: StoredSpatialCadDraft; command: SpatialCadCommand; changedPaths: string[] }
  | { ok: false; code: 'INVALID_COMMAND' | 'INVALID_DRAFT' | 'REVISION_CONFLICT' | 'CONTENT_HASH_CONFLICT' | 'DOCUMENT_ID_CONFLICT' | 'LOCK_CONFLICT' | 'VALIDATION_FAILED'; issues?: string[]; currentRevision?: number; conflictPaths?: string[] };
export type ReleaseSpatialCadLocksResult =
  | { ok: true; draft: StoredSpatialCadDraft; released: string[] }
  | { ok: false; code: 'INVALID_REQUEST' | 'REVISION_CONFLICT' | 'CONTENT_HASH_CONFLICT' | 'DOCUMENT_ID_CONFLICT' | 'LOCK_CONFLICT'; issues?: string[]; currentRevision?: number };

export async function ensureSpatialCadDraftTables(db: DbAdapter): Promise<void> {
  await db.executeRaw(`
    CREATE TABLE IF NOT EXISTS nf_spatial_cad_drafts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      project_revision INTEGER NOT NULL,
      document_revision INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      UNIQUE(project_id, domain, project_revision)
    );
    CREATE INDEX IF NOT EXISTS idx_nf_spatial_draft_project_domain
      ON nf_spatial_cad_drafts(project_id, domain, project_revision DESC);
    CREATE TABLE IF NOT EXISTS nf_spatial_cad_draft_heads (
      project_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      project_revision INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      document_id TEXT NOT NULL DEFAULT '',
      locks_json TEXT NOT NULL DEFAULT '[]',
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(project_id, domain)
    );
  `);
  // Additive columns are installed by the explicit SQLite/PostgreSQL
  // migrations. Request handlers must not race on DDL or hide migration
  // failures by treating every ALTER error as "already present".
}

function hashDocument(document: SpatialCadDocument): string {
  return createHash('sha256').update(stableSpatialCadDocumentJson(document)).digest('hex');
}

function deriveHumanParameterLocks(
  projectId: string,
  document: SpatialCadDocument,
  documentId: string,
  currentDocument: SpatialCadDocument | undefined,
  existing: readonly SpatialCadLockDto[],
  userId: string,
  savedAt: number,
): { locks: SpatialCadLockDto[]; changedPaths: string[]; issues: string[] } {
  // A first save creates the baseline; it must not lock every initial field.
  if (!currentDocument) return { locks: [...existing], changedPaths: [], issues: [] };
  const changedPaths = diffCadWorkspacePaths(currentDocument.parameters, document.parameters, 257);
  if (changedPaths.length >= 257 || changedPaths.some(path => path.includes('$'))) {
    return { locks: [...existing], changedPaths, issues: ['changed_parameter_scope_invalid'] };
  }
  const topLevel = [...new Set(changedPaths.map(path => path.split(/[.[\]]/)[0]).filter(Boolean))];
  const scope = spatialCadLockScope(projectId, document.domain, documentId);
  const byId = new Map(existing.map(lock => [lock.id, { ...lock, target: { ...lock.target } }]));
  for (const field of topLevel) {
    const id = `human:${createHash('sha256').update(`${scope}\\0${userId}\\0${field}`).digest('hex')}`;
    byId.set(id, {
      id,
      target: { kind: 'parameter', objectId: documentId, field },
      scope,
      source: 'human',
      reason: 'Human parameter edit',
      createdAt: new Date(savedAt).toISOString(),
      ownerUserId: userId,
    });
  }
  return { locks: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)), changedPaths, issues: [] };
}

export async function persistSpatialCadDraft(
  db: DbAdapter,
  userId: string,
  projectId: string,
  baseRevision: number,
  document: SpatialCadDocument,
  options: { documentId?: string; locks?: readonly SpatialCadLock[] } = {},
): Promise<PersistSpatialCadDraftResult> {
  const issues = validateSpatialCadDocument(document);
  if (!projectId.trim()) issues.push('invalid_project_id');
  if (document.updatedBy !== 'human') issues.push('draft_updated_by_must_be_human');
  if (!options.documentId?.trim()) issues.push('document_id_required');
  if (options.locks !== undefined) issues.push('client_full_lock_replacement_forbidden');
  if (!Number.isSafeInteger(baseRevision) || baseRevision < -1) issues.push('invalid_base_revision');
  if (issues.length) return { ok: false, code: 'INVALID_DRAFT', issues: [...new Set(issues)] };

  return db.transaction(async tx => {
    const head = await tx.queryOne<{ project_revision: number; content_hash: string; document_id?: string; locks_json?: string }>(
      'SELECT project_revision, content_hash, document_id, locks_json FROM nf_spatial_cad_draft_heads WHERE project_id = ? AND domain = ?',
      projectId, document.domain,
    );
    const currentRevision = head?.project_revision ?? -1;
    if (currentRevision !== baseRevision) {
      const current = await tx.queryOne<{ payload_json: string }>(
        'SELECT payload_json FROM nf_spatial_cad_drafts WHERE project_id = ? AND domain = ? ORDER BY project_revision DESC LIMIT 1',
        projectId, document.domain,
      );
      return {
        ok: false,
        code: 'REVISION_CONFLICT',
        currentRevision,
        conflictPaths: current ? diffCadWorkspacePaths(JSON.parse(current.payload_json), document) : [],
      };
    }
    if (head?.document_id && head.document_id !== options.documentId) {
      return { ok: false, code: 'DOCUMENT_ID_CONFLICT', issues: ['document_id_changed'] };
    }

    let existingLocks: SpatialCadLockDto[] = [];
    if (head) {
      try {
        const parsed: unknown = JSON.parse(head.locks_json ?? '[]');
        if (!Array.isArray(parsed)) throw new Error('invalid_server_locks');
        const normalized = normalizeSpatialCadLocks(parsed);
        if (normalized.issues.length) throw new Error('invalid_server_locks');
        existingLocks = normalized.locks;
        if (existingLocks.some(lock => lock.scope !== spatialCadLockScope(projectId, document.domain, options.documentId!))) throw new Error('invalid_server_lock_scope');
      } catch {
        return { ok: false, code: 'LOCK_CONFLICT', issues: ['invalid_server_locks'] };
      }
    }
    let currentDocument: SpatialCadDocument | undefined;
    if (head) {
      const current = await tx.queryOne<{ payload_json: string; content_hash: string; document_revision: number }>(
        'SELECT payload_json, content_hash, document_revision FROM nf_spatial_cad_drafts WHERE project_id = ? AND domain = ? AND project_revision = ?',
        projectId, document.domain, currentRevision,
      );
      if (!current) return { ok: false, code: 'INVALID_DRAFT', issues: ['server_document_missing'] };
      try { currentDocument = JSON.parse(current.payload_json) as SpatialCadDocument; } catch { return { ok: false, code: 'INVALID_DRAFT', issues: ['invalid_server_document'] }; }
      if (validateSpatialCadDocument(currentDocument).length || currentDocument.domain !== document.domain || current.document_revision !== currentDocument.revision) {
        return { ok: false, code: 'INVALID_DRAFT', issues: ['server_document_revision_mismatch'] };
      }
      if (document.revision !== currentDocument.revision + 1) return { ok: false, code: 'INVALID_DRAFT', issues: ['invalid_next_document_revision'] };
      if (current.content_hash !== head.content_hash || hashDocument(currentDocument) !== head.content_hash) {
        return { ok: false, code: 'INVALID_DRAFT', issues: ['server_document_hash_mismatch'] };
      }
    }
    const projectRevision = baseRevision + 1;
    const contentHash = hashDocument(document);
    const savedAt = Date.now();
    const derived = deriveHumanParameterLocks(projectId, document, options.documentId!, currentDocument, existingLocks, userId, savedAt);
    if (derived.issues.length) return { ok: false, code: 'INVALID_DRAFT', issues: derived.issues };
    if (!head) {
      const inserted = await tx.execute(
        'INSERT INTO nf_spatial_cad_draft_heads (project_id, domain, project_revision, content_hash, document_id, locks_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, domain) DO NOTHING',
        projectId, document.domain, projectRevision, contentHash, options.documentId, JSON.stringify(derived.locks), savedAt,
      );
      if (inserted.changes !== 1) return { ok: false, code: 'REVISION_CONFLICT', currentRevision: 0, conflictPaths: [] };
    } else {
      const updated = await tx.execute(
        'UPDATE nf_spatial_cad_draft_heads SET project_revision = ?, content_hash = ?, document_id = ?, locks_json = ?, updated_at = ? WHERE project_id = ? AND domain = ? AND project_revision = ? AND content_hash = ?',
        projectRevision, contentHash, options.documentId, JSON.stringify(derived.locks), savedAt, projectId, document.domain, baseRevision, head.content_hash,
      );
      if (updated.changes !== 1) return { ok: false, code: 'REVISION_CONFLICT', currentRevision: baseRevision + 1, conflictPaths: [] };
    }
    await tx.execute(
      `INSERT INTO nf_spatial_cad_drafts
       (id, project_id, domain, project_revision, document_revision, content_hash, payload_json, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), projectId, document.domain, projectRevision, document.revision,
      contentHash, JSON.stringify(document), userId, savedAt,
    );
    await tx.execute(
      `INSERT INTO nf_audit_log (id, user_id, action, resource_id, metadata, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), userId, 'cad.spatial_draft_commit', projectId,
      JSON.stringify({ domain: document.domain, projectRevision, documentRevision: document.revision, contentHash, changedPaths: derived.changedPaths, lockIds: derived.locks.map(lock => lock.id) }),
      null, savedAt,
    );
    return { ok: true, draft: { projectId, projectRevision, contentHash, document: structuredClone(document), savedAt, documentId: options.documentId, locks: derived.locks } };
  });
}

export async function readSpatialCadDraft(
  db: DbAdapter,
  projectId: string,
  domain: SpatialCadDomain,
): Promise<StoredSpatialCadDraft | null> {
  const row = await db.queryOne<{ project_revision: number; content_hash: string; payload_json: string; created_at: number }>(
    'SELECT project_revision, content_hash, payload_json, created_at FROM nf_spatial_cad_drafts WHERE project_id = ? AND domain = ? ORDER BY project_revision DESC LIMIT 1',
    projectId, domain,
  );
  const head = await db.queryOne<{ document_id?: string; locks_json?: string }>(
    'SELECT document_id, locks_json FROM nf_spatial_cad_draft_heads WHERE project_id = ? AND domain = ?', projectId, domain,
  );
  let locks: SpatialCadLockDto[] | undefined;
  let lockIssues: string[] | undefined;
  try {
    const parsed: unknown = JSON.parse(head?.locks_json ?? '[]');
    if (!Array.isArray(parsed)) throw new Error('invalid_server_locks');
    const normalized = normalizeSpatialCadLocks(parsed);
    locks = normalized.locks;
    if (normalized.issues.length) lockIssues = normalized.issues;
    if (head?.document_id && locks.some(lock => lock.scope !== spatialCadLockScope(projectId, domain, head.document_id!))) lockIssues = [...(lockIssues ?? []), 'invalid_lock_scope'];
  } catch { locks = []; lockIssues = ['invalid_server_locks']; }
  return row ? {
    projectId,
    projectRevision: row.project_revision,
    contentHash: row.content_hash,
    document: JSON.parse(row.payload_json) as SpatialCadDocument,
    savedAt: Number(row.created_at),
    documentId: head?.document_id || undefined,
    locks,
    lockIssues,
  } : null;
}

export async function releaseSpatialCadDraftLocks(
  db: DbAdapter,
  userId: string,
  projectId: string,
  domain: SpatialCadDomain,
  input: { baseProjectRevision: number; contentHash: string; documentId: string; lockIds: readonly string[] },
): Promise<ReleaseSpatialCadLocksResult> {
  if (!userId.trim() || !projectId.trim() || !input.documentId.trim() || !Number.isSafeInteger(input.baseProjectRevision) || input.baseProjectRevision < 0 || !/^[a-f0-9]{64}$/.test(input.contentHash) || !input.lockIds.length || input.lockIds.some(id => !id.trim())) return { ok: false, code: 'INVALID_REQUEST' };
  return db.transaction(async tx => {
    const head = await tx.queryOne<{ project_revision: number; content_hash: string; document_id: string; locks_json: string }>('SELECT project_revision, content_hash, document_id, locks_json FROM nf_spatial_cad_draft_heads WHERE project_id = ? AND domain = ?', projectId, domain);
    if (!head || head.project_revision !== input.baseProjectRevision) return { ok: false, code: 'REVISION_CONFLICT', currentRevision: head?.project_revision ?? -1 };
    if (head.content_hash !== input.contentHash) return { ok: false, code: 'CONTENT_HASH_CONFLICT' };
    if (head.document_id !== input.documentId) return { ok: false, code: 'DOCUMENT_ID_CONFLICT' };
    let locks: SpatialCadLockDto[];
    try {
      const parsed: unknown = JSON.parse(head.locks_json || '[]');
      if (!Array.isArray(parsed)) throw new Error('invalid_server_locks');
      const normalized = normalizeSpatialCadLocks(parsed);
      if (normalized.issues.length) throw new Error('invalid_server_locks');
      locks = normalized.locks;
      if (locks.some(lock => lock.scope !== spatialCadLockScope(projectId, domain, input.documentId))) throw new Error('invalid_server_lock_scope');
    } catch { return { ok: false, code: 'LOCK_CONFLICT', issues: ['invalid_server_locks'] }; }
    const released = releaseSpatialCadLocks(locks, input.lockIds, userId, spatialCadLockScope(projectId, domain, input.documentId));
    if (released.issues.length) return { ok: false, code: 'LOCK_CONFLICT', issues: released.issues };
    const row = await tx.queryOne<{ payload_json: string; document_revision: number; content_hash: string }>('SELECT payload_json, document_revision, content_hash FROM nf_spatial_cad_drafts WHERE project_id = ? AND domain = ? AND project_revision = ?', projectId, domain, input.baseProjectRevision);
    if (!row) return { ok: false, code: 'LOCK_CONFLICT', issues: ['server_document_missing'] };
    let document: SpatialCadDocument;
    try { document = JSON.parse(row.payload_json) as SpatialCadDocument; } catch { return { ok: false, code: 'LOCK_CONFLICT', issues: ['invalid_server_document'] }; }
    if (validateSpatialCadDocument(document).length || document.domain !== domain || row.document_revision !== document.revision) return { ok: false, code: 'LOCK_CONFLICT', issues: ['server_document_revision_mismatch'] };
    if (row.content_hash !== input.contentHash || hashDocument(document) !== input.contentHash) return { ok: false, code: 'CONTENT_HASH_CONFLICT' };
    const nextLocks = released.locks;
    const nextRevision = input.baseProjectRevision + 1;
    const savedAt = Date.now();
    const updated = await tx.execute('UPDATE nf_spatial_cad_draft_heads SET project_revision = ?, locks_json = ?, updated_at = ? WHERE project_id = ? AND domain = ? AND project_revision = ? AND content_hash = ?', nextRevision, JSON.stringify(nextLocks), savedAt, projectId, domain, input.baseProjectRevision, input.contentHash);
    if (updated.changes !== 1) return { ok: false, code: 'REVISION_CONFLICT', currentRevision: nextRevision };
    await tx.execute('INSERT INTO nf_spatial_cad_drafts (id, project_id, domain, project_revision, document_revision, content_hash, payload_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', randomUUID(), projectId, domain, nextRevision, document.revision, input.contentHash, JSON.stringify(document), userId, savedAt);
    await tx.execute(
      `INSERT INTO nf_audit_log (id, user_id, action, resource_id, metadata, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), userId, 'cad.spatial_lock_release', projectId,
      JSON.stringify({ domain, projectRevision: nextRevision, documentId: input.documentId, released: released.releasedIds }),
      null, savedAt,
    );
    return { ok: true, released: [...input.lockIds], draft: { projectId, projectRevision: nextRevision, contentHash: input.contentHash, document, savedAt, documentId: input.documentId, locks: nextLocks } };
  });
}

function sameLocks(a: readonly SpatialCadLock[], b: readonly SpatialCadLock[]): boolean {
  const projection = (locks: readonly SpatialCadLock[]) => locks
    .map(lock => ({ id: lock.id, target: lock.target }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify(projection(a)) === JSON.stringify(projection(b));
}

function lockProtectsParameter(lock: SpatialCadLock, documentId: string, path: string): boolean {
  if (lock.target.kind === 'workspace') return true;
  if (lock.target.kind === 'feature' && lock.target.objectId === documentId) return true;
  if (lock.target.kind !== 'parameter') return false;
  return (lock.target.objectId === documentId && (lock.target.field === undefined || lock.target.field === path))
    || (lock.target.objectId === path && lock.target.field === undefined);
}

/**
 * Authoritative project command path. The client supplies only a reviewed
 * command and its revision-bound guards; the server reloads the current head,
 * reapplies the command, and commits the resulting document and head in one
 * database transaction.
 */
export async function persistSpatialCadCommand(
  db: DbAdapter,
  userId: string,
  projectId: string,
  input: {
    baseProjectRevision: number;
    baseContentHash: string;
    documentId: string;
    locks: readonly SpatialCadLock[];
    command: SpatialCadCommand;
    parameterPaths?: readonly string[];
    mode?: 'new_design' | 'request_only_edit';
  },
): Promise<PersistSpatialCadCommandResult> {
  const commandIssues = validateSpatialCadCommand(input.command);
  const lockIssues = input.locks.length > 64 || input.locks.some(lock => !lock?.id?.trim() || lock.id.length > 160 || !lock.target?.objectId?.trim() || lock.target.objectId.length > 200 || !lock.target.kind?.trim());
  if (commandIssues.length || !projectId.trim() || !userId.trim() || !input.documentId.trim()
    || lockIssues || !Number.isSafeInteger(input.baseProjectRevision) || input.baseProjectRevision < 0
    || !/^[a-f0-9]{64}$/.test(input.baseContentHash)) {
    return { ok: false, code: commandIssues.length ? 'INVALID_COMMAND' : 'INVALID_DRAFT', issues: [...commandIssues, ...(projectId.trim() ? [] : ['invalid_project_id']), ...(lockIssues ? ['invalid_locks'] : [])] };
  }
  const mode = input.mode ?? 'request_only_edit';
  const paths = [...new Set(input.parameterPaths ?? [])];
  if (input.command.actor === 'ai') {
    if (mode === 'request_only_edit' && (input.command.operation.kind !== 'set_parameter' || paths.length !== 1 || paths[0] !== input.command.operation.key)) {
      return { ok: false, code: 'VALIDATION_FAILED', issues: ['request_only_edit_scope_required'] };
    }
    if (mode === 'new_design' && input.command.operation.kind !== 'replace_parameters') {
      return { ok: false, code: 'VALIDATION_FAILED', issues: ['new_design_replace_parameters_required'] };
    }
  }

  return db.transaction(async tx => {
    const head = await tx.queryOne<{ project_revision: number; content_hash: string; document_id?: string; locks_json?: string }>(
      'SELECT project_revision, content_hash, document_id, locks_json FROM nf_spatial_cad_draft_heads WHERE project_id = ? AND domain = ?',
      projectId, input.command.domain,
    );
    const currentRevision = head?.project_revision ?? -1;
    if (!head || currentRevision !== input.baseProjectRevision) {
      return { ok: false, code: 'REVISION_CONFLICT', currentRevision, conflictPaths: [] };
    }
    if (head.content_hash !== input.baseContentHash) return { ok: false, code: 'CONTENT_HASH_CONFLICT', issues: ['content_hash_changed'] };
    if (head.document_id && head.document_id !== input.documentId) return { ok: false, code: 'DOCUMENT_ID_CONFLICT', issues: ['document_id_changed'] };
    let currentLocks: SpatialCadLockDto[] = [];
    try {
      const parsed: unknown = JSON.parse(head.locks_json ?? '[]');
      if (!Array.isArray(parsed)) throw new Error('invalid_server_locks');
      const normalized = normalizeSpatialCadLocks(parsed);
      if (normalized.issues.length) throw new Error('invalid_server_locks');
      currentLocks = normalized.locks;
      if (currentLocks.some(lock => lock.scope !== spatialCadLockScope(projectId, input.command.domain, input.documentId))) throw new Error('invalid_server_lock_scope');
    } catch { return { ok: false, code: 'LOCK_CONFLICT', issues: ['invalid_server_locks'] }; }
    if (!sameLocks(currentLocks, input.locks)) return { ok: false, code: 'LOCK_CONFLICT', issues: ['live_locks_changed'] };

    const row = await tx.queryOne<{ payload_json: string; content_hash: string; document_revision: number; created_at: number }>(
      'SELECT payload_json, content_hash, document_revision, created_at FROM nf_spatial_cad_drafts WHERE project_id = ? AND domain = ? AND project_revision = ?',
      projectId, input.command.domain, currentRevision,
    );
    if (!row) return { ok: false, code: 'VALIDATION_FAILED', issues: ['server_document_missing'] };
    let document: SpatialCadDocument;
    try { document = JSON.parse(row.payload_json) as SpatialCadDocument; } catch { return { ok: false, code: 'VALIDATION_FAILED', issues: ['invalid_server_document'] }; }
    const recomputedBaseHash = hashDocument(document);
    if (row.content_hash !== head.content_hash || recomputedBaseHash !== head.content_hash) {
      return { ok: false, code: 'CONTENT_HASH_CONFLICT', issues: ['server_document_hash_mismatch'] };
    }
    if (row.document_revision !== document.revision) {
      return { ok: false, code: 'VALIDATION_FAILED', issues: ['server_document_revision_mismatch'] };
    }
    const changedParameterPaths = input.command.operation.kind === 'set_parameter'
      ? [input.command.operation.key]
      : [...new Set([...Object.keys(document.parameters), ...Object.keys(input.command.operation.parameters)])];
    const blockingLocks = currentLocks.filter(lock => changedParameterPaths.some(path => lockProtectsParameter(lock, input.documentId, path)));
    if (blockingLocks.length) return { ok: false, code: 'LOCK_CONFLICT', issues: ['protected_user_or_authority_value'] };
    const transaction = applySpatialCadCommand(document, input.command);
    if (!transaction.committed) return { ok: false, code: 'VALIDATION_FAILED', issues: transaction.issues };
    if (mode === 'request_only_edit' && (transaction.changedPaths.length !== 1 || transaction.changedPaths[0] !== `parameters.${paths[0]}`)) {
      return { ok: false, code: 'VALIDATION_FAILED', issues: ['server_changed_scope_mismatch'] };
    }

    const nextProjectRevision = currentRevision + 1;
    const contentHash = hashDocument(transaction.document);
    const savedAt = Date.now();
    const updated = await tx.execute(
      'UPDATE nf_spatial_cad_draft_heads SET project_revision = ?, content_hash = ?, document_id = ?, locks_json = ?, updated_at = ? WHERE project_id = ? AND domain = ? AND project_revision = ? AND content_hash = ?',
      nextProjectRevision, contentHash, input.documentId, JSON.stringify(currentLocks), savedAt, projectId, transaction.document.domain, currentRevision, input.baseContentHash,
    );
    if (updated.changes !== 1) return { ok: false, code: 'REVISION_CONFLICT', currentRevision: currentRevision + 1, conflictPaths: [] };
    await tx.execute(
      `INSERT INTO nf_spatial_cad_drafts
       (id, project_id, domain, project_revision, document_revision, content_hash, payload_json, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), projectId, transaction.document.domain, nextProjectRevision, transaction.document.revision,
      contentHash, JSON.stringify(transaction.document), userId, savedAt,
    );
    await tx.execute(
      `INSERT INTO nf_audit_log (id, user_id, action, resource_id, metadata, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), userId, 'cad.spatial_command_commit', projectId,
      JSON.stringify({ domain: transaction.document.domain, projectRevision: nextProjectRevision, documentRevision: transaction.document.revision, contentHash, changedPaths: transaction.changedPaths }),
      null, savedAt,
    );
    return { ok: true, command: input.command, changedPaths: transaction.changedPaths, draft: { projectId, projectRevision: nextProjectRevision, contentHash, document: structuredClone(transaction.document), savedAt, documentId: input.documentId, locks: currentLocks } };
  });
}
