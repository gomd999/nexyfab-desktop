import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'nexyfab-lineage-migration-'));
process.env.NEXYFAB_DB_PATH = join(tempDir, 'migration.db');

async function main() {
try {
  const { getDb } = await import('../src/lib/db');
  const db = getDb();
  const migration = db.prepare(
    'SELECT version, name FROM nf_schema_migrations WHERE version = 78',
  ).get() as { version: number; name: string } | undefined;

  const columns = (table: string) => new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(row => row.name),
  );
  const required = ['lineage_id', 'artifact_id', 'artifact_sha256', 'document_version_id'];
  const missing = ['nf_rfqs', 'nf_quotes', 'nf_orders'].flatMap(table => {
    const actual = columns(table);
    return required.filter(column => !actual.has(column)).map(column => `${table}.${column}`);
  });
  const lineageTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'nf_manufacturing_lineage'",
  ).get();
  const indexes = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%lineage%' ORDER BY name",
  ).all() as Array<{ name: string }>;

  if (!migration || !lineageTable || missing.length || indexes.length < 5) {
    throw new Error(JSON.stringify({ migration, lineageTable, missing, indexes }));
  }
  console.log(JSON.stringify({ ok: true, migration, indexes: indexes.map(row => row.name) }));
  db.close();
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
}

void main();
