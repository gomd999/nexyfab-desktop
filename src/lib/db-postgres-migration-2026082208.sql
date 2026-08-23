-- Commercial database hardening. This migration is append-only; 2202-2207
-- remain immutable. Existing rows are protected with NOT VALID constraints so
-- deployments do not fail while the validator/backfill job inventories legacy
-- data. New rows are checked immediately; production preflight reports the
-- constraint inventory and validation state.

CREATE OR REPLACE FUNCTION nf_commercial_append_only_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'commercial evidence rows are append-only';
END;
$$;

CREATE OR REPLACE FUNCTION nf_commercial_identity_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  identity_column TEXT;
BEGIN
  FOREACH identity_column IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(NEW) -> identity_column) IS DISTINCT FROM (to_jsonb(OLD) -> identity_column) THEN
      RAISE EXCEPTION 'commercial identity column % is immutable', identity_column;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- Events and external evidence/callbacks are write-once. Receipt bindings
-- may transition PENDING -> VERIFIED, but their identity is write-once below.
DROP TRIGGER IF EXISTS nf_precision_cad_execution_journal_identity_immutable ON nf_precision_cad_execution_journal;
CREATE TRIGGER nf_precision_cad_execution_journal_identity_immutable
BEFORE UPDATE ON nf_precision_cad_execution_journal
FOR EACH ROW EXECUTE FUNCTION nf_commercial_identity_immutable(
  'execution_id', 'idempotency_key', 'project_id', 'workspace_id',
  'workspace_revision', 'workspace_content_hash', 'command_hash', 'created_at'
);

DROP TRIGGER IF EXISTS nf_precision_cad_execution_events_immutable ON nf_precision_cad_execution_events;
CREATE TRIGGER nf_precision_cad_execution_events_immutable
BEFORE UPDATE OR DELETE ON nf_precision_cad_execution_events
FOR EACH ROW EXECUTE FUNCTION nf_commercial_append_only_row();

DROP TRIGGER IF EXISTS nf_external_commercial_evidence_immutable ON nf_external_commercial_evidence;
CREATE TRIGGER nf_external_commercial_evidence_immutable
BEFORE UPDATE OR DELETE ON nf_external_commercial_evidence
FOR EACH ROW EXECUTE FUNCTION nf_commercial_append_only_row();

DROP TRIGGER IF EXISTS nf_external_commercial_verifier_callbacks_immutable ON nf_external_commercial_verifier_callbacks;
CREATE TRIGGER nf_external_commercial_verifier_callbacks_immutable
BEFORE UPDATE OR DELETE ON nf_external_commercial_verifier_callbacks
FOR EACH ROW EXECUTE FUNCTION nf_commercial_append_only_row();

DROP TRIGGER IF EXISTS nf_precision_cad_commercial_callbacks_immutable ON nf_precision_cad_commercial_callbacks;
CREATE TRIGGER nf_precision_cad_commercial_callbacks_immutable
BEFORE UPDATE OR DELETE ON nf_precision_cad_commercial_callbacks
FOR EACH ROW EXECUTE FUNCTION nf_commercial_append_only_row();

DROP TRIGGER IF EXISTS nf_commercial_generation_receipt_binding_identity_immutable ON nf_commercial_generation_receipt_bindings;
CREATE TRIGGER nf_commercial_generation_receipt_binding_identity_immutable
BEFORE UPDATE ON nf_commercial_generation_receipt_bindings
FOR EACH ROW EXECUTE FUNCTION nf_commercial_identity_immutable(
  'tenant_id', 'project_id', 'run_id', 'receipt_id', 'generation_revision',
  'workspace_revision', 'generation_program_sha256', 'target_sha256', 'created_at'
);

