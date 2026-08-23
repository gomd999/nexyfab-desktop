import { createHash, randomUUID } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import { normalizeSpatialCadLocks, releaseSpatialCadLocks, spatialCadLockScope, type SpatialCadLockDto } from './spatialCadLocks';
import { commitInteriorPlacementOperation, hashInteriorPlacementDocument, type InteriorPlacementGuards, type InteriorPlacementOperation } from './interiorPlacementTransaction';
import { validateInteriorPlacementDocument, type InteriorPlacementDocument } from './interiorPlacementDocument';
import { stableSpatialCadJson } from './spatialCadHash';

export interface StoredInteriorPlacementDraft {
  projectId: string;
  documentId: string;
  roomDocumentId: string;
  projectRevision: number;
  contentHash: string;
  document: InteriorPlacementDocument;
  locks: SpatialCadLockDto[];
  savedAt: number;
}

export type InteriorPlacementPersistResult =
  | { ok: true; draft: StoredInteriorPlacementDraft; changedObjectIds: string[] }
  | { ok: false; code: 'INVALID_REQUEST' | 'INVALID_DOCUMENT' | 'REVISION_CONFLICT' | 'CONTENT_HASH_CONFLICT' | 'DOCUMENT_ID_CONFLICT' | 'LOCK_CONFLICT' | 'VALIDATION_FAILED'; issues?: string[]; currentRevision?: number };

export type InteriorPlacementReleaseResult =
  | { ok: true; draft: StoredInteriorPlacementDraft; released: string[] }
  | { ok: false; code: 'INVALID_REQUEST' | 'REVISION_CONFLICT' | 'CONTENT_HASH_CONFLICT' | 'DOCUMENT_ID_CONFLICT' | 'LOCK_CONFLICT'; issues?: string[]; currentRevision?: number };

export type InteriorPlacementReadResult =
  | { ok: true; draft: StoredInteriorPlacementDraft }
  | { ok: false; code: 'INVALID_DRAFT' | 'CONTENT_HASH_CONFLICT' | 'LOCK_CONFLICT'; issues: string[] };

export async function ensureInteriorPlacementTables(db: DbAdapter): Promise<void> {
  await db.executeRaw(`
    CREATE TABLE IF NOT EXISTS nf_interior_placement_draft_heads (
      project_id TEXT NOT NULL, document_id TEXT NOT NULL, room_document_id TEXT NOT NULL,
      project_revision INTEGER NOT NULL, content_hash TEXT NOT NULL, locks_json TEXT NOT NULL DEFAULT '[]', updated_at BIGINT NOT NULL,
      PRIMARY KEY(project_id, document_id)
    );
    CREATE TABLE IF NOT EXISTS nf_interior_placement_drafts (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL, room_document_id TEXT NOT NULL,
      project_revision INTEGER NOT NULL, document_revision INTEGER NOT NULL, content_hash TEXT NOT NULL, payload_json TEXT NOT NULL,
      created_by TEXT NOT NULL, created_at BIGINT NOT NULL, UNIQUE(project_id, document_id, project_revision)
    );
    CREATE INDEX IF NOT EXISTS idx_nf_interior_placement_drafts_lookup ON nf_interior_placement_drafts(project_id, document_id, project_revision DESC);
  `);
}

