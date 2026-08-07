import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDrillTarget } from './verify-backup-restore.mjs';

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
