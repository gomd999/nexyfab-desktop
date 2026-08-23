-- Immutable additive migration: interior precision placement CAS documents.
CREATE TABLE IF NOT EXISTS nf_interior_placement_draft_heads (
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  room_document_id TEXT NOT NULL,
  project_revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  locks_json TEXT NOT NULL DEFAULT '[]',
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (project_id, document_id)
);
CREATE TABLE IF NOT EXISTS nf_interior_placement_drafts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  room_document_id TEXT NOT NULL,
  project_revision INTEGER NOT NULL,
  document_revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE (project_id, document_id, project_revision)
);
CREATE INDEX IF NOT EXISTS idx_nf_interior_placement_drafts_lookup
  ON nf_interior_placement_drafts(project_id, document_id, project_revision DESC);
