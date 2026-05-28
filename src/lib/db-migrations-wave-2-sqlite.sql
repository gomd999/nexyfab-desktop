-- ============================================================================
-- Wave 2 — Cloud Document Migration (SQLite dev equivalent)
-- ----------------------------------------------------------------------------
-- This file is the dev-mode mirror of `db-migrations-wave-2.sql` for
-- environments without Postgres (laptop dev with better-sqlite3).
--
-- Differences vs the Postgres version:
--
--   * UUIDs → TEXT columns (caller passes crypto.randomUUID()). No
--     gen_random_uuid() default — apps must generate ids in JS, same pattern
--     as the rest of the codebase (see db.ts).
--   * TIMESTAMPTZ → BIGINT (ms epoch). Matches every other timestamp column
--     in the legacy SQLite schema, so adapter logic stays uniform.
--   * JSONB → TEXT (JSON-encoded string). Application layer JSON.stringify /
--     JSON.parse — same pattern as nf_audit_log.metadata today.
--   * INET → TEXT.
--   * BIGSERIAL → INTEGER PRIMARY KEY AUTOINCREMENT.
--   * Partial unique indexes are supported in SQLite 3.8+ — used here for
--     the single-owner invariant.
--   * Triggers use SQLite syntax (no plpgsql).
--   * EXTENSION pgcrypto skipped.
--
-- Apply once after the base SQLite schema is initialized (db.ts).
-- Re-runs are safe: all CREATEs are IF NOT EXISTS.
-- ============================================================================

-- ─── Workspaces ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nf_workspaces (
  id          TEXT    PRIMARY KEY,
  owner_id    TEXT    NOT NULL REFERENCES nf_users(id) ON DELETE RESTRICT,
  name        TEXT    NOT NULL,
  created_at  BIGINT  NOT NULL,
  updated_at  BIGINT  NOT NULL,
  deleted_at  BIGINT
);

