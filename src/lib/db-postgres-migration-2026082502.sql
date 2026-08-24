-- NexyFab commercial Precision CAD immutable worker I/O migration v2026082502.
--
-- Execution contract v3 binds one content-addressed input object to every job
-- and requires all three worker outputs to be uploaded and hash-committed
-- before a signed callback can be accepted. Legacy non-terminal v2 work is
-- quarantined rather than replayed without an executable input.

UPDATE nf_precision_cad_commercial_outbox
SET status = 'HOLD',
    last_error = 'commercial_execution_v3_input_required',
    updated_at = floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
WHERE status IN ('PENDING', 'CLAIMED', 'SENT')
  AND COALESCE(job_json::jsonb ->> 'contractVersion', '') <> 'nexyfab.precision-cad-commercial-execution.v3';

CREATE TABLE IF NOT EXISTS nf_precision_cad_commercial_input_artifacts (
  job_id TEXT PRIMARY KEY REFERENCES nf_precision_cad_commercial_outbox(job_id),
  execution_id TEXT NOT NULL UNIQUE REFERENCES nf_precision_cad_execution_journal(execution_id),
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  content_sha256 TEXT NOT NULL,
  byte_length BIGINT NOT NULL,
  media_type TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT nf_precision_cad_input_hash_ck CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_precision_cad_input_private_key_ck CHECK (
    object_key LIKE 'private/commercial-precision-inputs/%'
    AND position('..' in object_key) = 0
    AND position(chr(92) in object_key) = 0
    AND position('://' in object_key) = 0
  ),
  CONSTRAINT nf_precision_cad_input_size_ck CHECK (byte_length > 0 AND byte_length <= 524288),
  CONSTRAINT nf_precision_cad_input_media_ck CHECK (media_type = 'application/json')
);

CREATE TABLE IF NOT EXISTS nf_precision_cad_commercial_output_intents (
  job_id TEXT NOT NULL REFERENCES nf_precision_cad_commercial_outbox(job_id),
  execution_id TEXT NOT NULL REFERENCES nf_precision_cad_execution_journal(execution_id),
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  worker_identity TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_role TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_sha256 TEXT NOT NULL,
  byte_length BIGINT NOT NULL,
  media_type TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  committed_at BIGINT,
  PRIMARY KEY (job_id, artifact_role),
  UNIQUE (execution_id, artifact_id),
  CONSTRAINT nf_precision_cad_output_role_ck CHECK (artifact_role IN ('model', 'report', 'verification')),
  CONSTRAINT nf_precision_cad_output_hash_ck CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_precision_cad_output_private_key_ck CHECK (
    object_key LIKE 'private/commercial-precision-outputs/%'
    AND position('..' in object_key) = 0
    AND position(chr(92) in object_key) = 0
    AND position('://' in object_key) = 0
  ),
  CONSTRAINT nf_precision_cad_output_size_ck CHECK (byte_length > 0 AND byte_length <= 67108864),
  CONSTRAINT nf_precision_cad_output_media_ck CHECK (media_type IN ('application/step', 'model/step', 'application/json')),
  CONSTRAINT nf_precision_cad_output_status_ck CHECK (status IN ('PENDING', 'COMMITTED')),
  CONSTRAINT nf_precision_cad_output_commit_time_ck CHECK (
    (status = 'PENDING' AND committed_at IS NULL)
    OR (status = 'COMMITTED' AND committed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_nf_precision_cad_commercial_output_execution
  ON nf_precision_cad_commercial_output_intents(execution_id, status);

CREATE OR REPLACE FUNCTION nf_precision_cad_commercial_input_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'commercial input artifacts are append-only';
END;
$$;

DROP TRIGGER IF EXISTS nf_precision_cad_commercial_input_immutable ON nf_precision_cad_commercial_input_artifacts;
CREATE TRIGGER nf_precision_cad_commercial_input_immutable
  BEFORE UPDATE OR DELETE ON nf_precision_cad_commercial_input_artifacts
  FOR EACH ROW EXECUTE FUNCTION nf_precision_cad_commercial_input_immutable();

CREATE OR REPLACE FUNCTION nf_precision_cad_commercial_output_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'commercial output intents cannot be deleted';
  END IF;
  IF OLD.job_id IS DISTINCT FROM NEW.job_id
    OR OLD.execution_id IS DISTINCT FROM NEW.execution_id
    OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.worker_identity IS DISTINCT FROM NEW.worker_identity
    OR OLD.artifact_id IS DISTINCT FROM NEW.artifact_id
    OR OLD.artifact_role IS DISTINCT FROM NEW.artifact_role
    OR OLD.object_key IS DISTINCT FROM NEW.object_key
    OR OLD.content_sha256 IS DISTINCT FROM NEW.content_sha256
    OR OLD.byte_length IS DISTINCT FROM NEW.byte_length
    OR OLD.media_type IS DISTINCT FROM NEW.media_type
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.status <> 'PENDING'
    OR NEW.status <> 'COMMITTED'
    OR OLD.committed_at IS NOT NULL
    OR NEW.committed_at IS NULL THEN
    RAISE EXCEPTION 'commercial output intent identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nf_precision_cad_commercial_output_identity_guard ON nf_precision_cad_commercial_output_intents;
CREATE TRIGGER nf_precision_cad_commercial_output_identity_guard
  BEFORE UPDATE OR DELETE ON nf_precision_cad_commercial_output_intents
  FOR EACH ROW EXECUTE FUNCTION nf_precision_cad_commercial_output_identity_guard();
