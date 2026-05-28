-- ============================================================================
-- Wave 2 — Cloud Document Migration (Postgres)
-- ----------------------------------------------------------------------------
-- Implements the schema specified in
--   docs/wave-2-cloud-document-migration.md §2.1
-- and required by `src/lib/document-permissions.ts`.
--
-- Tables added:
--   nf_workspaces                workspace container (multi-doc)
--   nf_workspace_members         workspace-level role grants
--   nf_documents                 one row per cloud document (Yjs blob lives in R2)
--   nf_document_permissions      doc-level role override (precedence over workspace)
--   nf_document_versions         immutable version history (snapshot + branch)
--   nf_document_audit_log        append-only audit trail
--
-- Conventions:
--   * UUIDs for all new ids (`gen_random_uuid()` from pgcrypto).
--   * `nf_users.id` stays TEXT (legacy decision — see db-postgres-migrations.sql).
--   * Soft delete via `deleted_at TIMESTAMPTZ`; 90-day GC cron sweeps.
--   * `updated_at` maintained by a single shared trigger function.
--
-- Idempotent: all CREATEs use IF NOT EXISTS; triggers/functions use OR REPLACE
-- or DO blocks guarded by pg_catalog.
--
-- Apply once after the base `db-postgres-migrations.sql` is in place.
-- Rollback SQL lives in `docs/wave-2-postgres-migration-runbook.md` §3.
-- ============================================================================

