/**
 * cloudDoc/access.ts — Permission resolution + table bootstrap for Wave 2
 *                      cloud-document tables.
 *
 * Backs `docs/wave-2-cloud-document-migration.md` §2 (Postgres schema) and
 * §8 (permission model). The canonical Postgres DDL ships separately as a
 * migration; this module installs a compatible SQLite shape on first call so
 * tests + the SQLite dev loop work without external migrations. The Postgres
 * production schema is byte-for-byte the doc spec.
 *
 * Role precedence (per §8.2):
 *
 *   effective_role(user, doc) =
 *     nf_document_permissions.role  IF an override row exists
 *     ELSE nf_workspace_members.role  for the doc's workspace
 *     ELSE null  (treat as 404 — never leak existence)
 *
 * Implementations: see `resolveDocAccess` below.
 */

import { getDbAdapter, type DbAdapter } from '@/lib/db-adapter';

export type DocRole = 'owner' | 'editor' | 'commenter' | 'viewer';

export interface DocAccess {
  row: DocumentRow;
  role: DocRole;
  /** Convenience flag — true iff role is owner or editor. */
  canEdit: boolean;
  /** Convenience flag — true iff role is owner. */
  canManage: boolean;
}

export interface DocumentRow {
  id: string;
  owner_id: string;
  workspace_id: string | null;
  name: string;
  blob_r2_key: string;
  version: number;
  nfab_format: number;
  yjs_proto: number;
  thumbnail_r2_key: string | null;
  size_bytes: number;
  feature_count: number;
  part_count: number;
  created_at: number;
  updated_at: number;
  last_edited_by: string | null;
  deleted_at: number | null;
}

/**
 * Idempotently create the 5 cloud-doc tables on SQLite.
 *
 * On Postgres the migration SQL in `docs/wave-2-cloud-document-migration.md`
 * §2.1 is authoritative — Postgres deployments must apply that migration
 * before requests hit this endpoint. We DO still call this on Postgres but
 * the `CREATE TABLE IF NOT EXISTS` is a no-op there.
 *
 * Implementation notes:
 *
 *   - id columns are TEXT (UUID-as-string) because SQLite has no native UUID.
 *     Postgres production uses real UUID; the adapter doesn't transform the
 *     value either way, so a string flows through unchanged.
 *   - timestamps are stored as ms-epoch BIGINT (matches existing nf_users /
 *     nf_projects convention). BIGINT is required: on Postgres, INTEGER is
 *     int4 and Date.now() (~1.79e12) overflows it → "integer out of range"
 *     on every insert → /api/documents 500 (W6-A root cause). On SQLite the
 *     BIGINT keyword has INTEGER affinity, so behavior is unchanged there.
 *     The canonical startup DDL lives in db-postgres-migrations.sql (wave-2
 *     section, BIGINT-ms port) — this lazy fallback must stay type-aligned.
 *   - the partial unique index on document-owner is *not* created here; that
 *     constraint is Postgres-only (SQLite supports partial indexes but the
 *     CHECK syntax differs). The application enforces single-owner via the
 *     POST permission handler.
 */
