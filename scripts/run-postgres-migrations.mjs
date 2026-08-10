#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export const MIGRATION_VERSION = 2026081001;
export const MIGRATION_NAME = 'postgres_schema_baseline_20260810';
export const ADVISORY_LOCK_KEY = 70658910420260810n;

export function migrationChecksum(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

export function migrationDecision(existing, checksum) {
  if (!existing) return 'apply';
  if (existing.checksum !== checksum) return 'checksum_mismatch';
  return 'already_applied';
}

export async function runPostgresMigration({ databaseUrl, sqlPath }) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const checksum = migrationChecksum(sql);
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
    const result = await client.query(
      'SELECT version, name, checksum FROM nf_schema_migrations WHERE version = $1',
      [MIGRATION_VERSION],
    );
    const decision = migrationDecision(result.rows[0], checksum);
    if (decision === 'checksum_mismatch') throw new Error(`migration_checksum_mismatch:v${MIGRATION_VERSION}`);
    if (decision === 'apply') {
      await client.query(sql);
      await client.query(
        `INSERT INTO nf_schema_migrations(version, name, applied_at, checksum)
         VALUES ($1, $2, $3, $4)`,
        [MIGRATION_VERSION, MIGRATION_NAME, Date.now(), checksum],
      );
    }
    await client.query('COMMIT');
    return { ok: true, version: MIGRATION_VERSION, name: MIGRATION_NAME, checksum, decision };
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
