-- External durable commercial execution v2. Immutable; applied by the shared versioned runner.
CREATE TABLE IF NOT EXISTS nf_precision_cad_commercial_outbox (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  execution_id TEXT NOT NULL REFERENCES nf_precision_cad_execution_journal(execution_id),
  generation_run_id TEXT NOT NULL,
  job_hash TEXT NOT NULL,
  job_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt BIGINT NOT NULL,
  lease_generation BIGINT NOT NULL,
  lease_owner TEXT,
  lease_expires_at BIGINT,
  capability_hash TEXT,
  available_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  last_error TEXT,
  UNIQUE (tenant_id, project_id, execution_id, generation_run_id),
  CONSTRAINT nf_precision_cad_outbox_status_ck CHECK (status IN ('PENDING','CLAIMED','SENT','HOLD','DONE','VERIFIED_UNKNOWN')),
  CONSTRAINT nf_precision_cad_outbox_attempt_ck CHECK (attempt >= 1),
  CONSTRAINT nf_precision_cad_outbox_generation_ck CHECK (lease_generation >= 1)
  ,CONSTRAINT nf_precision_cad_outbox_job_hash_ck CHECK (job_hash ~ '^[a-f0-9]{64}$')
  ,CONSTRAINT nf_precision_cad_outbox_capability_hash_ck CHECK (capability_hash IS NULL OR capability_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_nf_precision_cad_outbox_ready ON nf_precision_cad_commercial_outbox (status, available_at, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_nf_precision_cad_outbox_execution ON nf_precision_cad_commercial_outbox (tenant_id, project_id, execution_id);

CREATE TABLE IF NOT EXISTS nf_precision_cad_commercial_callbacks (
  execution_id TEXT PRIMARY KEY REFERENCES nf_precision_cad_execution_journal(execution_id),
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  generation_run_id TEXT NOT NULL,
  journal_version BIGINT NOT NULL,
  lease_generation BIGINT NOT NULL,
  attempt BIGINT NOT NULL,
  receipt_hash TEXT NOT NULL UNIQUE,
  receipt_json TEXT NOT NULL,
  received_at BIGINT NOT NULL,
  status TEXT NOT NULL,
  CONSTRAINT nf_precision_cad_callback_status_ck CHECK (status IN ('PASS','FAIL','HOLD','VERIFIED_UNKNOWN'))
  ,CONSTRAINT nf_precision_cad_callback_receipt_hash_ck CHECK (receipt_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_nf_precision_cad_callbacks_binding ON nf_precision_cad_commercial_callbacks (tenant_id, project_id, execution_id, generation_run_id, journal_version, lease_generation, attempt);