-- These tables legitimately update lifecycle/status columns, but their
-- tenant/project/run/request identities must never be transplanted.
DROP TRIGGER IF EXISTS nf_external_verification_request_identity_immutable ON nf_external_commercial_verification_requests;
CREATE TRIGGER nf_external_verification_request_identity_immutable
BEFORE UPDATE ON nf_external_commercial_verification_requests
FOR EACH ROW EXECUTE FUNCTION nf_commercial_identity_immutable(
  'request_id', 'tenant_id', 'project_id', 'execution_id', 'generation_run_id',
  'revision', 'model_content_hash', 'target_sha256', 'evidence_manifest_sha256',
  'request_sha256', 'sequence', 'issued_at'
);

DROP TRIGGER IF EXISTS nf_commercial_generation_run_identity_immutable ON nf_commercial_generation_runs;
CREATE TRIGGER nf_commercial_generation_run_identity_immutable
BEFORE UPDATE ON nf_commercial_generation_runs
FOR EACH ROW EXECUTE FUNCTION nf_commercial_identity_immutable(
  'tenant_id', 'project_id', 'run_id', 'workspace_id', 'workspace_revision', 'created_at'
);

-- The private agentic receipt table introduced in 2202 did not bind its
-- execution_id to the journal. NOT VALID keeps legacy rows deployable while
-- enforcing the parent identity for all new receipts immediately.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nf_agentic_commercial_receipts_execution_fk'
      AND conrelid = 'public.nf_agentic_commercial_receipts'::regclass
  ) THEN
    ALTER TABLE nf_agentic_commercial_receipts
      ADD CONSTRAINT nf_agentic_commercial_receipts_execution_fk
      FOREIGN KEY (execution_id)
      REFERENCES nf_precision_cad_execution_journal(execution_id)
      NOT VALID;
  END IF;
END;
$$;

-- Private object keys must remain inside server-owned namespaces. These are
-- NOT VALID for old rows, but reject malformed new rows without a destructive
-- rewrite or cleanup during deployment.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nf_worker_artifact_private_key_ck'
      AND conrelid = 'public.nf_precision_cad_commercial_worker_artifacts'::regclass
  ) THEN
    ALTER TABLE nf_precision_cad_commercial_worker_artifacts
      ADD CONSTRAINT nf_worker_artifact_private_key_ck
      CHECK (object_key LIKE 'private/%' AND position('..' in object_key) = 0 AND position(chr(92) in object_key) = 0 AND position('://' in object_key) = 0)
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nf_external_evidence_private_key_ck'
      AND conrelid = 'public.nf_external_commercial_evidence'::regclass
  ) THEN
    ALTER TABLE nf_external_commercial_evidence
      ADD CONSTRAINT nf_external_evidence_private_key_ck
      CHECK (object_key LIKE 'private/commercial-evidence/%' AND position('..' in object_key) = 0 AND position(chr(92) in object_key) = 0 AND position('://' in object_key) = 0)
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nf_agentic_receipt_private_key_ck'
      AND conrelid = 'public.nf_agentic_commercial_receipts'::regclass
  ) THEN
    ALTER TABLE nf_agentic_commercial_receipts
      ADD CONSTRAINT nf_agentic_receipt_private_key_ck
      CHECK (object_key LIKE 'private/%' AND position('..' in object_key) = 0 AND position(chr(92) in object_key) = 0 AND position('://' in object_key) = 0)
      NOT VALID;
  END IF;
END;
$$;

-- A validation worker may run these statements after legacy rows have been
-- audited. Keeping them explicit makes the NOT VALID -> VALIDATED transition
-- observable and avoids silently claiming that old data was checked here.
-- ALTER TABLE nf_agentic_commercial_receipts
--   VALIDATE CONSTRAINT nf_agentic_commercial_receipts_execution_fk;
-- ALTER TABLE nf_precision_cad_commercial_worker_artifacts
--   VALIDATE CONSTRAINT nf_worker_artifact_private_key_ck;
-- ALTER TABLE nf_external_commercial_evidence
--   VALIDATE CONSTRAINT nf_external_evidence_private_key_ck;
-- ALTER TABLE nf_agentic_commercial_receipts
--   VALIDATE CONSTRAINT nf_agentic_receipt_private_key_ck;
