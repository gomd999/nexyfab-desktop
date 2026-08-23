-- External verifier evidence exchange. Append-only records; no public verifier URL or raw bytes.
CREATE TABLE IF NOT EXISTS nf_external_commercial_evidence (
  evidence_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  execution_id TEXT NOT NULL REFERENCES nf_precision_cad_execution_journal(execution_id),
  generation_run_id TEXT NOT NULL,
  revision BIGINT NOT NULL,
  model_content_hash TEXT NOT NULL,
  target_sha256 TEXT NOT NULL,
  evidence_role TEXT NOT NULL,
  object_key TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  content_size BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE (tenant_id, project_id, evidence_id),
  CONSTRAINT nf_external_evidence_revision_ck CHECK (revision >= 0),
  CONSTRAINT nf_external_evidence_size_ck CHECK (content_size > 0 AND content_size <= 16777216)
);
CREATE INDEX IF NOT EXISTS idx_nf_external_evidence_binding ON nf_external_commercial_evidence (tenant_id, project_id, execution_id, generation_run_id, revision, target_sha256);

CREATE TABLE IF NOT EXISTS nf_external_commercial_verification_requests (
  request_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  execution_id TEXT NOT NULL REFERENCES nf_precision_cad_execution_journal(execution_id),
  generation_run_id TEXT NOT NULL,
  revision BIGINT NOT NULL,
  model_content_hash TEXT NOT NULL,
  target_sha256 TEXT NOT NULL,
  evidence_manifest_sha256 TEXT NOT NULL,
  request_sha256 TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL,
  status TEXT NOT NULL,
  sequence BIGINT NOT NULL,
  issued_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CONSTRAINT nf_external_request_status_ck CHECK (status IN ('PENDING','HOLD','VERIFIED')),
  CONSTRAINT nf_external_request_sequence_ck CHECK (sequence >= 0),
  CONSTRAINT nf_external_request_dates_ck CHECK (expires_at > issued_at)
);
CREATE INDEX IF NOT EXISTS idx_nf_external_request_queue ON nf_external_commercial_verification_requests (status, expires_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_nf_external_request_binding ON nf_external_commercial_verification_requests (tenant_id, project_id, execution_id, generation_run_id, revision, target_sha256);

CREATE TABLE IF NOT EXISTS nf_external_commercial_verifier_claims (
  request_id TEXT PRIMARY KEY REFERENCES nf_external_commercial_verification_requests(request_id),
  verifier_key_id TEXT NOT NULL,
  verifier_fingerprint_sha256 TEXT NOT NULL,
  lease_id TEXT NOT NULL UNIQUE,
  claimed_at BIGINT NOT NULL,
  lease_expires_at BIGINT NOT NULL,
  status TEXT NOT NULL,
  CONSTRAINT nf_external_claim_status_ck CHECK (status IN ('CLAIMED','RELEASED','EXPIRED'))
);

CREATE TABLE IF NOT EXISTS nf_external_commercial_verifier_callbacks (
  request_id TEXT NOT NULL REFERENCES nf_external_commercial_verification_requests(request_id),
  sequence BIGINT NOT NULL,
  callback_sha256 TEXT NOT NULL UNIQUE,
  claim_lease_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  fingerprint_sha256 TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  evidence_manifest_sha256 TEXT NOT NULL,
  final_receipt_sha256 TEXT NOT NULL,
  callback_json TEXT NOT NULL,
  issued_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  received_at BIGINT NOT NULL,
  PRIMARY KEY (request_id, sequence),
  CONSTRAINT nf_external_callback_sequence_ck CHECK (sequence > 0)
);
