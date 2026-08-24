#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createGunzip, createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { runPostgresMigration } from './run-postgres-migrations.mjs';

const CONFIRMATION = 'NEXYFAB_ISOLATED_RESTORE_ONLY';
const quoteIdentifier = value => `"${String(value).replaceAll('"', '""')}"`;
const sha256 = value => createHash('sha256').update(value).digest('hex');
export const isBoundGitHead = value => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(String(value));

function parsePostgresUrl(databaseUrl, variableName) {
  const parsed = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(`${variableName} must use postgres:// or postgresql://`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) throw new Error(`${variableName} must name a database`);
  return {
    database,
    hostname: parsed.hostname,
    port: parsed.port || '5432',
    identity: `${parsed.hostname.toLowerCase()}:${parsed.port || '5432'}/${database}`,
  };
}

export function assertDrillTarget(databaseUrl) {
  const target = parsePostgresUrl(databaseUrl, 'RESTORE_DATABASE_URL');
  if (!/_restore_drill(?:_|$)/i.test(target.database)) {
    throw new Error("Refusing restore: target database name must contain '_restore_drill'");
  }
  return { database: target.database, hostname: target.hostname };
}

export function assertRestoreDrillSafety({
  sourceDatabaseUrl,
  restoreDatabaseUrl,
  environment,
  confirmation,
}) {
  const source = parsePostgresUrl(sourceDatabaseUrl, 'SOURCE_DATABASE_URL');
  const target = parsePostgresUrl(restoreDatabaseUrl, 'RESTORE_DATABASE_URL');
  assertDrillTarget(restoreDatabaseUrl);
  if (source.identity === target.identity) {
    throw new Error('Refusing restore: source and target databases are identical');
  }
  if (environment !== 'staging') {
    throw new Error('RESTORE_DRILL_ENVIRONMENT must be staging');
  }
  if (confirmation !== CONFIRMATION) {
    throw new Error(`RESTORE_DRILL_CONFIRM must equal ${CONFIRMATION}`);
  }
  return { source, target };
}

function postgresCommandEnv(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const sslMode = parsed.searchParams.get('sslmode');
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    ...(sslMode ? { PGSSLMODE: sslMode } : {}),
  };
}

