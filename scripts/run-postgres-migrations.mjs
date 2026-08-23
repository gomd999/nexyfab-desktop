#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// Never reuse an applied version after db-postgres-migrations.sql changes.
// Earlier versions remain immutable in deployed databases; this version adds
// allow-listed passwordless admin codes and revocable admin sessions.
export const MIGRATION_VERSION = 2026082001;
export const MIGRATION_NAME = 'spatial_cad_revision_identity_and_locks_20260820';
export const ORDERED_MIGRATION_DESCRIPTORS = Object.freeze([
  Object.freeze({ version: MIGRATION_VERSION, name: MIGRATION_NAME, sqlFile: 'src/lib/db-postgres-migrations.sql' }),
  Object.freeze({ version: 2026082002, name: 'interior_placement_documents_20260820', sqlFile: 'src/lib/db-postgres-migration-2026082002.sql' }),
  Object.freeze({ version: 2026082101, name: 'remote_precision_cad_agent_state_20260821', sqlFile: 'src/lib/db-postgres-migration-2026082101.sql' }),
  Object.freeze({ version: 2026082102, name: 'precision_cad_result_artifacts_20260821', sqlFile: 'src/lib/db-postgres-migration-2026082102.sql' }),
  Object.freeze({ version: 2026082201, name: 'architecture_interior_browser_workflow_20260822', sqlFile: 'src/lib/db-postgres-migration-2026082201.sql' }),
  Object.freeze({ version: 2026082202, name: 'commercial_precision_cad_execution_boundary_20260822', sqlFile: 'src/lib/db-postgres-migration-2026082202.sql' }),
  Object.freeze({ version: 2026082203, name: 'commercial_precision_cad_external_execution_20260822', sqlFile: 'src/lib/db-postgres-migration-2026082203.sql' }),
  Object.freeze({ version: 2026082204, name: 'external_commercial_verifier_exchange_20260822', sqlFile: 'src/lib/db-postgres-migration-2026082204.sql' }),
  Object.freeze({ version: 2026082205, name: 'commercial_worker_result_persistence_20260822', sqlFile: 'src/lib/db-postgres-migration-2026082205.sql' }),
  Object.freeze({ version: 2026082206, name: 'verified_agentic_commercial_receipts_20260822', sqlFile: 'src/lib/db-postgres-migration-2026082206.sql' }),
  Object.freeze({ version: 2026082207, name: 'commercial_generation_authoritative_state_20260822', sqlFile: 'src/lib/db-postgres-migration-2026082207.sql' }),
  Object.freeze({ version: 2026082208, name: 'commercial_database_hardening_20260823', sqlFile: 'src/lib/db-postgres-migration-2026082208.sql' }),
  Object.freeze({ version: 2026082301, name: 'precision_cad_canonical_brep_mapping_20260823', sqlFile: 'src/lib/db-postgres-migration-2026082301.sql' }),
]);
export const ADVISORY_LOCK_KEY = 70658910420260820n;

export function migrationChecksum(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

export function migrationDecision(existing, checksum) {
  if (!existing) return 'apply';
  if (existing.checksum !== checksum) return 'checksum_mismatch';
  return 'already_applied';
}

export function orderedMigrationInputs(sqlPath) {
  return ORDERED_MIGRATION_DESCRIPTORS.map((descriptor, index) => ({
    ...descriptor,
    sqlPath: path.resolve(index === 0 && sqlPath ? sqlPath : descriptor.sqlFile),
  }));
}

export async function runPostgresMigration({ databaseUrl, sqlPath }) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const migrations = orderedMigrationInputs(sqlPath).map(descriptor => {
    const sql = fs.readFileSync(descriptor.sqlPath, 'utf8');
    return { ...descriptor, sql, checksum: migrationChecksum(sql) };
  });
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY.toString()]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS nf_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at BIGINT NOT NULL
      )
    `);
    await client.query('ALTER TABLE nf_schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT');
    const results = [];
    for (const migration of migrations) {
      const result = await client.query(
        'SELECT version, name, checksum FROM nf_schema_migrations WHERE version = $1',
        [migration.version],
      );
      const decision = migrationDecision(result.rows[0], migration.checksum);
      if (decision === 'checksum_mismatch') throw new Error(`migration_checksum_mismatch:v${migration.version}`);
      if (decision === 'apply') {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO nf_schema_migrations(version, name, applied_at, checksum)
           VALUES ($1, $2, $3, $4)`,
          [migration.version, migration.name, Date.now(), migration.checksum],
        );
      }
      results.push({ version: migration.version, name: migration.name, checksum: migration.checksum, decision });
    }
    await client.query('COMMIT');
    const latest = results.at(-1);
    return { ok: true, ...latest, migrations: results };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === new URL(`file:///${process.argv[1]?.replaceAll('\\', '/')}`).href) {
  const sqlPath = path.resolve(process.env.POSTGRES_MIGRATION_SQL ?? 'src/lib/db-postgres-migrations.sql');
  runPostgresMigration({ databaseUrl: process.env.DATABASE_URL, sqlPath })
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => {
      process.stderr.write(`[postgres-migrate] ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
