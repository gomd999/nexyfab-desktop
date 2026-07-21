/**
 * cloudDoc/versions.ts — shared row shape + serializer for
 * `nf_document_versions`, used by both the versions list/create route and
 * the W6-C restore route (route.ts files may only export handlers/config
 * under Next 16, so the shared shape lives here).
 *
 * `restored_from` (W6-C) records provenance: the id of the version whose
 * payload a restore snapshot copied. NULL for ordinary snapshots. Old rows /
 * old SQLite DBs may lack the column entirely — the serializer coalesces to
 * null so responses are shape-stable either way.
 */

import { asNum } from './access';

export interface VersionRow {
  id: string;
  document_id: string;
  parent_version_id: string | null;
  blob_r2_key: string;
  oplog_r2_key: string | null;
  label: string | null;
  branch_name: string | null;
  is_explicit: number;
  size_bytes: number | string;
  restored_from?: string | null;
  created_by: string;
  created_at: number | string;
}

export function publicVersionShape(row: VersionRow) {
  return {
    id:              row.id,
    documentId:      row.document_id,
    parentVersionId: row.parent_version_id,
    blobKey:         row.blob_r2_key,
    oplogKey:        row.oplog_r2_key,
    label:           row.label,
    branchName:      row.branch_name,
    isExplicit:      row.is_explicit === 1,
    sizeBytes:       asNum(row.size_bytes),
    restoredFrom:    row.restored_from ?? null,
    createdBy:       row.created_by,
    createdAt:       asNum(row.created_at),
  };
}