export async function readInteriorPlacementDraft(db: DbAdapter, projectId: string, documentId: string): Promise<InteriorPlacementReadResult | null> {
  if (!projectId.trim() || !documentId.trim()) return { ok: false, code: 'INVALID_DRAFT', issues: ['document_id_required'] };
  const head = await db.queryOne<{ project_revision: number; content_hash: string; document_id: string; room_document_id: string; locks_json: string; updated_at: number }>('SELECT project_revision, content_hash, document_id, room_document_id, locks_json, updated_at FROM nf_interior_placement_draft_heads WHERE project_id = ? AND document_id = ?', projectId, documentId);
  if (!head) return null;
  const row = await db.queryOne<{ payload_json: string; document_revision: number; content_hash: string; room_document_id: string; created_at: number }>('SELECT payload_json, document_revision, content_hash, room_document_id, created_at FROM nf_interior_placement_drafts WHERE project_id = ? AND document_id = ? AND project_revision = ?', projectId, documentId, head.project_revision);
  if (!row) return { ok: false, code: 'INVALID_DRAFT', issues: ['server_document_missing'] };
  let document: InteriorPlacementDocument;
  try { document = JSON.parse(row.payload_json) as InteriorPlacementDocument; } catch { return { ok: false, code: 'INVALID_DRAFT', issues: ['invalid_server_document'] }; }
  const documentIssues = validateInteriorPlacementDocument(document);
  if (documentIssues.length || document.documentId !== documentId || document.roomDocumentId !== head.room_document_id
    || row.room_document_id !== head.room_document_id || row.document_revision !== document.revision) return { ok: false, code: 'INVALID_DRAFT', issues: documentIssues.length ? documentIssues : ['document_identity_mismatch'] };
  if (row.content_hash !== head.content_hash || hashInteriorPlacementDocument(document) !== head.content_hash) return { ok: false, code: 'CONTENT_HASH_CONFLICT', issues: ['server_document_hash_mismatch'] };
  const parsed = parseLocks(head.locks_json, spatialCadLockScope(projectId, 'interior', documentId));
  if (parsed.issues.length) return { ok: false, code: 'LOCK_CONFLICT', issues: parsed.issues };
  return { ok: true, draft: { projectId, documentId, roomDocumentId: head.room_document_id, projectRevision: head.project_revision, contentHash: head.content_hash, document, locks: parsed.locks, savedAt: Number(row.created_at) } };
}

function lockFingerprint(lock: { id: string; target: { kind: string; objectId: string; field?: string } }): string {
  return `${lock.id}|${lock.target.kind}|${lock.target.objectId}|${lock.target.field ?? ''}`;
}

function parseLocks(raw: string, scope: string): { locks: SpatialCadLockDto[]; issues: string[] } {
  try {
    const parsed: unknown = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return { locks: [], issues: ['invalid_server_locks'] };
    const normalized = normalizeSpatialCadLocks(parsed);
    if (normalized.issues.length || normalized.locks.some(lock => lock.scope !== scope)) return { locks: normalized.locks, issues: [...normalized.issues, 'invalid_lock_scope'] };
    return normalized;
  } catch { return { locks: [], issues: ['invalid_server_locks'] }; }
}

function generatedLocks(projectId: string, documentId: string, changedObjectIds: readonly string[], savedAt: number, userId: string): SpatialCadLockDto[] {
  const scope = spatialCadLockScope(projectId, 'interior', documentId);
  return [...new Set(changedObjectIds)].map(objectId => ({
    id: `human:${createHash('sha256').update(`${scope}\\0${userId}\\0${objectId}`).digest('hex')}`,
    target: { kind: 'occurrence', objectId }, scope, source: 'human' as const, reason: 'Human furniture placement edit', createdAt: new Date(savedAt).toISOString(), ownerUserId: userId,
  }));
}

