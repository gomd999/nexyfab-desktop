-- Authoritative commercial persistence. Immutable, versioned, PostgreSQL-only.
CREATE TABLE IF NOT EXISTS nf_precision_cad_commercial_artifact_snapshots (
  execution_id TEXT NOT NULL REFERENCES nf_precision_cad_execution_journal(execution_id),
  worker_receipt_hash TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_role TEXT NOT NULL,
  source_object_key TEXT NOT NULL,
  snapshot_object_key TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  byte_length BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (execution_id, artifact_id),
  UNIQUE (snapshot_object_key),
  CHECK (artifact_role IN ('model','report','verification')),
  CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (worker_receipt_hash ~ '^[a-f0-9]{64}$'),
  CHECK (snapshot_object_key LIKE 'private/commercial-snapshots/%'),
  CHECK (byte_length > 0 AND byte_length <= 67108864)
);
CREATE INDEX IF NOT EXISTS idx_nf_precision_cad_snapshot_receipt ON nf_precision_cad_commercial_artifact_snapshots (execution_id, worker_receipt_hash);

CREATE TABLE IF NOT EXISTS nf_precision_cad_commercial_worker_artifacts (
  execution_id TEXT NOT NULL REFERENCES nf_precision_cad_execution_journal(execution_id),
  artifact_id TEXT NOT NULL,
  artifact_role TEXT NOT NULL,
  object_key TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  byte_length BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (execution_id, artifact_id),
  CHECK (artifact_role IN ('model','report','verification')),
  CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (byte_length > 0 AND byte_length <= 67108864)
);

CREATE TABLE IF NOT EXISTS nf_precision_cad_commercial_native_parser_receipts (
  execution_id TEXT PRIMARY KEY REFERENCES nf_precision_cad_execution_journal(execution_id),
  worker_receipt_hash TEXT NOT NULL,
  parser_receipt_hash TEXT NOT NULL UNIQUE,
  receipt_json TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  model_artifact_id TEXT NOT NULL,
  workspace_envelope_artifact_id TEXT NOT NULL,
  format TEXT NOT NULL,
  kernel_identity TEXT NOT NULL,
  target_hash TEXT NOT NULL,
  workspace_after_revision BIGINT NOT NULL,
  workspace_after_content_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  CHECK (parser_receipt_hash ~ '^[a-f0-9]{64}$'),
  CHECK (target_hash ~ '^[a-f0-9]{64}$'),
  CHECK (workspace_after_content_hash ~ '^[a-f0-9]{64}$')
);

CREATE TABLE IF NOT EXISTS nf_precision_cad_commercial_persistence_receipts (
  execution_id TEXT PRIMARY KEY REFERENCES nf_precision_cad_execution_journal(execution_id),
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  generation_run_id TEXT NOT NULL,
  worker_receipt_hash TEXT NOT NULL,
  parser_receipt_hash TEXT NOT NULL,
  persistence_receipt_hash TEXT NOT NULL UNIQUE,
  manifest_sha256 TEXT NOT NULL,
  workspace_before_revision BIGINT NOT NULL,
  workspace_before_content_hash TEXT NOT NULL,
  workspace_after_revision BIGINT NOT NULL,
  workspace_after_content_hash TEXT NOT NULL,
  target_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  CHECK (persistence_receipt_hash ~ '^[a-f0-9]{64}$'),
  CHECK (workspace_after_revision > workspace_before_revision),
  CHECK (workspace_before_content_hash ~ '^[a-f0-9]{64}$'),
  CHECK (workspace_after_content_hash ~ '^[a-f0-9]{64}$'),
  CHECK (target_hash ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nf_precision_cad_persistence_binding ON nf_precision_cad_commercial_persistence_receipts (tenant_id, project_id, execution_id, generation_run_id, target_hash);

CREATE TABLE IF NOT EXISTS nf_precision_cad_commercial_workspace_commits (
  execution_id TEXT PRIMARY KEY REFERENCES nf_precision_cad_execution_journal(execution_id),
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  before_revision BIGINT NOT NULL,
  before_content_hash TEXT NOT NULL,
  after_revision BIGINT NOT NULL,
  after_content_hash TEXT NOT NULL,
  target_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  CHECK (after_revision > before_revision),
  CHECK (before_content_hash ~ '^[a-f0-9]{64}$'),
  CHECK (after_content_hash ~ '^[a-f0-9]{64}$'),
  CHECK (target_hash ~ '^[a-f0-9]{64}$')
);

CREATE OR REPLACE FUNCTION nf_precision_cad_commercial_immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'commercial persistence rows are append-only';
END;
$$;
DROP TRIGGER IF EXISTS nf_precision_cad_snapshot_immutable ON nf_precision_cad_commercial_artifact_snapshots;
CREATE TRIGGER nf_precision_cad_snapshot_immutable BEFORE UPDATE OR DELETE ON nf_precision_cad_commercial_artifact_snapshots FOR EACH ROW EXECUTE FUNCTION nf_precision_cad_commercial_immutable_row();
DROP TRIGGER IF EXISTS nf_precision_cad_worker_artifacts_immutable ON nf_precision_cad_commercial_worker_artifacts;
CREATE TRIGGER nf_precision_cad_worker_artifacts_immutable BEFORE UPDATE OR DELETE ON nf_precision_cad_commercial_worker_artifacts FOR EACH ROW EXECUTE FUNCTION nf_precision_cad_commercial_immutable_row();
DROP TRIGGER IF EXISTS nf_precision_cad_parser_receipt_immutable ON nf_precision_cad_commercial_native_parser_receipts;
CREATE TRIGGER nf_precision_cad_parser_receipt_immutable BEFORE UPDATE OR DELETE ON nf_precision_cad_commercial_native_parser_receipts FOR EACH ROW EXECUTE FUNCTION nf_precision_cad_commercial_immutable_row();
DROP TRIGGER IF EXISTS nf_precision_cad_persistence_receipt_immutable ON nf_precision_cad_commercial_persistence_receipts;
CREATE TRIGGER nf_precision_cad_persistence_receipt_immutable BEFORE UPDATE OR DELETE ON nf_precision_cad_commercial_persistence_receipts FOR EACH ROW EXECUTE FUNCTION nf_precision_cad_commercial_immutable_row();
DROP TRIGGER IF EXISTS nf_precision_cad_workspace_commit_immutable ON nf_precision_cad_commercial_workspace_commits;
CREATE TRIGGER nf_precision_cad_workspace_commit_immutable BEFORE UPDATE OR DELETE ON nf_precision_cad_commercial_workspace_commits FOR EACH ROW EXECUTE FUNCTION nf_precision_cad_commercial_immutable_row();