function command(binary, args, { stdin = 'ignore', env = process.env } = {}) {
  const child = spawn(binary, args, {
    stdio: [stdin, 'pipe', 'pipe'],
    windowsHide: true,
    env,
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${binary} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
  return { child, completion };
}

async function createBackup(sourceDatabaseUrl, backupFile) {
  if (existsSync(backupFile)) {
    if (process.env.USE_EXISTING_BACKUP !== '1') {
      throw new Error(`Refusing to overwrite backup file: ${backupFile}`);
    }
    return { reused: true, completedAt: statSync(backupFile).mtime.toISOString() };
  }
  mkdirSync(path.dirname(backupFile), { recursive: true });
  const dump = command('pg_dump', [
    '--format=plain',
    '--no-owner',
    '--no-privileges',
  ], { env: postgresCommandEnv(sourceDatabaseUrl) });
  await Promise.all([
    pipeline(dump.child.stdout, createGzip({ level: 9 }), createWriteStream(backupFile, { flags: 'wx' })),
    dump.completion,
  ]);
  return { reused: false, completedAt: new Date().toISOString() };
}

async function assertEmptyRestoreTarget(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const count = await client.query(
      "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
    );
    const tableCount = Number(count.rows[0]?.count ?? 0);
    if (tableCount !== 0) {
      throw new Error(`Refusing restore into non-empty drill database (public tables=${tableCount})`);
    }
  } finally {
    await client.end();
  }
}

async function restoreBackup(databaseUrl, backupFile) {
  const restore = command('psql', ['-X', '-v', 'ON_ERROR_STOP=1'], {
    stdin: 'pipe',
    env: postgresCommandEnv(databaseUrl),
  });
  const source = createReadStream(backupFile);
  const sql = backupFile.endsWith('.gz') ? source.pipe(createGunzip()) : source;
  await Promise.all([pipeline(sql, restore.child.stdin), restore.completion]);
}

async function foreignKeyReport(client) {
  const constraints = (await client.query(`
    SELECT
      c.conname,
      c.convalidated,
      child_ns.nspname AS child_schema,
      child.relname AS child_table,
      parent_ns.nspname AS parent_schema,
      parent.relname AS parent_table,
      array_agg(child_att.attname::text ORDER BY keys.ordinality) AS child_columns,
      array_agg(parent_att.attname::text ORDER BY keys.ordinality) AS parent_columns
    FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_class parent ON parent.oid = c.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS keys(child_num, parent_num, ordinality) ON true
    JOIN pg_attribute child_att ON child_att.attrelid = c.conrelid AND child_att.attnum = keys.child_num
    JOIN pg_attribute parent_att ON parent_att.attrelid = c.confrelid AND parent_att.attnum = keys.parent_num
    WHERE c.contype = 'f' AND child_ns.nspname = 'public'
    GROUP BY c.oid, c.conname, c.convalidated, child_ns.nspname, child.relname, parent_ns.nspname, parent.relname
    ORDER BY child_ns.nspname, child.relname, c.conname
  `)).rows;
  let orphanRows = 0;
  const failures = [];
  for (const constraint of constraints) {
    const child = `${quoteIdentifier(constraint.child_schema)}.${quoteIdentifier(constraint.child_table)}`;
    const parent = `${quoteIdentifier(constraint.parent_schema)}.${quoteIdentifier(constraint.parent_table)}`;
    const childColumns = constraint.child_columns;
    const parentColumns = constraint.parent_columns;
    const nonNull = childColumns.map(column => `c.${quoteIdentifier(column)} IS NOT NULL`).join(' AND ');
    const joined = childColumns.map((column, index) =>
      `p.${quoteIdentifier(parentColumns[index])} IS NOT DISTINCT FROM c.${quoteIdentifier(column)}`,
    ).join(' AND ');
    const result = await client.query(
      `SELECT COUNT(*)::bigint AS count FROM ${child} c WHERE (${nonNull}) AND NOT EXISTS (SELECT 1 FROM ${parent} p WHERE ${joined})`,
    );
    const count = Number(result.rows[0]?.count ?? 0);
    orphanRows += count;
    if (count > 0 || !constraint.convalidated) {
      failures.push({
        constraint: constraint.conname,
        table: `${constraint.child_schema}.${constraint.child_table}`,
        validated: constraint.convalidated,
        orphanRows: count,
      });
    }
  }
  return { count: constraints.length, orphanRows, failures, ok: failures.length === 0 };
}

export async function snapshotDatabase(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const tableNames = (await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
    )).rows.map(row => String(row.table_name));
    const schemaRows = (await client.query(`
      SELECT table_name, column_name, ordinal_position, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema='public'
      ORDER BY table_name, ordinal_position
    `)).rows;
    const indexRows = (await client.query(`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes WHERE schemaname='public'
      ORDER BY tablename, indexname
    `)).rows;

    const tables = [];
    for (const table of tableNames) {
      const result = await client.query(`
        SELECT COUNT(*)::bigint AS count,
               md5(COALESCE(string_agg(row_hash, '' ORDER BY row_hash), '')) AS content_hash
        FROM (SELECT md5(row_to_json(t)::text) AS row_hash FROM ${quoteIdentifier(table)} t) rows
      `);
      tables.push({
        table,
        rows: Number(result.rows[0]?.count ?? 0),
        contentHash: String(result.rows[0]?.content_hash ?? ''),
      });
    }
    const foreignKeys = await foreignKeyReport(client);
    const tableContentSha256 = sha256(JSON.stringify(tables));
    return {
      capturedAt: new Date().toISOString(),
      tableCount: tables.length,
      columnCount: schemaRows.length,
      rowCount: tables.reduce((sum, item) => sum + item.rows, 0),
      schemaSha256: sha256(JSON.stringify({ columns: schemaRows, indexes: indexRows })),
      tableContentSha256,
      tables,
      foreignKeys,
    };
  } finally {
    await client.end();
  }
}

