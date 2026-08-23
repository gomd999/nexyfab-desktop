-- Authoritative precision-CAD canonical part -> runtime OCCT handle mapping.
-- The immutable workspace/artifact hashes identify the source record. The
-- runtime handle is process-local and may be replaced only by server-side
-- OCCT rehydration after a restart; clients never write mapping_json.
CREATE TABLE IF NOT EXISTS nf_cad_canonical_brep_mappings (
  id TEXT PRIMARY KEY,
  source_record_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workspace_revision BIGINT NOT NULL,
  workspace_content_hash TEXT NOT NULL,
  geometry_content_hash TEXT NOT NULL,
  shape_identity_hash TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_content_hash TEXT NOT NULL,
  artifact_shape_identity_hash TEXT NOT NULL,
  mapping_json TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(project_id, workspace_id, workspace_revision,
    workspace_content_hash, geometry_content_hash, shape_identity_hash),
  CONSTRAINT nf_cad_canonical_brep_revision_ck CHECK (workspace_revision >= 0),
  CONSTRAINT nf_cad_canonical_brep_workspace_hash_ck CHECK (workspace_content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_cad_canonical_brep_geometry_hash_ck CHECK (geometry_content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_cad_canonical_brep_shape_hash_ck CHECK (shape_identity_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_cad_canonical_brep_artifact_hash_ck CHECK (artifact_content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_cad_canonical_brep_artifact_shape_hash_ck CHECK (artifact_shape_identity_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT nf_cad_canonical_brep_mapping_json_ck CHECK (length(mapping_json) > 0)
);

CREATE INDEX IF NOT EXISTS idx_nf_cad_canonical_brep_mapping_project
  ON nf_cad_canonical_brep_mappings(project_id, workspace_revision DESC);
CREATE INDEX IF NOT EXISTS idx_nf_cad_canonical_brep_mapping_artifact
  ON nf_cad_canonical_brep_mappings(project_id, artifact_id);

-- Identity is append-only. Only mapping_json/updated_at may change when a
-- stale process-local OCCT handle is rehydrated by the server.
DROP TRIGGER IF EXISTS nf_cad_canonical_brep_mapping_identity_immutable ON nf_cad_canonical_brep_mappings;
CREATE TRIGGER nf_cad_canonical_brep_mapping_identity_immutable
BEFORE UPDATE ON nf_cad_canonical_brep_mappings
FOR EACH ROW EXECUTE FUNCTION nf_commercial_identity_immutable(
  'id', 'source_record_id', 'project_id', 'workspace_id', 'workspace_revision',
  'workspace_content_hash', 'geometry_content_hash', 'shape_identity_hash',
  'artifact_id', 'artifact_content_hash', 'artifact_shape_identity_hash', 'created_at'
);
