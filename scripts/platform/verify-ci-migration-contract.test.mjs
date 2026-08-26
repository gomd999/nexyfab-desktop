import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('PostgreSQL restore drill applies the complete versioned migration chain twice', () => {
  const workflow = readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const migrationJob = workflow.match(/\n  migration-restore:\r?\n([\s\S]*?)\n  typecheck:\r?\n/)?.[1];

  assert.ok(migrationJob, 'migration-restore job must remain present');
  assert.equal(
    migrationJob.match(/npm run migrate:postgres:versioned/g)?.length,
    2,
    'restore drill must apply and reapply the complete ordered PostgreSQL migrations',
  );
  assert.doesNotMatch(
    migrationJob,
    /npm run migrate -- up/,
    'legacy monolithic migration skips newer immutable migration files',
  );
});
