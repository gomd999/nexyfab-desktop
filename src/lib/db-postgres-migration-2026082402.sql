-- Durable AI Design V10 authority state.
-- Runtime and complex-workspace heads are mutable only through application CAS.
-- Artifact rows are immutable and content-bound after insertion.

CREATE TABLE IF NOT EXISTS nf_ai_design_workspace_runtimes (
  owner_key_sha256 TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES nf_projects(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  runtime_revision BIGINT NOT NULL,
  state_sha256 TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY(owner_key_sha256, project_id, session_id),
  CONSTRAINT nf_ai_design_runtime_owner_hash_ck CHECK (owner_key_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_ai_design_runtime_revision_ck CHECK (runtime_revision >= 0),
  CONSTRAINT nf_ai_design_runtime_state_hash_ck CHECK (state_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_ai_design_runtime_state_json_ck CHECK (length(state_json) > 0),
  CONSTRAINT nf_ai_design_runtime_time_ck CHECK (updated_at >= created_at)
);
CREATE INDEX IF NOT EXISTS idx_nf_ai_design_runtime_project
  ON nf_ai_design_workspace_runtimes(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS nf_ai_design_complex_workspaces (
  owner_key_sha256 TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES nf_projects(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  complex_revision BIGINT NOT NULL,
  aggregate_digest TEXT NOT NULL,
  aggregate_json TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY(owner_key_sha256, project_id, session_id),
  CONSTRAINT nf_ai_design_complex_owner_hash_ck CHECK (owner_key_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_ai_design_complex_revision_ck CHECK (complex_revision >= 0),
  CONSTRAINT nf_ai_design_complex_digest_ck CHECK (aggregate_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_ai_design_complex_json_ck CHECK (length(aggregate_json) > 0),
  CONSTRAINT nf_ai_design_complex_time_ck CHECK (updated_at >= created_at)
);
CREATE INDEX IF NOT EXISTS idx_nf_ai_design_complex_project
  ON nf_ai_design_complex_workspaces(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS nf_ai_design_artifacts (
  artifact_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES nf_projects(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  value_json TEXT NOT NULL,
  byte_length BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT nf_ai_design_artifact_kind_ck CHECK (artifact_kind IN (
    'stage', 'evidence_receipt', 'candidate', 'critic_bundle',
    'product_structure', 'cross_domain_graph', 'graph_partition',
    'gauge_bindings', 'constraint_bindings', 'intent_resolution',
    'precision_request', 'precision_receipt'
  )),
  CONSTRAINT nf_ai_design_artifact_hash_ck CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_ai_design_artifact_json_ck CHECK (length(value_json) > 0),
  CONSTRAINT nf_ai_design_artifact_size_ck CHECK (byte_length > 0 AND byte_length <= 8388608),
  CONSTRAINT nf_ai_design_artifact_scope_kind_uq UNIQUE(project_id, session_id, artifact_kind, artifact_id)
);
CREATE INDEX IF NOT EXISTS idx_nf_ai_design_artifact_scope
  ON nf_ai_design_artifacts(project_id, session_id, artifact_kind, created_at DESC);

DROP TRIGGER IF EXISTS nf_ai_design_runtime_identity_immutable ON nf_ai_design_workspace_runtimes;
CREATE TRIGGER nf_ai_design_runtime_identity_immutable
BEFORE UPDATE ON nf_ai_design_workspace_runtimes
FOR EACH ROW EXECUTE FUNCTION nf_commercial_identity_immutable(
  'owner_key_sha256', 'project_id', 'session_id', 'created_at'
);

DROP TRIGGER IF EXISTS nf_ai_design_complex_identity_immutable ON nf_ai_design_complex_workspaces;
CREATE TRIGGER nf_ai_design_complex_identity_immutable
BEFORE UPDATE ON nf_ai_design_complex_workspaces
FOR EACH ROW EXECUTE FUNCTION nf_commercial_identity_immutable(
  'owner_key_sha256', 'project_id', 'session_id', 'created_at'
);

DROP TRIGGER IF EXISTS nf_ai_design_artifact_immutable ON nf_ai_design_artifacts;
CREATE TRIGGER nf_ai_design_artifact_immutable
BEFORE UPDATE OR DELETE ON nf_ai_design_artifacts
FOR EACH ROW EXECUTE FUNCTION nf_commercial_append_only_row();
