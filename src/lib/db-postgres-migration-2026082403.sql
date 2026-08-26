-- Durable AI Design -> Precision CAD exact-verification bridge.
-- The outbox is mutable only through lease/CAS transitions. Accepted receipts
-- are append-only and never derive manufacturing or release authority.

CREATE TABLE IF NOT EXISTS nf_ai_precision_bridge_outbox (
  job_id TEXT PRIMARY KEY,
  owner_key_sha256 TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES nf_projects(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  handoff_request_id TEXT NOT NULL,
  handoff_sha256 TEXT NOT NULL,
  binding_sha256 TEXT NOT NULL,
  binding_json TEXT NOT NULL,
  precision_request_id TEXT NOT NULL,
  precision_request_sha256 TEXT NOT NULL,
  runtime_revision BIGINT NOT NULL,
  complex_revision BIGINT NOT NULL,
  job_sha256 TEXT NOT NULL,
  job_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_generation BIGINT NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_capability_sha256 TEXT,
  lease_expires_at BIGINT,
  available_at BIGINT NOT NULL,
  last_error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CONSTRAINT nf_ai_precision_bridge_handoff_uq
    UNIQUE(owner_key_sha256, project_id, session_id, handoff_request_id),
  CONSTRAINT nf_ai_precision_bridge_owner_hash_ck CHECK (owner_key_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_ai_precision_bridge_hashes_ck CHECK (
    handoff_sha256 ~ '^[a-f0-9]{64}$'
    AND binding_sha256 ~ '^[a-f0-9]{64}$'
    AND precision_request_sha256 ~ '^[a-f0-9]{64}$'
    AND job_sha256 ~ '^[a-f0-9]{64}$'
    AND (lease_capability_sha256 IS NULL OR lease_capability_sha256 ~ '^[a-f0-9]{64}$')
  ),
  CONSTRAINT nf_ai_precision_bridge_revision_ck CHECK (runtime_revision >= 0 AND complex_revision >= 0),
  CONSTRAINT nf_ai_precision_bridge_status_ck CHECK (status IN (
    'PENDING', 'CLAIMED', 'SENT', 'COMPLETED', 'HOLD', 'VERIFIED_UNKNOWN'
  )),
  CONSTRAINT nf_ai_precision_bridge_lease_ck CHECK (
    (status IN ('CLAIMED', 'SENT') AND lease_owner IS NOT NULL
      AND lease_capability_sha256 IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (status NOT IN ('CLAIMED', 'SENT') AND lease_owner IS NULL
      AND lease_capability_sha256 IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT nf_ai_precision_bridge_time_ck CHECK (
    attempt >= 0 AND lease_generation >= 0 AND available_at >= 0
    AND created_at >= 0 AND updated_at >= created_at
  ),
  CONSTRAINT nf_ai_precision_bridge_json_binding_ck CHECK (
    job_json::jsonb ->> 'jobId' = job_id
    AND job_json::jsonb ->> 'projectId' = project_id
    AND job_json::jsonb ->> 'sessionId' = session_id
    AND job_json::jsonb ->> 'precisionRequestId' = precision_request_id
    AND job_json::jsonb ->> 'precisionRequestSha256' = precision_request_sha256
    AND job_json::jsonb ->> 'jobSha256' = job_sha256
    AND job_json::jsonb ->> 'exactExecution' = 'NOT_RUN'
    AND job_json::jsonb ->> 'manufacturingReleaseReady' = 'false'
    AND binding_json::jsonb ->> 'bindingSha256' = binding_sha256
    AND binding_json::jsonb ->> 'projectId' = project_id
    AND binding_json::jsonb ->> 'exactExecution' = 'NOT_RUN'
    AND binding_json::jsonb ->> 'manufacturingReleaseReady' = 'false'
  )
);
CREATE INDEX IF NOT EXISTS idx_nf_ai_precision_bridge_claim
  ON nf_ai_precision_bridge_outbox(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_nf_ai_precision_bridge_scope
  ON nf_ai_precision_bridge_outbox(project_id, session_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_nf_ai_precision_bridge_lease
  ON nf_ai_precision_bridge_outbox(status, lease_expires_at)
  WHERE status IN ('CLAIMED', 'SENT');

CREATE TABLE IF NOT EXISTS nf_ai_precision_bridge_receipts (
  receipt_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  precision_request_id TEXT NOT NULL,
  precision_request_sha256 TEXT NOT NULL,
  exact_artifact_sha256 TEXT,
  receipt_sha256 TEXT NOT NULL UNIQUE,
  receipt_json TEXT NOT NULL,
  artifact_manifest_json TEXT NOT NULL,
  accepted_at BIGINT NOT NULL,
  CONSTRAINT nf_ai_precision_bridge_receipt_job_uq UNIQUE(job_id),
  CONSTRAINT nf_ai_precision_bridge_receipt_job_fk FOREIGN KEY(job_id)
    REFERENCES nf_ai_precision_bridge_outbox(job_id) ON DELETE RESTRICT,
  CONSTRAINT nf_ai_precision_bridge_receipt_request_fk FOREIGN KEY(precision_request_id)
    REFERENCES nf_ai_design_artifacts(artifact_id) ON DELETE RESTRICT,
  CONSTRAINT nf_ai_precision_bridge_receipt_hashes_ck CHECK (
    precision_request_sha256 ~ '^[a-f0-9]{64}$'
    AND (exact_artifact_sha256 IS NULL OR exact_artifact_sha256 ~ '^[a-f0-9]{64}$')
    AND receipt_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT nf_ai_precision_bridge_receipt_authority_ck CHECK (
    receipt_json::jsonb ->> 'schema' = 'nexyfab.ai-design-precision-verification-receipt.v1'
    AND receipt_json::jsonb ->> 'receiptId' = receipt_id
    AND receipt_json::jsonb ->> 'requestId' = precision_request_id
    AND receipt_json::jsonb ->> 'requestDigest' = precision_request_sha256
    AND receipt_json::jsonb ->> 'projectId' = project_id
    AND receipt_json::jsonb ->> 'sessionId' = session_id
    AND receipt_json::jsonb ->> 'receiptDigest' = receipt_sha256
    AND receipt_json::jsonb ->> 'manufacturingReleaseReady' = 'false'
    AND (
      (receipt_json::jsonb ->> 'status' = 'PASS' AND exact_artifact_sha256 IS NOT NULL)
      OR (receipt_json::jsonb ->> 'status' = 'FAIL' AND exact_artifact_sha256 IS NULL)
    )
  )
);
CREATE INDEX IF NOT EXISTS idx_nf_ai_precision_bridge_receipt_scope
  ON nf_ai_precision_bridge_receipts(project_id, session_id, accepted_at DESC);

DROP TRIGGER IF EXISTS nf_ai_precision_bridge_outbox_identity_immutable ON nf_ai_precision_bridge_outbox;
CREATE TRIGGER nf_ai_precision_bridge_outbox_identity_immutable
BEFORE UPDATE ON nf_ai_precision_bridge_outbox
FOR EACH ROW EXECUTE FUNCTION nf_commercial_identity_immutable(
  'job_id', 'owner_key_sha256', 'project_id', 'session_id', 'candidate_id',
  'handoff_request_id', 'handoff_sha256', 'binding_sha256', 'binding_json',
  'precision_request_id', 'precision_request_sha256', 'runtime_revision',
  'complex_revision', 'job_sha256', 'job_json', 'created_at'
);

DROP TRIGGER IF EXISTS nf_ai_precision_bridge_receipt_immutable ON nf_ai_precision_bridge_receipts;
CREATE TRIGGER nf_ai_precision_bridge_receipt_immutable
BEFORE UPDATE OR DELETE ON nf_ai_precision_bridge_receipts
FOR EACH ROW EXECUTE FUNCTION nf_commercial_append_only_row();

CREATE OR REPLACE FUNCTION nf_ai_precision_bridge_receipt_binding_guard_fn()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM nf_ai_precision_bridge_outbox o
    WHERE o.job_id = NEW.job_id
      AND o.project_id = NEW.project_id
      AND o.session_id = NEW.session_id
      AND o.precision_request_id = NEW.precision_request_id
      AND o.precision_request_sha256 = NEW.precision_request_sha256
      AND o.status IN ('CLAIMED', 'SENT', 'VERIFIED_UNKNOWN')
  ) THEN
    RAISE EXCEPTION 'AI precision receipt outbox binding invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM nf_ai_design_artifacts a
    WHERE a.artifact_id = NEW.precision_request_id
      AND a.project_id = NEW.project_id
      AND a.session_id = NEW.session_id
      AND a.artifact_kind = 'precision_request'
      AND a.value_json::jsonb ->> 'requestDigest' = NEW.precision_request_sha256
  ) THEN
    RAISE EXCEPTION 'AI precision request artifact binding invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM nf_ai_design_artifacts a
    WHERE a.artifact_id = NEW.receipt_id
      AND a.project_id = NEW.project_id
      AND a.session_id = NEW.session_id
      AND a.artifact_kind = 'precision_receipt'
      AND a.value_json::jsonb ->> 'receiptDigest' = NEW.receipt_sha256
  ) THEN
    RAISE EXCEPTION 'AI precision receipt artifact binding invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM nf_ai_design_complex_workspaces c
    JOIN nf_ai_precision_bridge_outbox o ON o.job_id = NEW.job_id
    CROSS JOIN LATERAL jsonb_array_elements(c.aggregate_json::jsonb -> 'precisionReceipts') r
    WHERE c.owner_key_sha256 = o.owner_key_sha256
      AND c.project_id = NEW.project_id
      AND c.session_id = NEW.session_id
      AND r ->> 'artifactId' = NEW.receipt_id
      AND r ->> 'artifactDigest' = NEW.receipt_sha256
  ) THEN
    RAISE EXCEPTION 'AI precision aggregate receipt binding invalid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nf_ai_precision_bridge_receipt_binding_guard ON nf_ai_precision_bridge_receipts;
CREATE TRIGGER nf_ai_precision_bridge_receipt_binding_guard
BEFORE INSERT ON nf_ai_precision_bridge_receipts
FOR EACH ROW EXECUTE FUNCTION nf_ai_precision_bridge_receipt_binding_guard_fn();
