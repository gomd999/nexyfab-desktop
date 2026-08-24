import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from './db';

const testDirectory = mkdtempSync(join(tmpdir(), 'nexyfab-sqlite-migrations-'));
const databasePath = join(testDirectory, 'fresh.db');

describe('SQLite migrations', () => {
  it('initializes a fresh database through the organization-scoped schema', () => {
    process.env.NEXYFAB_DB_PATH = databasePath;
    const db = getDb();
    const latest = db.prepare('SELECT MAX(version) AS version FROM nf_schema_migrations').get() as { version: number };
    expect(latest.version).toBe(90);

    const canonicalMigration = db.prepare('SELECT checksum FROM nf_schema_migrations WHERE version = 89').get() as { checksum: string };
    expect(canonicalMigration.checksum).toMatch(/^[a-f0-9]{64}$/);

    for (const table of ['nf_cad_canonical_v2_revisions', 'nf_cad_canonical_v2_heads', 'nf_cad_canonical_v2_invalidations', 'nf_cad_canonical_v2_locks', 'nf_cad_canonical_v2_audit']) {
      const found = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      expect(found).toBeTruthy();
    }

    const aiMigration = db.prepare('SELECT checksum FROM nf_schema_migrations WHERE version = 90').get() as { checksum: string };
    expect(aiMigration.checksum).toMatch(/^[a-f0-9]{64}$/);
    for (const table of ['nf_ai_design_workspace_runtimes', 'nf_ai_design_complex_workspaces', 'nf_ai_design_artifacts']) {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)).toBeTruthy();
    }

    for (const table of ['nf_usage_events', 'nf_files', 'nf_ai_history']) {
      const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
      expect(columns.filter(column => column.name === 'org_id')).toHaveLength(1);
    }
  });
});

afterAll(() => {
  getDb().close();
  rmSync(testDirectory, { recursive: true, force: true });
});
