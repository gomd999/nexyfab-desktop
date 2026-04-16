#!/usr/bin/env tsx
/**
 * NexyFab Database Migration CLI
 * Usage:
 *   npx tsx scripts/migrate.ts status     -- show applied/pending migrations
 *   npx tsx scripts/migrate.ts up         -- apply all pending migrations
 *   npx tsx scripts/migrate.ts up N       -- apply up to version N
 *   npx tsx scripts/migrate.ts down N     -- rollback to version N (manual rollback required)
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const ROOT = path.join(__dirname, '..');
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = 'development';

// Load .env.local
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  const command = process.argv[2] ?? 'status';
  const arg = process.argv[3];

  if (process.env.DATABASE_URL) {
    console.log('Backend: PostgreSQL');
    await runPostgresMigrations(command, arg);
  } else {
    console.log('Backend: SQLite (data/nexyfab.db)');
    await runSqliteMigrations(command);
  }
}

async function runSqliteMigrations(command: string) {
  // Import getDb to trigger SQLite auto-migrations
  const { getDb } = await import('../src/lib/db');
  const db = getDb();

  const applied = (db.prepare('SELECT version, name, applied_at FROM nf_schema_migrations ORDER BY version').all() as any[]);

  if (command === 'status') {
    console.log('\nApplied migrations:');
    if (applied.length === 0) { console.log('  (none)'); }
    for (const m of applied) {
      console.log(`  v${m.version} — ${m.name} (${new Date(m.applied_at).toISOString()})`);
    }
  } else if (command === 'up') {
    // SQLite runs all migrations automatically on getDb() call
    console.log('\nSQLite migrations applied automatically.');
    console.log(`Current schema version: ${applied[applied.length - 1]?.version ?? 0}`);
  }
}

async function runPostgresMigrations(command: string, arg?: string) {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Ensure migrations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nf_schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at BIGINT NOT NULL
      )
    `);

    const { rows: applied } = await pool.query(
      'SELECT version, name, applied_at FROM nf_schema_migrations ORDER BY version',
    );
    const appliedVersions = new Set(applied.map((r: any) => r.version));

    if (command === 'status') {
      console.log('\nApplied migrations:');
      if (applied.length === 0) { console.log('  (none)'); }
      for (const m of applied) {
        console.log(`  v${m.version} — ${m.name} (${new Date(Number(m.applied_at)).toISOString()})`);
      }
      return;
    }

    if (command === 'up') {
      // Read SQL file and split into statements
      const sqlPath = path.join(ROOT, 'src/lib/db-postgres-migrations.sql');
      const sql = fs.readFileSync(sqlPath, 'utf-8');

      // Run all as a single transaction (idempotent CREATE IF NOT EXISTS)
      await pool.query('BEGIN');
      try {
        await pool.query(sql);
        await pool.query('COMMIT');
        console.log('\nPostgreSQL schema up to date.');
      } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Migration failed:', err);
        process.exit(1);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