export async function persistInteriorPlacementOperation(
  db: DbAdapter,
  userId: string,
  projectId: string,
  input: { documentId: string; roomDocumentId: string; baseProjectRevision: number; operation: InteriorPlacementOperation; actor?: 'human' | 'ai'; document?: InteriorPlacementDocument; guards?: Omit<InteriorPlacementGuards, 'baseRevision' | 'baseContentHash' | 'currentContentHash' | 'locks'> & { parameterPaths?: readonly string[]; locks?: InteriorPlacementGuards['locks']; baseContentHash?: string; currentContentHash?: string } },
): Promise<InteriorPlacementPersistResult> {
  if (!userId.trim() || !projectId.trim() || !input.documentId.trim() || !input.roomDocumentId.trim() || !Number.isSafeInteger(input.baseProjectRevision) || input.baseProjectRevision < -1) return { ok: false, code: 'INVALID_REQUEST' };
  if (input.actor !== undefined && input.actor !== 'human' && input.actor !== 'ai') return { ok: false, code: 'INVALID_REQUEST' };
  const actor = input.actor ?? 'human';
  if (actor === 'ai' && input.operation.kind !== 'patch_selected_object') return { ok: false, code: 'VALIDATION_FAILED', issues: ['ai_patch_selected_object_only'] };
  if (actor === 'human' && input.operation.kind === 'patch_selected_object') return { ok: false, code: 'VALIDATION_FAILED', issues: ['human_patch_selected_object_forbidden'] };
  if (actor === 'human' && input.guards !== undefined) return { ok: false, code: 'INVALID_REQUEST', issues: ['client_lock_payload_forbidden'] };
  return db.transaction(async tx => {
    const scope = spatialCadLockScope(projectId, 'interior', input.documentId);
    const head = await tx.queryOne<{ project_revision: number; content_hash: string; document_id: string; room_document_id: string; locks_json: string }>('SELECT project_revision, content_hash, document_id, room_document_id, locks_json FROM nf_interior_placement_draft_heads WHERE project_id = ? AND document_id = ?', projectId, input.documentId);
    const currentRevision = head?.project_revision ?? -1;
    if (currentRevision !== input.baseProjectRevision) return { ok: false, code: 'REVISION_CONFLICT', currentRevision };
    if (head && head.room_document_id !== input.roomDocumentId) return { ok: false, code: 'DOCUMENT_ID_CONFLICT', issues: ['room_document_id_changed'] };
    let current: InteriorPlacementDocument;
    let currentLocks: SpatialCadLockDto[] = [];
    if (!head) {
      if (actor !== 'human' || !input.document || input.baseProjectRevision !== -1 || input.document.revision !== 0
        || validateInteriorPlacementDocument(input.document).length || input.document.documentId !== input.documentId || input.document.roomDocumentId !== input.roomDocumentId) return { ok: false, code: 'INVALID_DOCUMENT', issues: ['baseline_document_required'] };
      current = structuredClone(input.document);
    } else {
      const row = await tx.queryOne<{ payload_json: string; content_hash: string }>('SELECT payload_json, content_hash FROM nf_interior_placement_drafts WHERE project_id = ? AND document_id = ? AND project_revision = ?', projectId, input.documentId, currentRevision);
      if (!row) return { ok: false, code: 'VALIDATION_FAILED', issues: ['server_document_missing'] };
      try { current = JSON.parse(row.payload_json) as InteriorPlacementDocument; } catch { return { ok: false, code: 'VALIDATION_FAILED', issues: ['invalid_server_document'] }; }
      if (row.content_hash !== head.content_hash || hashInteriorPlacementDocument(current) !== head.content_hash) return { ok: false, code: 'CONTENT_HASH_CONFLICT', issues: ['server_document_hash_mismatch'] };
      const parsed = parseLocks(head.locks_json, scope); if (parsed.issues.length) return { ok: false, code: 'LOCK_CONFLICT', issues: parsed.issues }; currentLocks = parsed.locks;
    }
    if (actor === 'ai') {
      const guards = input.guards;
      if (!head || !guards?.baseContentHash || !guards.currentContentHash || !guards.locks
        || guards.baseContentHash !== head.content_hash || guards.currentContentHash !== head.content_hash
        || guards.locks.map(lockFingerprint).sort().join('\n') !== currentLocks.map(lockFingerprint).sort().join('\n')) return { ok: false, code: 'LOCK_CONFLICT', issues: ['live_lock_evidence_required'] };
    }
    const guards = actor === 'ai' ? { ...input.guards!, baseRevision: current.revision, baseContentHash: hashInteriorPlacementDocument(current), currentContentHash: hashInteriorPlacementDocument(current), locks: currentLocks } : undefined;
    const reduced = !head && input.operation.kind === 'reset_layout' && stableSpatialCadJson(input.operation.objects) === stableSpatialCadJson(current.objects)
      ? { committed: true as const, document: current, changedObjectIds: [] as string[], history: { past: [], future: [] } }
      : commitInteriorPlacementOperation(current, input.operation, { past: [], future: [] }, guards);
    if (!reduced.committed) return { ok: false, code: reduced.issues.includes('stale_revision_or_hash') ? 'CONTENT_HASH_CONFLICT' : reduced.issues.includes('protected_object') ? 'LOCK_CONFLICT' : 'VALIDATION_FAILED', issues: reduced.issues };
    const mergedLocks = actor === 'human' ? [...currentLocks, ...generatedLocks(projectId, input.documentId, reduced.changedObjectIds, Date.now(), userId)].filter((lock, index, all) => all.findIndex(candidate => candidate.id === lock.id) === index) : currentLocks;
    const normalizedLocks = normalizeSpatialCadLocks(mergedLocks);
    if (normalizedLocks.issues.length) return { ok: false, code: 'LOCK_CONFLICT', issues: normalizedLocks.issues };
    const nextLocks = normalizedLocks.locks;
    const nextProjectRevision = currentRevision + 1; const savedAt = Date.now(); const contentHash = hashInteriorPlacementDocument(reduced.document);
    if (!head) {
      const inserted = await tx.execute('INSERT INTO nf_interior_placement_draft_heads (project_id, document_id, room_document_id, project_revision, content_hash, locks_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, document_id) DO NOTHING', projectId, input.documentId, input.roomDocumentId, nextProjectRevision, contentHash, JSON.stringify(nextLocks), savedAt);
      if (inserted.changes !== 1) return { ok: false, code: 'REVISION_CONFLICT', currentRevision: 0 };
    }
    else {
      const updated = await tx.execute('UPDATE nf_interior_placement_draft_heads SET project_revision = ?, content_hash = ?, locks_json = ?, updated_at = ? WHERE project_id = ? AND document_id = ? AND project_revision = ? AND content_hash = ?', nextProjectRevision, contentHash, JSON.stringify(nextLocks), savedAt, projectId, input.documentId, currentRevision, head.content_hash);
      if (updated.changes !== 1) return { ok: false, code: 'REVISION_CONFLICT', currentRevision: nextProjectRevision };
    }
    await tx.execute('INSERT INTO nf_interior_placement_drafts (id, project_id, document_id, room_document_id, project_revision, document_revision, content_hash, payload_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', randomUUID(), projectId, input.documentId, input.roomDocumentId, nextProjectRevision, reduced.document.revision, contentHash, JSON.stringify(reduced.document), userId, savedAt);
    await tx.execute('INSERT INTO nf_audit_log (id, user_id, action, resource_id, metadata, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', randomUUID(), userId, actor === 'ai' ? 'cad.interior_placement_ai_commit' : 'cad.interior_placement_commit', projectId, JSON.stringify({ documentId: input.documentId, projectRevision: nextProjectRevision, changedObjectIds: reduced.changedObjectIds }), null, savedAt);
    return { ok: true, changedObjectIds: reduced.changedObjectIds, draft: { projectId, documentId: input.documentId, roomDocumentId: input.roomDocumentId, projectRevision: nextProjectRevision, contentHash, document: reduced.document, locks: nextLocks, savedAt } };
  });
}

