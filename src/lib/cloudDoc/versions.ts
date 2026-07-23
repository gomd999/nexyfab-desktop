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

/** A single gate's advisory result — deliberately loose/JSON-able, mirroring
 *  design-driver's reviewQueue.ts GateResultLike (the shape a caller already
 *  computes). Not re-validated against the driver's own richer GateResult IR. */
export interface GateResultLike {
  id: string;
  pass: boolean;
  value?: number;
  expected?: number;
  unit?: string;
  reason?: string;
}

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
  /** ADVISORY ONLY — client-asserted, like label/branch_name. Never enforced
   *  by the write path. 'passed' | 'failed' | null (absent = never asserted). */
  gate_status?: string | null;
  /** JSON-serialized GateResultLike[]. Null/absent when no report was attached. */
  gate_report?: string | null;
  created_by: string;
  created_at: number | string;
}

export function publicVersionShape(row: VersionRow) {
  let gateReport: GateResultLike[] | null = null;
  if (row.gate_report) {
    try { gateReport = JSON.parse(row.gate_report) as GateResultLike[]; } catch { gateReport = null; }
  }
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
    // Advisory, client-asserted PDM gate status — NOT a server-verified
    // guarantee. See access.ts's ensureCloudDocTables comment for why this
    // is non-enforcing by design (CAD workflows need to persist WIP/failing
    // states; the server has no way to independently recompute a gate result).
    gateStatus:      row.gate_status ?? null,
    gateReport,
    createdBy:       row.created_by,
    createdAt:       asNum(row.created_at),
  };
}
