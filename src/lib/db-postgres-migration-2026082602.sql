CREATE TABLE IF NOT EXISTS nf_ai_design_source_artifacts (
  artifact_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES nf_projects(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  input_kind TEXT NOT NULL CHECK(input_kind IN ('image','drawing_2d')),
  content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  byte_length BIGINT NOT NULL CHECK(byte_length > 0 AND byte_length <= 6291456),
  classification_json TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE(project_id, session_id, artifact_id),
  CHECK(object_key LIKE 'private/%')
);
CREATE INDEX IF NOT EXISTS idx_nf_ai_design_source_scope
  ON nf_ai_design_source_artifacts(project_id, session_id, created_at DESC);

CREATE OR REPLACE FUNCTION nf_ai_design_source_artifact_immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI Design source artifacts are append-only';
END;
$$;
DROP TRIGGER IF EXISTS nf_ai_design_source_artifact_immutable ON nf_ai_design_source_artifacts;
CREATE TRIGGER nf_ai_design_source_artifact_immutable
BEFORE UPDATE OR DELETE ON nf_ai_design_source_artifacts
FOR EACH ROW EXECUTE FUNCTION nf_ai_design_source_artifact_immutable_row();
