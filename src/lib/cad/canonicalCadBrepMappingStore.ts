import type { DbAdapter } from '@/lib/db-adapter';

/** The migration which creates the authoritative mapping store. */
export const CANONICAL_CAD_BREP_MAPPING_MIGRATION_VERSION = 2026082301 as const;
export const CANONICAL_CAD_BREP_MAPPING_TABLE = 'nf_cad_canonical_brep_mappings' as const;

export interface CanonicalCadBrepMappingStoreKey {
  projectId: string;
  workspaceId: string;
  revision: number;
  workspaceContentHash: string;
  geometryContentHash: string;
  shapeIdentityHash: string;
}

export interface CanonicalCadBrepMappingStoreRecord extends CanonicalCadBrepMappingStoreKey {
  id: string;
  sourceRecordId: string;
  artifactId: string;
  artifactContentHash: string;
  artifactShapeIdentityHash: string;
  mappingJson: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * The mapping store is authoritative persistence, not a process cache.  A
 * stale process-local OCCT handle is expected after restart; the hydration
 * adapter re-imports the immutable artifact and CAS-updates mapping_json.
 */
export async function ensureCanonicalCadBrepMappingTables(db: DbAdapter): Promise<void> {
  const commercial = process.env.NEXYFAB_COMMERCIAL_MODE === '1'
    || process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE === '1';
  if (commercial && db.backend !== 'postgres') {
    throw new Error('canonical_cad_brep_mapping_postgres_required');
  }
  if (db.backend === 'sqlite') {
    // SQLite is the local/development backend and follows the existing
    // catch-free CREATE IF NOT EXISTS schema bootstrap convention.
    await db.executeRaw(`
      CREATE TABLE IF NOT EXISTS ${CANONICAL_CAD_BREP_MAPPING_TABLE} (
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
          workspace_content_hash, geometry_content_hash, shape_identity_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_nf_cad_canonical_brep_mapping_project
        ON ${CANONICAL_CAD_BREP_MAPPING_TABLE}(project_id, workspace_revision DESC);
      CREATE INDEX IF NOT EXISTS idx_nf_cad_canonical_brep_mapping_artifact
        ON ${CANONICAL_CAD_BREP_MAPPING_TABLE}(project_id, artifact_id);
    `);
    return;
  }

  // Commercial/Postgres deployments must use the append-only migration path;
  // a web request must never race another replica by issuing DDL or fall back
  // to an in-memory mapping.
  const migration = await db.queryOne<{ version: number; checksum?: string }>(
    'SELECT version, checksum FROM nf_schema_migrations WHERE version = ?',
    CANONICAL_CAD_BREP_MAPPING_MIGRATION_VERSION,
  ).catch(() => undefined);
  const expectedChecksum = process.env.POSTGRES_MIGRATION_CHECKSUM_2026082301?.trim();
  if (!migration || Number(migration.version) !== CANONICAL_CAD_BREP_MAPPING_MIGRATION_VERSION
    || (commercial && !expectedChecksum)
    || (expectedChecksum && migration.checksum !== expectedChecksum)) {
    throw new Error(`canonical_cad_brep_mapping_migration_required:v${CANONICAL_CAD_BREP_MAPPING_MIGRATION_VERSION}`);
  }
  const table = await db.queryOne<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ?`,
    CANONICAL_CAD_BREP_MAPPING_TABLE,
  ).catch(() => undefined);
  if (!table) throw new Error('canonical_cad_brep_mapping_table_missing');
}

function fromRow(row: Record<string, unknown>): CanonicalCadBrepMappingStoreRecord {
  return {
    id: String(row.id),
    sourceRecordId: String(row.source_record_id),
    projectId: String(row.project_id),
    workspaceId: String(row.workspace_id),
    revision: Number(row.workspace_revision),
    workspaceContentHash: String(row.workspace_content_hash),
    geometryContentHash: String(row.geometry_content_hash),
    shapeIdentityHash: String(row.shape_identity_hash),
    artifactId: String(row.artifact_id),
    artifactContentHash: String(row.artifact_content_hash),
    artifactShapeIdentityHash: String(row.artifact_shape_identity_hash),
    mappingJson: String(row.mapping_json),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function readCanonicalCadBrepMapping(
  db: DbAdapter,
  key: CanonicalCadBrepMappingStoreKey,
): Promise<CanonicalCadBrepMappingStoreRecord | null> {
  const row = await db.queryOne<Record<string, unknown>>(
    `SELECT * FROM ${CANONICAL_CAD_BREP_MAPPING_TABLE}
     WHERE project_id = ? AND workspace_id = ? AND workspace_revision = ?
       AND workspace_content_hash = ? AND geometry_content_hash = ?
       AND shape_identity_hash = ?`,
    key.projectId,
    key.workspaceId,
    key.revision,
    key.workspaceContentHash,
    key.geometryContentHash,
    key.shapeIdentityHash,
  );
  return row ? fromRow(row) : null;
}

/**
 * Insert a server-built mapping once.  INSERT OR IGNORE is translated to
 * PostgreSQL's ON CONFLICT DO NOTHING by DbAdapter; the subsequent read makes
 * concurrent callers converge on the one authoritative source record.
 */
export async function insertCanonicalCadBrepMapping(
  db: DbAdapter,
  record: CanonicalCadBrepMappingStoreRecord,
): Promise<CanonicalCadBrepMappingStoreRecord> {
  await db.execute(
    `INSERT OR IGNORE INTO ${CANONICAL_CAD_BREP_MAPPING_TABLE}
      (id, source_record_id, project_id, workspace_id, workspace_revision,
       workspace_content_hash, geometry_content_hash, shape_identity_hash,
       artifact_id, artifact_content_hash, artifact_shape_identity_hash,
       mapping_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    record.id,
    record.sourceRecordId,
    record.projectId,
    record.workspaceId,
    record.revision,
    record.workspaceContentHash,
    record.geometryContentHash,
    record.shapeIdentityHash,
    record.artifactId,
    record.artifactContentHash,
    record.artifactShapeIdentityHash,
    record.mappingJson,
    record.createdAt,
    record.updatedAt,
  );
  const persisted = await readCanonicalCadBrepMapping(db, record);
  if (!persisted) throw new Error('canonical_cad_brep_mapping_insert_not_visible');
  return persisted;
}

/** CAS update used only after a server-side OCCT rehydration. */
export async function updateCanonicalCadBrepMappingRuntime(
  db: DbAdapter,
  record: CanonicalCadBrepMappingStoreRecord,
  mappingJson: string,
  updatedAt: number,
): Promise<CanonicalCadBrepMappingStoreRecord | null> {
  const result = await db.execute(
    `UPDATE ${CANONICAL_CAD_BREP_MAPPING_TABLE}
     SET mapping_json = ?, updated_at = ?
     WHERE id = ? AND source_record_id = ? AND project_id = ? AND workspace_id = ?
       AND workspace_revision = ? AND workspace_content_hash = ?
       AND geometry_content_hash = ? AND shape_identity_hash = ?
       AND artifact_id = ? AND artifact_content_hash = ?
       AND artifact_shape_identity_hash = ? AND mapping_json = ? AND updated_at = ?`,
    mappingJson,
    updatedAt,
    record.id,
    record.sourceRecordId,
    record.projectId,
    record.workspaceId,
    record.revision,
    record.workspaceContentHash,
    record.geometryContentHash,
    record.shapeIdentityHash,
    record.artifactId,
    record.artifactContentHash,
    record.artifactShapeIdentityHash,
    record.mappingJson,
    record.updatedAt,
  );
  const persisted = await readCanonicalCadBrepMapping(db, record);
  if (!persisted) throw new Error('canonical_cad_brep_mapping_update_not_visible');
  return result.changes === 1 ? persisted : null;
}
