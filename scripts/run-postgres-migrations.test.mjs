import assert from 'node:assert/strict';
import test from 'node:test';
import { migrationChecksum, migrationDecision } from './run-postgres-migrations.mjs';

test('migration checksum is deterministic and content-bound', () => {
  assert.equal(migrationChecksum('SELECT 1'), migrationChecksum('SELECT 1'));
  assert.notEqual(migrationChecksum('SELECT 1'), migrationChecksum('SELECT 2'));
});

test('migration decision fails closed on changed applied SQL', () => {
  assert.equal(migrationDecision(undefined, 'abc'), 'apply');
  assert.equal(migrationDecision({ checksum: 'abc' }, 'abc'), 'already_applied');
  assert.equal(migrationDecision({ checksum: 'old' }, 'new'), 'checksum_mismatch');
});
