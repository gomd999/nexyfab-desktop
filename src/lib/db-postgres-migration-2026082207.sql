-- Authoritative commercial generation runs and receipt bindings. Append-only revisions with CAS head.
CREATE TABLE IF NOT EXISTS nf_commercial_generation_runs (
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workspace_revision BIGINT NOT NULL,
  head_revision BIGINT NOT NULL,
  head_sha256 TEXT NOT NULL,
  state_sha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, project_id, run_id),
  CONSTRAINT nf_commercial_generation_run_status_ck CHECK (status IN ('ACTIVE','HOLD','COMPLETE','FAILED')),
  CONSTRAINT nf_commercial_generation_run_revision_ck CHECK (head_revision >= 0),
  CONSTRAINT nf_commercial_generation_workspace_revision_ck CHECK (workspace_revision >= 0),
  CONSTRAINT nf_commercial_generation_run_head_sha_ck CHECK (head_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_commercial_generation_run_state_sha_ck CHECK (state_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE TABLE IF NOT EXISTS nf_commercial_generation_revisions (
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  revision BIGINT NOT NULL,
  previous_revision BIGINT NOT NULL,
  previous_sha256 TEXT NOT NULL,
  state_sha256 TEXT NOT NULL,
  state_json TEXT NOT NULL,
  generation_program_sha256 TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, project_id, run_id, revision),
  UNIQUE (tenant_id, project_id, run_id, revision, state_sha256),
  UNIQUE (tenant_id, project_id, run_id, previous_revision, previous_sha256),
  FOREIGN KEY (tenant_id, project_id, run_id) REFERENCES nf_commercial_generation_runs(tenant_id, project_id, run_id),
  CONSTRAINT nf_commercial_generation_revision_chain_ck CHECK (
    (revision = 0 AND previous_revision = -1 AND previous_sha256 = repeat('0', 64))
    OR (revision > previous_revision AND previous_revision >= 0 AND previous_sha256 <> repeat('0', 64))
  ),
  CONSTRAINT nf_commercial_generation_revision_previous_sha_ck CHECK (previous_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_commercial_generation_revision_state_sha_ck CHECK (state_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_commercial_generation_revision_program_sha_ck CHECK (generation_program_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE TABLE IF NOT EXISTS nf_commercial_generation_receipt_bindings (
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  receipt_sha256 TEXT NOT NULL,
  generation_revision BIGINT NOT NULL,
  workspace_revision BIGINT NOT NULL,
  generation_program_sha256 TEXT NOT NULL,
  target_sha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, project_id, run_id, receipt_id),
  UNIQUE (receipt_id),
  UNIQUE (receipt_id, receipt_sha256),
  FOREIGN KEY (tenant_id, project_id, run_id) REFERENCES nf_commercial_generation_runs(tenant_id, project_id, run_id),
  FOREIGN KEY (tenant_id, project_id, run_id, generation_revision) REFERENCES nf_commercial_generation_revisions(tenant_id, project_id, run_id, revision),
  CONSTRAINT nf_commercial_generation_receipt_status_ck CHECK (status IN ('PENDING','VERIFIED','HOLD')),
  CONSTRAINT nf_commercial_generation_receipt_sha_ck CHECK (receipt_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_commercial_generation_receipt_program_sha_ck CHECK (generation_program_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_commercial_generation_receipt_target_sha_ck CHECK (target_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_nf_commercial_generation_receipt_binding ON nf_commercial_generation_receipt_bindings (tenant_id, project_id, run_id, generation_revision, workspace_revision, generation_program_sha256, target_sha256);

CREATE OR REPLACE FUNCTION nf_commercial_generation_predecessor_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.previous_revision = -1 THEN
    IF NEW.revision <> 0 OR NEW.previous_sha256 <> repeat('0', 64) THEN
      RAISE EXCEPTION 'invalid commercial generation genesis';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM nf_commercial_generation_revisions
    WHERE tenant_id = NEW.tenant_id AND project_id = NEW.project_id AND run_id = NEW.run_id
      AND revision = NEW.previous_revision AND state_sha256 = NEW.previous_sha256
  ) THEN
    RAISE EXCEPTION 'commercial generation predecessor missing';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_nf_commercial_generation_predecessor ON nf_commercial_generation_revisions;
CREATE TRIGGER trg_nf_commercial_generation_predecessor BEFORE INSERT ON nf_commercial_generation_revisions FOR EACH ROW EXECUTE FUNCTION nf_commercial_generation_predecessor_guard();

CREATE OR REPLACE FUNCTION nf_commercial_generation_append_only_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'commercial generation evidence is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_nf_commercial_generation_revisions_append_only ON nf_commercial_generation_revisions;
CREATE TRIGGER trg_nf_commercial_generation_revisions_append_only BEFORE UPDATE OR DELETE ON nf_commercial_generation_revisions FOR EACH ROW EXECUTE FUNCTION nf_commercial_generation_append_only_guard();