export async function releaseInteriorPlacementLocks(db: DbAdapter, userId: string, projectId: string, input: { documentId: string; baseProjectRevision: number; contentHash: string; lockIds: readonly string[] }): Promise<InteriorPlacementReleaseResult> {
  if (!userId.trim() || !projectId.trim() || !input.documentId.trim() || !Number.isSafeInteger(input.baseProjectRevision) || input.baseProjectRevision < 0 || !/^[a-f0-9]{64}$/.test(input.contentHash) || !input.lockIds.length) return { ok: false, code: 'INVALID_REQUEST' };
  return db.transaction(async tx => {
    const head = await tx.queryOne<{ project_revision: number; content_hash: string; room_document_id: string; locks_json: string }>('SELECT project_revision, content_hash, room_document_id, locks_json FROM nf_interior_placement_draft_heads WHERE project_id = ? AND document_id = ?', projectId, input.documentId);
    if (!head || head.project_revision !== input.baseProjectRevision) return { ok: false, code: 'REVISION_CONFLICT', currentRevision: head?.project_revision ?? -1 };
    if (head.content_hash !== input.contentHash) return { ok: false, code: 'CONTENT_HASH_CONFLICT' };
    const parsed = parseLocks(head.locks_json, spatialCadLockScope(projectId, 'interior', input.documentId)); if (parsed.issues.length) return { ok: false, code: 'LOCK_CONFLICT', issues: parsed.issues };
    const released = releaseSpatialCadLocks(parsed.locks, input.lockIds, userId, spatialCadLockScope(projectId, 'interior', input.documentId)); if (released.issues.length) return { ok: false, code: 'LOCK_CONFLICT', issues: released.issues };
    const row = await tx.queryOne<{ payload_json: string; document_revision: number; content_hash: string; room_document_id: string }>('SELECT payload_json, document_revision, content_hash, room_document_id FROM nf_interior_placement_drafts WHERE project_id = ? AND document_id = ? AND project_revision = ?', projectId, input.documentId, input.baseProjectRevision); if (!row) return { ok: false, code: 'LOCK_CONFLICT', issues: ['server_document_missing'] };
    let document: InteriorPlacementDocument;
    try { document = JSON.parse(row.payload_json) as InteriorPlacementDocument; } catch { return { ok: false, code: 'LOCK_CONFLICT', issues: ['invalid_server_document'] }; }
    if (validateInteriorPlacementDocument(document).length || document.documentId !== input.documentId || document.roomDocumentId !== head.room_document_id
      || row.room_document_id !== head.room_document_id || row.document_revision !== document.revision
      || row.content_hash !== input.contentHash || hashInteriorPlacementDocument(document) !== input.contentHash) return { ok: false, code: 'LOCK_CONFLICT', issues: ['server_document_mismatch'] };
    const nextRevision = input.baseProjectRevision + 1; const savedAt = Date.now();
    const updated = await tx.execute('UPDATE nf_interior_placement_draft_heads SET project_revision = ?, locks_json = ?, updated_at = ? WHERE project_id = ? AND document_id = ? AND project_revision = ? AND content_hash = ?', nextRevision, JSON.stringify(released.locks), savedAt, projectId, input.documentId, input.baseProjectRevision, input.contentHash); if (updated.changes !== 1) return { ok: false, code: 'REVISION_CONFLICT', currentRevision: nextRevision };
    await tx.execute('INSERT INTO nf_interior_placement_drafts (id, project_id, document_id, room_document_id, project_revision, document_revision, content_hash, payload_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', randomUUID(), projectId, input.documentId, head.room_document_id, nextRevision, row.document_revision, input.contentHash, row.payload_json, userId, savedAt);
    await tx.execute('INSERT INTO nf_audit_log (id, user_id, action, resource_id, metadata, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', randomUUID(), userId, 'cad.interior_placement_lock_release', projectId, JSON.stringify({ documentId: input.documentId, released: released.releasedIds, projectRevision: nextRevision }), null, savedAt);
    return { ok: true, released: released.releasedIds, draft: { projectId, documentId: input.documentId, roomDocumentId: head.room_document_id, projectRevision: nextRevision, contentHash: input.contentHash, document, locks: released.locks, savedAt } };
  });
}
