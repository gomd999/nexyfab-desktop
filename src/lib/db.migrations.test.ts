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
    expect(latest.version).toBe(88);

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