export function compareDatabaseSnapshots(expected, actual, {
  ignoreTables = [],
  allowNewEmptyTables = false,
} = {}) {
  const ignored = new Set(ignoreTables);
  const filter = snapshot => snapshot.tables.filter(item => !ignored.has(item.table));
  const expectedTables = filter(expected);
  const actualTables = filter(actual);
  const expectedByName = new Map(expectedTables.map(item => [item.table, item]));
  const actualByName = new Map(actualTables.map(item => [item.table, item]));
  const names = [...new Set([...expectedByName.keys(), ...actualByName.keys()])].sort();
  const differences = names.flatMap(table => {
    const left = expectedByName.get(table);
    const right = actualByName.get(table);
    if (!left && allowNewEmptyTables && right?.rows === 0) return [];
    if (!left || !right || left.rows !== right.rows || left.contentHash !== right.contentHash) {
      return [{ table, expected: left ?? null, actual: right ?? null }];
    }
    return [];
  });
  return { ok: differences.length === 0, differences };
}

export async function verifyBackupRestore({
  backupFile,
  sourceDatabaseUrl,
  restoreDatabaseUrl,
  migrationSqlPath,
  receiptPath,
}) {
  const startedAtMs = Date.now();
  const release = {
    buildId: process.env.RESTORE_RELEASE_BUILD_ID?.trim() ?? '',
    deploymentId: process.env.RESTORE_RELEASE_DEPLOYMENT_ID?.trim() ?? '',
    gitHead: process.env.RESTORE_RELEASE_GIT_HEAD?.trim() ?? '',
  };
  if (!release.buildId || !release.deploymentId || !isBoundGitHead(release.gitHead)) {
    throw new Error('RESTORE_RELEASE_BUILD_ID, RESTORE_RELEASE_DEPLOYMENT_ID, and RESTORE_RELEASE_GIT_HEAD are required for a bound restore receipt');
  }
  const safety = assertRestoreDrillSafety({
    sourceDatabaseUrl,
    restoreDatabaseUrl,
    environment: process.env.RESTORE_DRILL_ENVIRONMENT,
    confirmation: process.env.RESTORE_DRILL_CONFIRM,
  });
  if (!existsSync(migrationSqlPath)) throw new Error(`Migration SQL not found: ${migrationSqlPath}`);
  if (existsSync(receiptPath)) throw new Error(`Refusing to overwrite restore receipt: ${receiptPath}`);

  const backup = await createBackup(sourceDatabaseUrl, backupFile);
  if (!existsSync(backupFile) || statSync(backupFile).size === 0) throw new Error('Backup file is empty');
  const backupBytes = statSync(backupFile).size;
  const backupSha256 = await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(backupFile);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });

  // The source is read-only. This snapshot is captured adjacent to pg_dump;
  // an active write during the interval correctly makes the exact match fail.
  const source = await snapshotDatabase(sourceDatabaseUrl);
  await assertEmptyRestoreTarget(restoreDatabaseUrl);
  const restoreStartedAtMs = Date.now();
  await restoreBackup(restoreDatabaseUrl, backupFile);
  const restored = await snapshotDatabase(restoreDatabaseUrl);
  const exactRestore = compareDatabaseSnapshots(source, restored);
  if (!exactRestore.ok || !restored.foreignKeys.ok) {
    throw new Error(`Restore verification failed: data differences=${exactRestore.differences.length}, FK failures=${restored.foreignKeys.failures.length}`);
  }

  const migration = await runPostgresMigration({
    databaseUrl: restoreDatabaseUrl,
    sqlPath: migrationSqlPath,
  });
  const migrated = await snapshotDatabase(restoreDatabaseUrl);
  const businessPreservation = compareDatabaseSnapshots(restored, migrated, {
    ignoreTables: ['nf_schema_migrations'],
    allowNewEmptyTables: true,
  });
  if (!businessPreservation.ok || !migrated.foreignKeys.ok) {
    throw new Error(`Post-migration verification failed: data differences=${businessPreservation.differences.length}, FK failures=${migrated.foreignKeys.failures.length}`);
  }

  const completedAtMs = Date.now();
  const backupCapturedAtMs = Date.parse(backup.completedAt);
  const receipt = {
    schema: 'nexyfab.backup-isolated-restore-drill.v2',
    generatedAt: new Date(completedAtMs).toISOString(),
    ok: true,
    target: 'production',
    release,
    safety: {
      environment: 'staging',
      sourceEnvironment: 'production',
      restoredEnvironment: 'staging',
      sourceDatabase: safety.source.database,
      restoreDatabase: safety.target.database,
      isolatedDatabaseIdentity: safety.source.identity !== safety.target.identity,
      sourceWasReadOnly: true,
      productionRestorePerformed: false,
    },
    backup: {
      file: path.relative(process.cwd(), backupFile),
      reused: backup.reused,
      bytes: backupBytes,
      sha256: backupSha256,
      objectSha256: backupSha256,
      sourceSnapshotSha256: source.tableContentSha256,
      completedAt: backup.completedAt,
    },
    source,
    restored: {
      ...restored,
      exactSourceMatch: exactRestore.ok,
      businessDataSha256: restored.tableContentSha256,
      differences: exactRestore.differences,
    },
    migration,
    migrationTarget: 2026082208,
    migrated: {
      ...migrated,
      businessRowsPreserved: businessPreservation.ok,
      businessDataSha256: migrated.tableContentSha256,
      businessDifferences: businessPreservation.differences,
    },
    timing: {
      drillStartedAt: new Date(startedAtMs).toISOString(),
      backupCapturedAt: backup.completedAt,
      restoreStartedAt: new Date(restoreStartedAtMs).toISOString(),
      completedAt: new Date(completedAtMs).toISOString(),
    },
    objectives: {
      rpoAgeAtDrillStartMs: Math.max(0, startedAtMs - backupCapturedAtMs),
      rtoRestoreMigrateValidateMs: completedAtMs - restoreStartedAtMs,
      totalDrillMs: completedAtMs - startedAtMs,
      measurement: 'wall_clock',
    },
  };
  receipt.migration.targetVersion = 2026082208;
  receipt.migration.targetChecksum = receipt.migration.migrations.find(item => item.version === 2026082208)?.checksum ?? null;
  receipt.sha256 = sha256(JSON.stringify(receipt));
  mkdirSync(path.dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return receipt;
}