-- pgcrypto provides gen_random_uuid(); already installed by base migration but
-- re-enable to be safe.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Shared trigger: bump updated_at on UPDATE ─────────────────────────────
-- Reused by nf_workspaces and nf_documents. Defined once to avoid drift.
CREATE OR REPLACE FUNCTION nf_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Workspaces ────────────────────────────────────────────────────────────
-- A workspace groups documents and seats. Owner is the creator; others get
-- access via nf_workspace_members.
CREATE TABLE IF NOT EXISTS nf_workspaces (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    TEXT        NOT NULL REFERENCES nf_users(id) ON DELETE RESTRICT,
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

-- Live-workspace lookup by owner (Hub list).
CREATE INDEX IF NOT EXISTS idx_nf_workspaces_owner
  ON nf_workspaces (owner_id)
  WHERE deleted_at IS NULL;

-- GC sweep filter for soft-deleted workspaces (after 90 d).
CREATE INDEX IF NOT EXISTS idx_nf_workspaces_deleted
  ON nf_workspaces (deleted_at)
  WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_nf_workspaces_updated_at ON nf_workspaces;
CREATE TRIGGER trg_nf_workspaces_updated_at
  BEFORE UPDATE ON nf_workspaces
  FOR EACH ROW EXECUTE FUNCTION nf_set_updated_at();

-- ─── Workspace membership ──────────────────────────────────────────────────
-- Workspace-level permission grant. Cascade-deletes with the workspace and
-- with the user. PRIMARY KEY (workspace_id, user_id) means one role per user
-- per workspace.
CREATE TABLE IF NOT EXISTS nf_workspace_members (
  workspace_id UUID        NOT NULL REFERENCES nf_workspaces(id) ON DELETE CASCADE,
  user_id      TEXT        NOT NULL REFERENCES nf_users(id)      ON DELETE CASCADE,
  role         TEXT        NOT NULL CHECK (role IN ('owner', 'editor', 'commenter', 'viewer')),
  invited_by   TEXT REFERENCES nf_users(id),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

-- Reverse lookup ("workspaces I'm in").
CREATE INDEX IF NOT EXISTS idx_nf_workspace_members_user
  ON nf_workspace_members (user_id);

-- ─── Documents ─────────────────────────────────────────────────────────────
-- One row per logical project. The actual Yjs binary snapshot lives in R2 at
-- `documents/{owner_id}/{id}/current.ydoc`; `blob_r2_key` points at it.
-- The collab worker (Cloudflare Durable Object) rewrites the blob and bumps
-- `version` on every snapshot tick.
CREATE TABLE IF NOT EXISTS nf_documents (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        TEXT        NOT NULL REFERENCES nf_users(id) ON DELETE RESTRICT,
  workspace_id    UUID        REFERENCES nf_workspaces(id) ON DELETE SET NULL,
  -- workspace_id NULL = implicit "Personal" workspace; see migration runbook §2.

  name            TEXT        NOT NULL,
  blob_r2_key     TEXT        NOT NULL,
  version         INTEGER     NOT NULL DEFAULT 1,

  -- Format / protocol pins so future clients can negotiate compatibility.
  nfab_format     SMALLINT    NOT NULL DEFAULT 2,
  yjs_proto       SMALLINT    NOT NULL DEFAULT 1,

  -- Lightweight metadata for list views (avoid fetching the blob).
  thumbnail_r2_key TEXT,
  size_bytes      INTEGER     NOT NULL DEFAULT 0,
  feature_count   INTEGER     NOT NULL DEFAULT 0,
  part_count      INTEGER     NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_edited_by  TEXT        REFERENCES nf_users(id),
  deleted_at      TIMESTAMPTZ
);

-- "Recent docs in workspace" — covers the Hub list query.
CREATE INDEX IF NOT EXISTS idx_nf_documents_workspace
  ON nf_documents (workspace_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- "Docs I own" — for personal-workspace fallback and ownership transfer UI.
CREATE INDEX IF NOT EXISTS idx_nf_documents_owner
  ON nf_documents (owner_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- GC sweep filter (soft delete → 90 d → hard delete).
CREATE INDEX IF NOT EXISTS idx_nf_documents_deleted
  ON nf_documents (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- "Last edited by" forensics — used by audit panel.
CREATE INDEX IF NOT EXISTS idx_nf_documents_last_edited_by
  ON nf_documents (last_edited_by);

DROP TRIGGER IF EXISTS trg_nf_documents_updated_at ON nf_documents;
CREATE TRIGGER trg_nf_documents_updated_at
  BEFORE UPDATE ON nf_documents
  FOR EACH ROW EXECUTE FUNCTION nf_set_updated_at();

-- ─── Document-level permissions ────────────────────────────────────────────
-- Overrides workspace role for (document, user). Absence of a row means the
-- workspace role applies (see `effectiveRole` in document-permissions.ts §1).
--
-- Single-owner invariant: at most one row per document with role='owner'.
-- Enforced by the partial UNIQUE index below — Postgres supports partial
-- indexes natively; SQLite equivalent in db-migrations-wave-2-sqlite.sql.
CREATE TABLE IF NOT EXISTS nf_document_permissions (
  document_id UUID        NOT NULL REFERENCES nf_documents(id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL REFERENCES nf_users(id)    ON DELETE CASCADE,
  role        TEXT        NOT NULL CHECK (role IN ('owner', 'editor', 'commenter', 'viewer')),
  granted_by  TEXT REFERENCES nf_users(id),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  PRIMARY KEY (document_id, user_id)
);

-- "Docs shared with me" — used by listAccessibleDocs() workspace+direct union.
CREATE INDEX IF NOT EXISTS idx_nf_document_permissions_user
  ON nf_document_permissions (user_id);

-- Single owner per doc, enforced server-side. Phase 4 ownership-transfer
-- flow must DELETE the old owner row before INSERTing the new one in a tx.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nf_document_permissions_single_owner
  ON nf_document_permissions (document_id)
  WHERE role = 'owner';

-- Expiring grants — used by nightly cron to revoke time-limited shares.
CREATE INDEX IF NOT EXISTS idx_nf_document_permissions_expires
  ON nf_document_permissions (expires_at)
  WHERE expires_at IS NOT NULL;

-- ─── Version history ───────────────────────────────────────────────────────
-- Append-only. Each snapshot tick from the collab worker writes a row. Users
-- can also explicitly "Save version" / "Branch from here", which sets
-- `is_explicit = TRUE` (retained forever, not subject to 30-day GC).
CREATE TABLE IF NOT EXISTS nf_document_versions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id        UUID        NOT NULL REFERENCES nf_documents(id) ON DELETE CASCADE,
  parent_version_id  UUID        REFERENCES nf_document_versions(id),
  blob_r2_key        TEXT        NOT NULL,
  oplog_r2_key       TEXT,
  label              TEXT,
  branch_name        TEXT,
  is_explicit        BOOLEAN     NOT NULL DEFAULT FALSE,
  size_bytes         INTEGER     NOT NULL DEFAULT 0,
  created_by         TEXT        NOT NULL REFERENCES nf_users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((branch_name IS NULL) OR (parent_version_id IS NOT NULL))
);

-- "History panel" — chronological list per doc.
CREATE INDEX IF NOT EXISTS idx_nf_document_versions_doc
  ON nf_document_versions (document_id, created_at DESC);

-- "Named versions only" — short index used by the "Versions" picker UI.
CREATE INDEX IF NOT EXISTS idx_nf_document_versions_explicit
  ON nf_document_versions (document_id)
  WHERE is_explicit = TRUE;

-- GC filter — sweep non-explicit versions older than 30 days.
CREATE INDEX IF NOT EXISTS idx_nf_document_versions_gc
  ON nf_document_versions (created_at)
  WHERE is_explicit = FALSE;

-- ─── Audit log ─────────────────────────────────────────────────────────────
-- Append-only. BIGSERIAL keeps inserts cheap (no FK back, no UUID gen).
-- `detail` is JSONB so we can index action-specific keys later.
CREATE TABLE IF NOT EXISTS nf_document_audit_log (
  id           BIGSERIAL    PRIMARY KEY,
  document_id  UUID         NOT NULL REFERENCES nf_documents(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES nf_users(id),
  action       TEXT NOT NULL,    -- create | open | snapshot | version | share | revoke | rename | delete | restore | import | export
  detail       JSONB,
  ip_inet      INET,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- "Recent activity" — chronological tail per doc.
CREATE INDEX IF NOT EXISTS idx_nf_document_audit_doc
  ON nf_document_audit_log (document_id, created_at DESC);

-- Forensics by actor — "show me everything user X did".
CREATE INDEX IF NOT EXISTS idx_nf_document_audit_user
  ON nf_document_audit_log (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Action-type drilldown — supports admin queries by action class.
CREATE INDEX IF NOT EXISTS idx_nf_document_audit_action
  ON nf_document_audit_log (action, created_at DESC);

-- ─── Migration tracking ────────────────────────────────────────────────────
-- Mark this migration applied so re-runs are no-ops at the application level.
-- Idempotent insert; ON CONFLICT DO NOTHING.
INSERT INTO nf_schema_migrations (version, name, applied_at)
VALUES (
  200,
  'wave_2_cloud_documents',
  (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
)
ON CONFLICT (version) DO NOTHING;

-- ============================================================================
-- End wave-2 migration.
-- ============================================================================
