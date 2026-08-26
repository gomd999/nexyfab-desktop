import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  buildMigrationReceipt,
  changedBusinessRowCounts,
  COMMERCIAL_MIGRATION_VERSIONS,
  readCommercialMigrationSources,
  verifyMigrationReceipt,
} from './run-postgres-migration-with-receipt.mjs';

test('treats newly created empty tables as unchanged business data', () => {
  assert.deepEqual(changedBusinessRowCounts([], [
    ['nf_users', 0],
    ['nf_projects', 0],
  ]), []);
});

test('reports inserted, deleted, and removed business rows', () => {
  assert.deepEqual(changedBusinessRowCounts([
    ['nf_files', 2],
    ['nf_projects', 1],
    ['nf_users', 0],
  ], [
    ['nf_files', 3],
    ['nf_users', 1],
  ]), ['nf_files', 'nf_projects', 'nf_users']);
});

test('treats an absent table and an empty table equivalently in either direction', () => {
  assert.deepEqual(changedBusinessRowCounts([['nf_projects', 0]], []), []);
});

function completeMigration() {
  return {
    ok: true,
    migrations: readCommercialMigrationSources().map(({ version, name, source }) => ({
      version, name, checksum: source.sha256, decision: 'already_applied',
    })),
  };
}

function snapshot() {
  const businessRows = [['nf_projects', 3]];
  return {
    tableCount: 2,
    totalRows: 3,
    businessRowCountSha256: createHash('sha256').update(JSON.stringify(businessRows)).digest('hex'),
    businessRows,
  };
}

test('builds an immutable production v2 receipt for every commercial migration', () => {
  const generatedAt = new Date().toISOString();
  const receipt = buildMigrationReceipt({
    migration: completeMigration(), before: snapshot(), after: snapshot(), target: 'production',
    release: { buildId: 'build-2208', deploymentId: 'deployment-2208', gitHead: '3d6ba1ec461169d9d331b939e432483c3953b752' },
    generatedAt,
  });
  assert.equal(receipt.schema, 'nexyfab.postgres-migration-receipt.v2');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.target, 'production');
  assert.deepEqual(receipt.migrations.map(item => item.version), COMMERCIAL_MIGRATION_VERSIONS);
  assert.ok(receipt.migrations.every(item => item.source.path.startsWith('src/lib/db-postgres-migration-')));
  assert.ok(receipt.migrations.every(item => Number.isInteger(item.source.bytes) && item.source.bytes > 0));
  assert.ok(receipt.migrations.every(item => item.source.sha256 === item.sourceSha256
    && item.sourceSha256 === item.databaseChecksum && item.decision === 'already_applied'));
  assert.match(receipt.receiptSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(verifyMigrationReceipt(receipt, {
    expectedRelease: { buildId: 'build-2208', deploymentId: 'deployment-2208', head: receipt.release.gitHead },
  }), { ok: true, blockers: [] });
});

test('holds when one migration was not applied or observed completely', () => {
  const migration = completeMigration();
  migration.migrations = migration.migrations.slice(0, -1);
  const receipt = buildMigrationReceipt({
    migration, before: snapshot(), after: snapshot(), target: 'production',
    release: { buildId: 'build-2208', deploymentId: 'deployment-2208', gitHead: '3d6ba1ec461169d9d331b939e432483c3953b752' },
  });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.status, 'HOLD');
  assert.ok(receipt.blockers.includes('migration_observation_missing:2026082502'));
  const verification = verifyMigrationReceipt(receipt);
  assert.equal(verification.ok, false);
  assert.ok(verification.blockers.includes('receipt_not_pass'));
  assert.ok(verification.blockers.includes('migration_binding_invalid:2026082502'));
});

test('does not claim PASS for changed business rows or a non-production target', () => {
  const changedRows = [['nf_projects', 4]];
  const receipt = buildMigrationReceipt({
    migration: completeMigration(), before: snapshot(), after: {
      ...snapshot(),
      totalRows: 4,
      businessRows: changedRows,
      businessRowCountSha256: createHash('sha256').update(JSON.stringify(changedRows)).digest('hex'),
    }, target: 'staging',
    release: { buildId: 'build-2208', deploymentId: 'deployment-2208', gitHead: '3d6ba1ec461169d9d331b939e432483c3953b752' },
  });
  assert.equal(receipt.ok, false);
  assert.ok(receipt.blockers.includes('target_not_production'));
  assert.ok(receipt.blockers.includes('business_row_counts_changed:nf_projects'));
});

test('accepts 64-character object-format git ids and rejects forged snapshot digests', () => {
  const receipt = buildMigrationReceipt({
    migration: completeMigration(), before: snapshot(), after: snapshot(), target: 'production',
    release: { buildId: 'build-2208', deploymentId: 'deployment-2208', gitHead: 'a'.repeat(64) },
  });
  assert.equal(receipt.ok, true);

  const forged = snapshot();
  forged.businessRowCountSha256 = 'b'.repeat(64);
  const held = buildMigrationReceipt({
    migration: completeMigration(), before: forged, after: forged, target: 'production',
    release: { buildId: 'build-2208', deploymentId: 'deployment-2208', gitHead: 'a'.repeat(64) },
  });
  assert.equal(held.ok, false);
  assert.ok(held.blockers.includes('before_observation_incomplete'));
  assert.ok(held.blockers.includes('after_observation_incomplete'));
});
