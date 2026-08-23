-- Immutable, project/revision-bound records for browser Precision CAD reports
-- and previews. Exact STEP/B-rep promotion remains owned by the trusted CAD
-- job receipt path; this table records only the server-produced result links.
CREATE TABLE IF NOT EXISTS nf_precision_cad_result_artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  result_sha256 TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  exact_geometry INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  immutability_state TEXT NOT NULL,
  UNIQUE(project_id, revision, run_id, call_id, kind, filename, content_sha256)
);

CREATE INDEX IF NOT EXISTS idx_nf_precision_cad_result_project
  ON nf_precision_cad_result_artifacts(project_id, revision, created_at DESC);
