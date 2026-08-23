import type { DbAdapter } from './db-adapter';
import { randomUUID } from 'node:crypto';

export interface ManufacturingLineageRefInput {
  lineageId: string;
  artifactId: string;
  artifactSha256: string;
  documentVersionId: string;
}

interface ManufacturingLineageRow {
  lineage_id: string;
  user_id: string;
  artifact_id: string;
  artifact_sha256: string;
  document_version_id: string;
  release_status: string;
  authorized_at: number | null;
  authorized_by: string | null;
  invalidated_at: number | null;
}

export type AuthorizedLineageResult =
  | { ok: true; ref: ManufacturingLineageRefInput }
  | { ok: false; code: 'LINEAGE_REFERENCE_MISSING' | 'LINEAGE_NOT_FOUND' | 'LINEAGE_NOT_AUTHORIZED' | 'LINEAGE_ARTIFACT_MISMATCH' };

export interface StoredManufacturingLineageColumns {
  lineage_id: string | null;
  artifact_id: string | null;
  artifact_sha256: string | null;
  document_version_id: string | null;
}

export async function resolveStoredManufacturingLineage(
  db: DbAdapter,
  ownerUserId: string,
  stored: StoredManufacturingLineageColumns,
): Promise<AuthorizedLineageResult> {
  if (!stored.lineage_id || !stored.artifact_id || !stored.artifact_sha256 || !stored.document_version_id) {
    return { ok: false, code: 'LINEAGE_REFERENCE_MISSING' };
  }
  return resolveAuthorizedManufacturingLineage(db, ownerUserId, {
    lineageId: stored.lineage_id,
    artifactId: stored.artifact_id,
    artifactSha256: stored.artifact_sha256,
    documentVersionId: stored.document_version_id,
  });
}

export async function ensureManufacturingLineageInvalidationTable(db: DbAdapter): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS nf_manufacturing_lineage_invalidations (
    id TEXT PRIMARY KEY,
    lineage_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    prior_document_version_id TEXT NOT NULL,
    replacement_document_version_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    invalidated_at BIGINT NOT NULL,
    UNIQUE(lineage_id, replacement_document_version_id)
  )`);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_mfg_invalidation_lineage ON nf_manufacturing_lineage_invalidations(lineage_id, invalidated_at DESC)');
}

/**
 * A newly committed CAD revision revokes every previously authorized release
 * for that project and records an append-only invalidation receipt.
 */
export async function invalidateManufacturingLineageForRevision(
  db: DbAdapter,
  projectId: string,
  replacementDocumentVersionId: string,
  invalidatedAt = Date.now(),
): Promise<string[]> {
  await ensureManufacturingLineageInvalidationTable(db);
  const active = await db.queryAll<{ lineage_id: string; document_version_id: string }>(
    `SELECT lineage_id, document_version_id
       FROM nf_manufacturing_lineage
      WHERE project_id = ? AND release_status = 'authorized' AND document_version_id <> ?`,
    projectId,
    replacementDocumentVersionId,
  ).catch(() => []);
  const invalidated: string[] = [];
  for (const row of active) {
    const reason = `CAD revision replaced by ${replacementDocumentVersionId}`;
    const update = await db.execute(
      `UPDATE nf_manufacturing_lineage
          SET release_status = 'revoked', invalidated_at = ?, invalidation_reason = ?, updated_at = ?
        WHERE lineage_id = ? AND release_status = 'authorized'`,
      invalidatedAt, reason, invalidatedAt, row.lineage_id,
    );
    if (update.changes !== 1) continue;
    invalidated.push(row.lineage_id);
    await db.execute(
      `INSERT INTO nf_manufacturing_lineage_invalidations
        (id, lineage_id, project_id, prior_document_version_id, replacement_document_version_id, reason, invalidated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(lineage_id, replacement_document_version_id) DO NOTHING`,
      `mli-${randomUUID()}`, row.lineage_id, projectId, row.document_version_id,
      replacementDocumentVersionId, reason, invalidatedAt,
    );
  }
  return invalidated;
}

/** Resolves server-owned release evidence. Client claims never create or authorize lineage. */
export async function resolveAuthorizedManufacturingLineage(
  db: DbAdapter,
  userId: string,
  requested: ManufacturingLineageRefInput,
): Promise<AuthorizedLineageResult> {
  const row = await db.queryOne<ManufacturingLineageRow>(
    `SELECT lineage_id, user_id, artifact_id, artifact_sha256, document_version_id,
            release_status, authorized_at, authorized_by, invalidated_at
       FROM nf_manufacturing_lineage
      WHERE lineage_id = ? AND user_id = ?`,
    requested.lineageId,
    userId,
  );
  if (!row) return { ok: false, code: 'LINEAGE_NOT_FOUND' };
  if (row.release_status !== 'authorized' || !row.authorized_at || !row.authorized_by || row.invalidated_at) {
    return { ok: false, code: 'LINEAGE_NOT_AUTHORIZED' };
  }
  if (
    row.artifact_id !== requested.artifactId
    || row.artifact_sha256 !== requested.artifactSha256
    || row.document_version_id !== requested.documentVersionId
  ) {
    return { ok: false, code: 'LINEAGE_ARTIFACT_MISMATCH' };
  }
  return { ok: true, ref: requested };
}