async function main() {
  const sourceDatabaseUrl = process.env.SOURCE_DATABASE_URL;
  const restoreDatabaseUrl = process.env.RESTORE_DATABASE_URL;
  if (!sourceDatabaseUrl || !restoreDatabaseUrl) {
    throw new Error('SOURCE_DATABASE_URL and RESTORE_DATABASE_URL are required');
  }
  const backupFile = path.resolve(process.env.BACKUP_FILE ?? 'backups/restore-drill.sql.gz');
  const migrationSqlPath = path.resolve(process.env.POSTGRES_MIGRATION_SQL ?? 'src/lib/db-postgres-migrations.sql');
  const receiptPath = path.resolve(process.env.BACKUP_RESTORE_RECEIPT ?? 'validation-reports/backup-restore-drill.json');
  const result = await verifyBackupRestore({
    backupFile,
    sourceDatabaseUrl,
    restoreDatabaseUrl,
    migrationSqlPath,
    receiptPath,
  });
  process.stdout.write(`${JSON.stringify({
    ok: result.ok,
    restoreDatabase: result.safety.restoreDatabase,
    rtoMs: result.objectives.rtoRestoreMigrateValidateMs,
    rpoMs: result.objectives.rpoAgeAtDrillStartMs,
    receiptPath,
  })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    console.error(`[backup-restore] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
