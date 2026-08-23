-- Immutable commercial Precision CAD execution boundary.
-- Applied only by scripts/run-postgres-migrations.mjs (never from a request).
CREATE TABLE IF NOT EXISTS nf_precision_cad_execution_journal (
  execution_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workspace_revision BIGINT NOT NULL,
  workspace_content_hash TEXT NOT NULL,
  command_hash TEXT NOT NULL,
  approval_hash TEXT,
  persistence_receipt_hash TEXT,
  verification_receipt_hash TEXT,
  lifecycle TEXT NOT NULL,
  version BIGINT NOT NULL,
  receipt_json TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  lease_owner_id TEXT,
  lease_expires_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CONSTRAINT nf_precision_cad_journal_lifecycle_ck CHECK (lifecycle IN ('PLANNED','APPROVED','EXECUTING','COMMITTED','FAILED','ROLLED_BACK','VERIFIED_UNKNOWN')),
  CONSTRAINT nf_precision_cad_journal_version_ck CHECK (version >= 0)
);
CREATE INDEX IF NOT EXISTS idx_nf_precision_cad_journal_lease ON nf_precision_cad_execution_journal (lifecycle, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_nf_precision_cad_journal_project ON nf_precision_cad_execution_journal (project_id, workspace_revision);

CREATE TABLE IF NOT EXISTS nf_precision_cad_approval_challenges (
  challenge_id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  role TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workspace_revision BIGINT NOT NULL,
  workspace_content_hash TEXT NOT NULL,
  tool TEXT NOT NULL,
  scope TEXT NOT NULL,
  call_id TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  command_hash TEXT NOT NULL,
  issued_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  mac TEXT NOT NULL,
  consumed_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_nf_precision_cad_challenges_expiry ON nf_precision_cad_approval_challenges (expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS nf_precision_cad_execution_events (
  execution_id TEXT NOT NULL REFERENCES nf_precision_cad_execution_journal(execution_id),
  sequence BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  event_at TEXT NOT NULL,
  data_json TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  PRIMARY KEY (execution_id, sequence),
  UNIQUE (execution_id, event_hash)
);

CREATE TABLE IF NOT EXISTS nf_precision_cad_tool_claims (
  project_id TEXT NOT NULL,
  workspace_revision BIGINT NOT NULL,
  call_id TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  challenge_id TEXT NOT NULL REFERENCES nf_precision_cad_approval_challenges(challenge_id),
  execution_id TEXT NOT NULL REFERENCES nf_precision_cad_execution_journal(execution_id),
  claimed_at BIGINT NOT NULL,
  PRIMARY KEY (project_id, workspace_revision, call_id),
  UNIQUE (execution_id)
);
CREATE INDEX IF NOT EXISTS idx_nf_precision_cad_claims_execution ON nf_precision_cad_tool_claims (execution_id);
CREATE INDEX IF NOT EXISTS idx_nf_precision_cad_claims_challenge ON nf_precision_cad_tool_claims (challenge_id);

CREATE TABLE IF NOT EXISTS nf_precision_cad_worker_receipts (
  execution_id TEXT PRIMARY KEY REFERENCES nf_precision_cad_execution_journal(execution_id),
  worker_receipt_hash TEXT NOT NULL,
  persistence_receipt_hash TEXT,
  verification_receipt_hash TEXT,
  worker_status TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS nf_agentic_commercial_receipts (
  receipt_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  generation_run_id TEXT NOT NULL,
  target_sha256 TEXT NOT NULL,
  receipt_sha256 TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  byte_length BIGINT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT nf_agentic_commercial_receipt_bytes_ck CHECK (byte_length > 0 AND byte_length <= 67108864)
);
CREATE INDEX IF NOT EXISTS idx_nf_agentic_commercial_receipts_target ON nf_agentic_commercial_receipts (tenant_id, project_id, target_sha256);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nf_agentic_commercial_receipts_execution_run ON nf_agentic_commercial_receipts (tenant_id, project_id, execution_id, generation_run_id, target_sha256);
