-- Binary candidate/final commercial receipt materialization. Immutable server-owned ledger.
CREATE TABLE IF NOT EXISTS nf_agentic_commercial_verified_receipts (
  receipt_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  execution_id TEXT NOT NULL REFERENCES nf_precision_cad_execution_journal(execution_id),
  generation_run_id TEXT NOT NULL,
  revision BIGINT NOT NULL,
  model_content_hash TEXT NOT NULL,
  target_sha256 TEXT NOT NULL,
  artifact_manifest_sha256 TEXT NOT NULL,
  parser_receipt_sha256 TEXT NOT NULL,
  execution_journal_sha256 TEXT NOT NULL,
  candidate_envelope_sha256 TEXT NOT NULL,
  final_envelope_sha256 TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  byte_length BIGINT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT nf_verified_receipt_revision_ck CHECK (revision >= 0),
  CONSTRAINT nf_verified_receipt_size_ck CHECK (byte_length > 0 AND byte_length <= 134217728),
  CONSTRAINT nf_verified_receipt_hashes_ck CHECK (
    model_content_hash ~ '^[a-f0-9]{64}$' AND target_sha256 ~ '^[a-f0-9]{64}$'
    AND artifact_manifest_sha256 ~ '^[a-f0-9]{64}$' AND parser_receipt_sha256 ~ '^[a-f0-9]{64}$'
    AND execution_journal_sha256 ~ '^[a-f0-9]{64}$' AND candidate_envelope_sha256 ~ '^[a-f0-9]{64}$'
    AND final_envelope_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT nf_verified_receipt_private_key_ck CHECK (object_key LIKE 'private/verified-agentic-commercial-receipts/%')
);
CREATE INDEX IF NOT EXISTS idx_nf_verified_receipt_binding ON nf_agentic_commercial_verified_receipts (tenant_id, project_id, execution_id, generation_run_id, revision, target_sha256);

CREATE TABLE IF NOT EXISTS nf_agentic_commercial_verified_ledger (
  final_envelope_sha256 TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES nf_agentic_commercial_verified_receipts(receipt_id),
  candidate_envelope_sha256 TEXT NOT NULL,
  verifier_key_id TEXT NOT NULL,
  verifier_fingerprint_sha256 TEXT NOT NULL,
  committed_at BIGINT NOT NULL
);

CREATE FUNCTION nf_agentic_commercial_verified_immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'verified commercial receipt rows are append-only';
END;
$$;
CREATE TRIGGER nf_agentic_commercial_verified_receipts_immutable BEFORE UPDATE OR DELETE ON nf_agentic_commercial_verified_receipts FOR EACH ROW EXECUTE FUNCTION nf_agentic_commercial_verified_immutable_row();
CREATE TRIGGER nf_agentic_commercial_verified_ledger_immutable BEFORE UPDATE OR DELETE ON nf_agentic_commercial_verified_ledger FOR EACH ROW EXECUTE FUNCTION nf_agentic_commercial_verified_immutable_row();