CREATE INDEX IF NOT EXISTS idx_nf_workspaces_owner
  ON nf_workspaces (owner_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_nf_workspaces_deleted
  ON nf_workspaces (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- updated_at auto-bump trigger (SQLite uses unixepoch() * 1000 for ms).
DROP TRIGGER IF EXISTS trg_nf_workspaces_updated_at;
CREATE TRIGGER trg_nf_workspaces_updated_at
  AFTER UPDATE ON nf_workspaces
  FOR EACH ROW
  WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE nf_workspaces SET updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000 + (CAST(strftime('%f','now') AS REAL) * 1000) % 1000
    WHERE id = NEW.id;
END;

-- ─── Workspace membership ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nf_workspace_members (
  workspace_id TEXT   NOT NULL REFERENCES nf_workspaces(id) ON DELETE CASCADE,
  user_id      TEXT   NOT NULL REFERENCES nf_users(id)      ON DELETE CASCADE,
  role         TEXT   NOT NULL CHECK (role IN ('owner', 'editor', 'commenter', 'viewer')),
  invited_by   TEXT   REFERENCES nf_users(id),
  joined_at    BIGINT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_nf_workspace_members_user
  ON nf_workspace_members (user_id);

-- ─── Documents ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nf_documents (
  id              TEXT    PRIMARY KEY,
  owner_id        TEXT    NOT NULL REFERENCES nf_users(id) ON DELETE RESTRICT,
  workspace_id    TEXT    REFERENCES nf_workspaces(id) ON DELETE SET NULL,

  name            TEXT    NOT NULL,
  blob_r2_key     TEXT    NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,

  nfab_format     INTEGER NOT NULL DEFAULT 2,
  yjs_proto       INTEGER NOT NULL DEFAULT 1,

  thumbnail_r2_key TEXT,
  size_bytes      INTEGER NOT NULL DEFAULT 0,
  feature_count   INTEGER NOT NULL DEFAULT 0,
  part_count      INTEGER NOT NULL DEFAULT 0,

  created_at      BIGINT  NOT NULL,
  updated_at      BIGINT  NOT NULL,
  last_edited_by  TEXT    REFERENCES nf_users(id),
  deleted_at      BIGINT
);

CREATE INDEX IF NOT EXISTS idx_nf_documents_workspace
  ON nf_documents (workspace_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_nf_documents_owner
  ON nf_documents (owner_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_nf_documents_deleted
  ON nf_documents (deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nf_documents_last_edited_by
  ON nf_documents (last_edited_by);

-- updated_at auto-bump (only when the application didn't set it explicitly).
DROP TRIGGER IF EXISTS trg_nf_documents_updated_at;
CREATE TRIGGER trg_nf_documents_updated_at
  AFTER UPDATE ON nf_documents
  FOR EACH ROW
  WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE nf_documents SET updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000 + (CAST(strftime('%f','now') AS REAL) * 1000) % 1000
    WHERE id = NEW.id;
END;

-- ─── Document-level permissions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nf_document_permissions (
  document_id TEXT   NOT NULL REFERENCES nf_documents(id) ON DELETE CASCADE,
  user_id     TEXT   NOT NULL REFERENCES nf_users(id)    ON DELETE CASCADE,
  role        TEXT   NOT NULL CHECK (role IN ('owner', 'editor', 'commenter', 'viewer')),
  granted_by  TEXT   REFERENCES nf_users(id),
  granted_at  BIGINT NOT NULL,
  expires_at  BIGINT,
  PRIMARY KEY (document_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_nf_document_permissions_user
  ON nf_document_permissions (user_id);

-- Single-owner invariant — SQLite supports partial unique indexes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nf_document_permissions_single_owner
  ON nf_document_permissions (document_id)
  WHERE role = 'owner';

CREATE INDEX IF NOT EXISTS idx_nf_document_permissions_expires
  ON nf_document_permissions (expires_at)
  WHERE expires_at IS NOT NULL;

-- ─── Version history ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nf_document_versions (
  id                 TEXT    PRIMARY KEY,
  document_id        TEXT    NOT NULL REFERENCES nf_documents(id) ON DELETE CASCADE,
  parent_version_id  TEXT    REFERENCES nf_document_versions(id),
  blob_r2_key        TEXT    NOT NULL,
  oplog_r2_key       TEXT,
  label              TEXT,
  branch_name        TEXT,
  is_explicit        INTEGER NOT NULL DEFAULT 0,  -- 0=auto, 1=user-named
  size_bytes         INTEGER NOT NULL DEFAULT 0,
  created_by         TEXT    NOT NULL REFERENCES nf_users(id),
  created_at         BIGINT  NOT NULL,
  CHECK ((branch_name IS NULL) OR (parent_version_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_nf_document_versions_doc
  ON nf_document_versions (document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nf_document_versions_explicit
  ON nf_document_versions (document_id)
  WHERE is_explicit = 1;

CREATE INDEX IF NOT EXISTS idx_nf_document_versions_gc
  ON nf_document_versions (created_at)
  WHERE is_explicit = 0;

-- ─── Audit log ─────────────────────────────────────────────────────────────
-- BIGSERIAL → INTEGER PRIMARY KEY AUTOINCREMENT (SQLite's ROWID-backed sequence).
CREATE TABLE IF NOT EXISTS nf_document_audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id  TEXT    NOT NULL REFERENCES nf_documents(id) ON DELETE CASCADE,
  user_id      TEXT    REFERENCES nf_users(id),
  action       TEXT    NOT NULL,
  detail       TEXT,         -- JSON-encoded; was JSONB in Postgres
  ip_inet      TEXT,         -- was INET in Postgres
  user_agent   TEXT,
  created_at   BIGINT  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nf_document_audit_doc
  ON nf_document_audit_log (document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nf_document_audit_user
  ON nf_document_audit_log (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nf_document_audit_action
  ON nf_document_audit_log (action, created_at DESC);

-- End wave-2 SQLite migration.
