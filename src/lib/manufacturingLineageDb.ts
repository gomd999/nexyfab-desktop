import type { DbAdapter } from './db-adapter';

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
  | { ok: false; code: 'LINEAGE_NOT_FOUND' | 'LINEAGE_NOT_AUTHORIZED' | 'LINEAGE_ARTIFACT_MISMATCH' };

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