let _tablesEnsured = false;
export async function ensureCloudDocTables(): Promise<void> {
  if (_tablesEnsured) return;
  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_workspaces (
      id          TEXT    PRIMARY KEY,
      owner_id    TEXT    NOT NULL,
      name        TEXT    NOT NULL,
      created_at  BIGINT  NOT NULL,
      updated_at  BIGINT  NOT NULL,
      deleted_at  BIGINT
    )
  `).catch(() => {});
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_workspace_members (
      workspace_id TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      role         TEXT NOT NULL,
      invited_by   TEXT,
      joined_at    BIGINT NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    )
  `).catch(() => {});
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_documents (
      id               TEXT    PRIMARY KEY,
      owner_id         TEXT    NOT NULL,
      workspace_id     TEXT,
      name             TEXT    NOT NULL,
      blob_r2_key      TEXT    NOT NULL,
      version          INTEGER NOT NULL DEFAULT 1,
      nfab_format      INTEGER NOT NULL DEFAULT 2,
      yjs_proto        INTEGER NOT NULL DEFAULT 1,
      thumbnail_r2_key TEXT,
      size_bytes       BIGINT  NOT NULL DEFAULT 0,
      feature_count    INTEGER NOT NULL DEFAULT 0,
      part_count       INTEGER NOT NULL DEFAULT 0,
      created_at       BIGINT  NOT NULL,
      updated_at       BIGINT  NOT NULL,
      last_edited_by   TEXT,
      deleted_at       BIGINT
    )
  `).catch(() => {});
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_document_permissions (
      document_id TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      role        TEXT NOT NULL,
      granted_by  TEXT,
      granted_at  BIGINT NOT NULL,
      expires_at  BIGINT,
      PRIMARY KEY (document_id, user_id)
    )
  `).catch(() => {});
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_document_versions (
      id                TEXT    PRIMARY KEY,
      document_id       TEXT    NOT NULL,
      parent_version_id TEXT,
      blob_r2_key       TEXT    NOT NULL,
      oplog_r2_key      TEXT,
      label             TEXT,
      branch_name       TEXT,
      is_explicit       INTEGER NOT NULL DEFAULT 0,
      size_bytes        BIGINT  NOT NULL DEFAULT 0,
      restored_from     TEXT,
      created_by        TEXT    NOT NULL,
      created_at        BIGINT  NOT NULL
    )
  `).catch(() => {});
  // W6-C backfill: tables created before the restored_from column existed.
  // SQLite has no ADD COLUMN IF NOT EXISTS — idempotent-by-catch (duplicate
  // column errors are swallowed on both backends).
  await db.execute('ALTER TABLE nf_document_versions ADD COLUMN restored_from TEXT').catch(() => {});
  // PDM gate/approval status — ADVISORY ONLY (260723 architecture-debt
  // scoping). The client-side design-driver review queue already refuses to
  // merge a gate-failed run in its own in-memory model, but the SERVER had
  // zero gate awareness: any authenticated editor with the lock could POST a
  // new version regardless of gate status, becoming the queryable "current"
  // state with nothing to distinguish it from a properly-reviewed one. These
  // columns let a caller ATTACH what it already computed (client-asserted,
  // like `label`/`branchName` already are) so the version-history UI can
  // show a "gate-failed" badge — the route does NOT reject writes based on
  // this field; CAD workflows legitimately need to persist in-progress /
  // failing states (see versionBranch.ts's per-branch `protected` flag,
  // which already accepts direct commits on unprotected branches).
  // gate_status: 'passed' | 'failed' | null (null/absent = caller didn't assert one — NOT the same as 'passed').
  // gate_report: JSON-serialized GateResultLike[] (id/pass/value?/expected?/unit?/reason?), for the UI to render detail.
  await db.execute('ALTER TABLE nf_document_versions ADD COLUMN gate_status TEXT').catch(() => {});
  await db.execute('ALTER TABLE nf_document_versions ADD COLUMN gate_report TEXT').catch(() => {});
  // W6-B: exclusive check-out locks. document_id PRIMARY KEY = at most one
  // lock row per document; expires_at (BIGINT ms) discriminates active/stale.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_document_locks (
      document_id  TEXT   PRIMARY KEY,
      holder_id    TEXT   NOT NULL,
      acquired_at  BIGINT NOT NULL,
      refreshed_at BIGINT NOT NULL,
      expires_at   BIGINT NOT NULL
    )
  `).catch(() => {});
  _tablesEnsured = true;
}

/** Reset the table-bootstrap memo. Tests use this between cases. */
export function _resetCloudDocTables(): void {
  _tablesEnsured = false;
}

/**
 * Coerce a DB numeric to a JS number.
 *
 * node-postgres returns BIGINT (int8) columns as *strings* (no default type
 * parser for int8 — JS numbers can't hold the full range). All BIGINT-ms
 * timestamp/size columns in the wave-2 tables therefore arrive as strings on
 * Postgres but as numbers on SQLite. Response shapes must be backend-uniform,
 * so coerce at the serialization boundary. Safe: ms-epoch values (~1.8e12)
 * are far below Number.MAX_SAFE_INTEGER (9e15).
 */
