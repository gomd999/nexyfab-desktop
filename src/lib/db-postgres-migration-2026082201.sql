-- Durable browser architecture/interior workspace, derived artifact, and
-- private exact-geometry manifest records. Payloads are immutable revisions;
-- mutable heads only provide compare-and-swap pointers.
CREATE TABLE IF NOT EXISTS nf_architecture_interior_workspace_revisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(tenant_id, project_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_nf_architecture_interior_workspace_revision
  ON nf_architecture_interior_workspace_revisions(tenant_id, project_id, revision DESC);

CREATE TABLE IF NOT EXISTS nf_architecture_interior_workspace_heads (
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY(tenant_id, project_id)
);

CREATE TABLE IF NOT EXISTS nf_architecture_interior_artifact_bundle_revisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  source_content_hash TEXT NOT NULL,
  bundle_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(tenant_id, project_id, bundle_hash)
);

CREATE INDEX IF NOT EXISTS idx_nf_architecture_interior_artifact_bundle_revision
  ON nf_architecture_interior_artifact_bundle_revisions(tenant_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS nf_architecture_interior_artifact_bundle_heads (
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  source_content_hash TEXT NOT NULL,
  bundle_hash TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY(tenant_id, project_id)
);

CREATE TABLE IF NOT EXISTS nf_architecture_interior_exact_artifact_manifests (
  manifest_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  bundle_hash TEXT NOT NULL,
  byte_length BIGINT NOT NULL,
  object_key TEXT NOT NULL,
  architecture_receipt_hash TEXT NOT NULL,
  architecture_evidence_hash TEXT NOT NULL,
  interior_receipt_hash TEXT NOT NULL,
  interior_evidence_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  immutability_state TEXT NOT NULL,
  UNIQUE(tenant_id, project_id, revision, bundle_hash)
);

CREATE INDEX IF NOT EXISTS idx_nf_architecture_interior_exact_artifact_manifest_scope
  ON nf_architecture_interior_exact_artifact_manifests(tenant_id, project_id, revision DESC);
