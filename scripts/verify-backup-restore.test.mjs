import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDrillTarget,
  assertRestoreDrillSafety,
  compareDatabaseSnapshots,
  isBoundGitHead,
  validateUnvalidatedConstraints,
} from './verify-backup-restore.mjs';

test('restore receipts accept Git SHA-1 and SHA-256 commit identifiers', () => {
  assert.equal(isBoundGitHead('a'.repeat(40)), true);
  assert.equal(isBoundGitHead('b'.repeat(64)), true);
  assert.equal(isBoundGitHead('c'.repeat(39)), false);
});

test('restore drill only accepts explicitly isolated database names', () => {
  assert.deepEqual(
    assertDrillTarget('postgres://user:secret@localhost:5432/nexyfab_restore_drill'),
    { database: 'nexyfab_restore_drill', hostname: 'localhost' },
  );
  assert.throws(
    () => assertDrillTarget('postgres://user:secret@localhost:5432/nexyfab'),
    /Refusing restore/,
  );
});

test('restore drill rejects non-PostgreSQL targets', () => {
  assert.throws(() => assertDrillTarget('file:///tmp/nexyfab_restore_drill'), /postgres/i);
});

test('restore drill requires staging confirmation and distinct database identity', () => {
  const valid = {
    sourceDatabaseUrl: 'postgres://user:secret@db.internal:5432/nexyfab',
    restoreDatabaseUrl: 'postgres://user:secret@db.internal:5432/nexyfab_restore_drill_260810',
    environment: 'staging',
    confirmation: 'NEXYFAB_ISOLATED_RESTORE_ONLY',
  };
  assert.equal(assertRestoreDrillSafety(valid).target.database, 'nexyfab_restore_drill_260810');
  assert.throws(() => assertRestoreDrillSafety({ ...valid, environment: 'production' }), /staging/);
  assert.throws(() => assertRestoreDrillSafety({
    ...valid,
    restoreDatabaseUrl: valid.sourceDatabaseUrl,
  }), /target database name|identical/);
});

test('snapshot comparison checks per-table row count and content fingerprint', () => {
  const base = {
    tables: [
      { table: 'nf_projects', rows: 2, contentHash: 'a' },
      { table: 'nf_schema_migrations', rows: 1, contentHash: 'm1' },
    ],
  };
  assert.equal(compareDatabaseSnapshots(base, structuredClone(base)).ok, true);
  const changed = structuredClone(base);
  changed.tables[0].contentHash = 'b';
  assert.deepEqual(compareDatabaseSnapshots(base, changed).differences.map(item => item.table), ['nf_projects']);
  const migrationOnly = structuredClone(base);
  migrationOnly.tables[1].rows = 2;
  migrationOnly.tables[1].contentHash = 'm2';
  assert.equal(compareDatabaseSnapshots(base, migrationOnly, { ignoreTables: ['nf_schema_migrations'] }).ok, true);
  const withNewEmptyTable = structuredClone(base);
  withNewEmptyTable.tables.push({ table: 'nf_new_feature', rows: 0, contentHash: 'empty' });
  assert.equal(compareDatabaseSnapshots(base, withNewEmptyTable, { allowNewEmptyTables: true }).ok, true);
});

test('validates catalog-discovered constraints only on the isolated restore client', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (/^\s*SELECT\b/.test(sql)) {
        return {
          rows: [
            { table_schema: 'public', table_name: 'child', constraint_name: 'child_parent_fk', constraint_type: 'f' },
            { table_schema: 'public', table_name: 'artifact', constraint_name: 'private/key"check', constraint_type: 'c' },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const result = await validateUnvalidatedConstraints(client);
  assert.deepEqual(result, {
    count: 2,
    validated: [
      { table: 'public.child', constraint: 'child_parent_fk', type: 'foreign_key' },
      { table: 'public.artifact', constraint: 'private/key"check', type: 'check' },
    ],
    ok: true,
  });
  assert.match(queries[0], /NOT constraint_record\.convalidated/);
  assert.equal(queries[1], 'ALTER TABLE "public"."child" VALIDATE CONSTRAINT "child_parent_fk"');
  assert.equal(queries[2], 'ALTER TABLE "public"."artifact" VALIDATE CONSTRAINT "private\/key""check"');
});
