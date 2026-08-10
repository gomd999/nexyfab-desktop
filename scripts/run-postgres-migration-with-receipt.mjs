#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { runPostgresMigration } from './run-postgres-migrations.mjs';

const quoteIdentifier = value => `"${String(value).replaceAll('"', '""')}"`;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function snapshotRows(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const tables = (await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
    )).rows.map(row => String(row.table_name));
    const rows = [];
    for (const table of tables) {
      const result = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${quoteIdentifier(table)}`);
      rows.push([table, Number(result.rows[0].count)]);
    }
    const businessRows = rows.filter(([table]) => table !== 'nf_schema_migrations');
    return {
      tableCount: tables.length,
      totalRows: rows.reduce((sum, [, count]) => sum + count, 0),
      businessRowCountSha256: digest(businessRows),
      businessRows,
    };
  } finally {
    await client.end();
  }
}

export async function migrateWithReceipt({ databaseUrl, sqlPath, outputPath, target }) {
  const before = await snapshotRows(databaseUrl);
  const migration = await runPostgresMigration({ databaseUrl, sqlPath });
  const after = await snapshotRows(databaseUrl);
  const beforeRows = new Map(before.businessRows);
  const afterRows = new Map(after.businessRows);
  const changedBusinessTables = [...new Set([...beforeRows.keys(), ...afterRows.keys()])]
    .filter(table => beforeRows.get(table) !== afterRows.get(table))
    .sort();
  const receipt = {
    schema: 'nexyfab.postgres-migration-receipt.v1',
    generatedAt: new Date().toISOString(),
    ok: changedBusinessTables.length === 0,
    target,
    migration,
    before: {
      tableCount: before.tableCount,
      totalRows: before.totalRows,
      businessRowCountSha256: before.businessRowCountSha256,
    },
    after: {
      tableCount: after.tableCount,
      totalRows: after.totalRows,
      businessRowCountSha256: after.businessRowCountSha256,
    },
    changedBusinessTables,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
  if (!receipt.ok) throw new Error(`business_row_counts_changed:${changedBusinessTables.join(',')}`);
  return receipt;
}

if (import.meta.url === new URL(`file:///${process.argv[1]?.replaceAll('\\', '/')}`).href) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const outputPath = path.resolve(process.env.MIGRATION_RECEIPT_OUTPUT ?? 'docs/evidence/release/production-migration-receipt.json');
  const sqlPath = path.resolve(process.env.POSTGRES_MIGRATION_SQL ?? 'src/lib/db-postgres-migrations.sql');
  const target = process.env.MIGRATION_TARGET ?? 'unspecified';
  migrateWithReceipt({ databaseUrl, sqlPath, outputPath, target })
    .then(receipt => process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`))
    .catch(error => {
      process.stderr.write(`[postgres-migration-receipt] ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
