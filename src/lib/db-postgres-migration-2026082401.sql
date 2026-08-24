-- Authority-owned Canonical CAD V2 revision journal for GP-03/GP-10.
-- Requests never create these tables. All writes remain project/document scoped,
-- and project ownership is resolved by the authenticated API before store access.

CREATE TABLE IF NOT EXISTS nf_cad_canonical_v2_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES nf_projects(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  sequence BIGINT NOT NULL,
  content_hash TEXT NOT NULL,
  parent_revision_id TEXT,
  parent_sequence BIGINT,
  parent_content_hash TEXT,
  document_json TEXT NOT NULL,
  command_id TEXT,
  command_sha256 TEXT,
  idempotency_key TEXT,
  command_json TEXT,
  compensation_for_command_id TEXT,
  receipt_json TEXT,
  receipt_sha256 TEXT,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT nf_cad_v2_revision_identity_uq UNIQUE(project_id, document_id, revision_id),
  CONSTRAINT nf_cad_v2_revision_sequence_uq UNIQUE(project_id, document_id, sequence),
  CONSTRAINT nf_cad_v2_command_id_uq UNIQUE(project_id, document_id, command_id),
  CONSTRAINT nf_cad_v2_idempotency_uq UNIQUE(project_id, document_id, idempotency_key),
  CONSTRAINT nf_cad_v2_sequence_ck CHECK (sequence >= 0),
  CONSTRAINT nf_cad_v2_content_hash_ck CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_cad_v2_parent_triplet_ck CHECK (
    (parent_revision_id IS NULL AND parent_sequence IS NULL AND parent_content_hash IS NULL)
    OR (parent_revision_id IS NOT NULL AND parent_sequence IS NOT NULL
      AND parent_sequence >= 0 AND parent_content_hash ~ '^[a-f0-9]{64}$')
  ),
  CONSTRAINT nf_cad_v2_command_receipt_ck CHECK (
    (command_id IS NULL AND command_sha256 IS NULL AND idempotency_key IS NULL
      AND command_json IS NULL AND receipt_json IS NULL AND receipt_sha256 IS NULL)
    OR (command_id IS NOT NULL AND command_sha256 ~ '^[a-f0-9]{64}$'
      AND idempotency_key IS NOT NULL AND command_json IS NOT NULL
      AND receipt_json IS NOT NULL AND receipt_sha256 ~ '^[a-f0-9]{64}$')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_nf_cad_v2_compensation_once
  ON nf_cad_canonical_v2_revisions(project_id, document_id, compensation_for_command_id)
  WHERE compensation_for_command_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nf_cad_v2_revision_head_lookup
  ON nf_cad_canonical_v2_revisions(project_id, document_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_nf_cad_v2_revision_dependency
  ON nf_cad_canonical_v2_revisions(project_id, document_id, command_id, sequence);

CREATE TABLE IF NOT EXISTS nf_cad_canonical_v2_heads (
  project_id TEXT NOT NULL REFERENCES nf_projects(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  sequence BIGINT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY(project_id, document_id),
  CONSTRAINT nf_cad_v2_head_sequence_ck CHECK (sequence >= 0),
  CONSTRAINT nf_cad_v2_head_content_hash_ck CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_cad_v2_head_revision_fk
    FOREIGN KEY(project_id, document_id, revision_id)
    REFERENCES nf_cad_canonical_v2_revisions(project_id, document_id, revision_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS nf_cad_canonical_v2_invalidations (
  revision_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES nf_projects(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY(project_id, document_id, revision_id, scope),
  CONSTRAINT nf_cad_v2_invalidation_scope_ck CHECK (
    scope IN ('exact_geometry', 'native_document', 'analysis', 'drawing',
      'quantity', 'exchange', 'qualification')
  ),
  CONSTRAINT nf_cad_v2_invalidation_revision_fk
    FOREIGN KEY(project_id, document_id, revision_id)
    REFERENCES nf_cad_canonical_v2_revisions(project_id, document_id, revision_id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_nf_cad_v2_invalidation_delivery
  ON nf_cad_canonical_v2_invalidations(project_id, document_id, created_at, scope);

CREATE TABLE IF NOT EXISTS nf_cad_canonical_v2_locks (
  project_id TEXT NOT NULL REFERENCES nf_projects(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  lock_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  object_id TEXT,
  field_path TEXT,
  owner_actor_id TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY(project_id, document_id, lock_id),
  CONSTRAINT nf_cad_v2_lock_scope_ck CHECK (scope IN ('workspace', 'object', 'field')),
  CONSTRAINT nf_cad_v2_lock_source_ck CHECK (source IN ('human', 'authority')),
  CONSTRAINT nf_cad_v2_lock_field_ck CHECK (
    (scope = 'field' AND field_path IS NOT NULL)
    OR (scope <> 'field' AND field_path IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_nf_cad_v2_lock_loading
  ON nf_cad_canonical_v2_locks(project_id, document_id, lock_id);

CREATE TABLE IF NOT EXISTS nf_cad_canonical_v2_audit (
  receipt_sha256 TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES nf_projects(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT nf_cad_v2_audit_receipt_hash_ck CHECK (receipt_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_cad_v2_audit_revision_fk
    FOREIGN KEY(project_id, document_id, revision_id)
    REFERENCES nf_cad_canonical_v2_revisions(project_id, document_id, revision_id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_nf_cad_v2_audit_review
  ON nf_cad_canonical_v2_audit(project_id, document_id, created_at DESC);

DROP TRIGGER IF EXISTS nf_cad_v2_revisions_immutable ON nf_cad_canonical_v2_revisions;
CREATE TRIGGER nf_cad_v2_revisions_immutable
BEFORE UPDATE OR DELETE ON nf_cad_canonical_v2_revisions
FOR EACH ROW EXECUTE FUNCTION nf_commercial_append_only_row();

DROP TRIGGER IF EXISTS nf_cad_v2_invalidations_immutable ON nf_cad_canonical_v2_invalidations;
CREATE TRIGGER nf_cad_v2_invalidations_immutable
BEFORE UPDATE OR DELETE ON nf_cad_canonical_v2_invalidations
FOR EACH ROW EXECUTE FUNCTION nf_commercial_append_only_row();

DROP TRIGGER IF EXISTS nf_cad_v2_audit_immutable ON nf_cad_canonical_v2_audit;
CREATE TRIGGER nf_cad_v2_audit_immutable
BEFORE UPDATE OR DELETE ON nf_cad_canonical_v2_audit
FOR EACH ROW EXECUTE FUNCTION nf_commercial_append_only_row();

DROP TRIGGER IF EXISTS nf_cad_v2_head_identity_immutable ON nf_cad_canonical_v2_heads;
CREATE TRIGGER nf_cad_v2_head_identity_immutable
BEFORE UPDATE ON nf_cad_canonical_v2_heads
FOR EACH ROW EXECUTE FUNCTION nf_commercial_identity_immutable('project_id', 'document_id');

DROP TRIGGER IF EXISTS nf_cad_v2_lock_identity_immutable ON nf_cad_canonical_v2_locks;
CREATE TRIGGER nf_cad_v2_lock_identity_immutable
BEFORE UPDATE ON nf_cad_canonical_v2_locks
FOR EACH ROW EXECUTE FUNCTION nf_commercial_identity_immutable('project_id', 'document_id', 'lock_id');