export function asNum(v: unknown): number {
  return typeof v === 'number' ? v : Number(v);
}

/** Like asNum but preserves NULL (e.g. deleted_at, expires_at). */
export function asNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'number' ? v : Number(v);
}

/** True iff `role` (the user's effective role) ≥ `required`. */
export function roleAtLeast(role: DocRole, required: DocRole): boolean {
  const order: DocRole[] = ['viewer', 'commenter', 'editor', 'owner'];
  return order.indexOf(role) >= order.indexOf(required);
}

/**
 * Resolve effective access for (user, document).
 *
 * Returns null when:
 *   - the document does not exist
 *   - the document is soft-deleted (`deleted_at IS NOT NULL`)
 *   - the user has no override AND no workspace membership
 *
 * The caller maps null → 404 (never 403 on non-existence — avoids existence
 * leakage). For a 403 ("you're allowed in but read-only"), call the resolver,
 * check role, and return the right status from the route.
 *
 * When `includeDeleted=true`, the deleted_at gate is skipped — used by the
 * restore-after-soft-delete path (PUT ?undelete=1) to discriminate
 * "deleted, can be restored by owner" from "never existed."
 */
export async function resolveDocAccess(
  db: DbAdapter,
  documentId: string,
  userId: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<DocAccess | null> {
  await ensureCloudDocTables();
  const row = await db.queryOne<DocumentRow>(
    'SELECT * FROM nf_documents WHERE id = ?',
    documentId,
  );
  if (!row) return null;
  if (!opts.includeDeleted && row.deleted_at !== null && row.deleted_at !== undefined) {
    return null;
  }

  // Owner shortcut — `nf_documents.owner_id` is authoritative even if a row
  // in nf_document_permissions later reassigns 'owner' to someone else
  // (which the application disallows). We trust the row.owner_id field here.
  if (row.owner_id === userId) {
    return { row, role: 'owner', canEdit: true, canManage: true };
  }

  // 1. document-level override
  const override = await db.queryOne<{ role: string; expires_at: number | null }>(
    'SELECT role, expires_at FROM nf_document_permissions WHERE document_id = ? AND user_id = ?',
    documentId, userId,
  );
  if (override) {
    if (override.expires_at && override.expires_at < Date.now()) {
      // expired — fall through to workspace check (treats expired as no override)
    } else {
      const role = normaliseRole(override.role);
      if (role) {
        return { row, role, canEdit: role === 'owner' || role === 'editor', canManage: role === 'owner' };
      }
    }
  }

  // 2. workspace membership
  if (row.workspace_id) {
    const wm = await db.queryOne<{ role: string }>(
      'SELECT role FROM nf_workspace_members WHERE workspace_id = ? AND user_id = ?',
      row.workspace_id, userId,
    );
    if (wm) {
      const role = normaliseRole(wm.role);
      if (role) {
        return { row, role, canEdit: role === 'owner' || role === 'editor', canManage: role === 'owner' };
      }
    }
  }

  return null;
}

function normaliseRole(raw: string): DocRole | null {
  if (raw === 'owner' || raw === 'editor' || raw === 'commenter' || raw === 'viewer') return raw;
  return null;
}

/**
 * Ensure the user has at least one workspace ("Personal" auto-create).
 * Returns the workspace id. Idempotent per the doc spec §2.4.
 */
export async function ensurePersonalWorkspace(
  db: DbAdapter,
  userId: string,
): Promise<string> {
  await ensureCloudDocTables();
  const existing = await db.queryOne<{ id: string }>(
    `SELECT w.id FROM nf_workspaces w
     WHERE w.owner_id = ? AND w.deleted_at IS NULL
     ORDER BY w.created_at ASC LIMIT 1`,
    userId,
  );
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  const now = Date.now();
  await db.execute(
    `INSERT INTO nf_workspaces (id, owner_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    id, userId, 'Personal', now, now,
  );
  await db.execute(
    `INSERT INTO nf_workspace_members (workspace_id, user_id, role, invited_by, joined_at)
     VALUES (?, ?, ?, ?, ?)`,
    id, userId, 'owner', userId, now,
  );
  return id;
}
