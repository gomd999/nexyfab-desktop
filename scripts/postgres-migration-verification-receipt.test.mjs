import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  REQUIRED_CONSTRAINTS,
  REQUIRED_TRIGGERS,
  evaluateHardeningVerification,
} from './verify-postgres-migration-2026082208.mjs';
import {
  MIGRATION_RECEIPT_SCHEMA,
  buildMigrationVerificationReceipt,
  verifyMigrationVerificationReceipt,
} from './postgres-migration-verification-receipt.mjs';

const root = process.cwd();
const sourcePath = path.join(root, 'src/lib/db-postgres-migration-2026082208.sql');
const sourceChecksum = createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
const release = { buildId: 'build-2208', deploymentId: 'deployment-2208', gitHead: 'a'.repeat(40) };

function passingVerification() {
  return evaluateHardeningVerification({
    migration: {
      version: 2026082208,
      name: 'commercial_database_hardening_20260823',
      checksum: sourceChecksum,
    },
    sourceChecksum,
    constraints: REQUIRED_CONSTRAINTS.map(item => ({
      table: item.table, name: item.name, type: item.type, validated: true, violationCount: 0,
    })),
    triggers: REQUIRED_TRIGGERS.map(item => ({
      table: item.table,
      name: item.name,
      enabled: true,
      functionName: item.functionName,
      triggerType: item.triggerType,
      definition: `CREATE TRIGGER ${item.name} EXECUTE FUNCTION ${item.functionName}(${item.identityColumns.map(column => `'${column}'`).join(', ')})`,
    })),
  });
}

test('builds and verifies a receipt bound to the observed source and exact release identity', () => {
  const receipt = buildMigrationVerificationReceipt({
    verification: passingVerification(),
    target: 'production',
    release,
    root,
  });
  assert.equal(receipt.schema, MIGRATION_RECEIPT_SCHEMA);
  assert.equal(receipt.ok, true);
  assert.deepEqual(verifyMigrationVerificationReceipt(receipt, {
    expectedRelease: { ...release, head: release.gitHead },
    expectedTarget: 'production',
    root,
    now: Date.parse(receipt.generatedAt),
  }), { ok: true, blockers: [] });
});

test('rejects legacy/self-asserted receipts and transplanted release identities', () => {
  const receipt = buildMigrationVerificationReceipt({
    verification: passingVerification(), target: 'production', release, root,
  });
  const legacy = { ...receipt, schema: 'nexyfab.postgres-migration-receipt.v1' };
  assert.equal(verifyMigrationVerificationReceipt(legacy, {
    expectedRelease: { ...release, head: release.gitHead }, root, now: Date.parse(receipt.generatedAt),
  }).ok, false);

  const transplanted = structuredClone(receipt);
  transplanted.release.deploymentId = 'other-deployment';
  assert.ok(verifyMigrationVerificationReceipt(transplanted, {
    expectedRelease: { ...release, head: release.gitHead }, root, now: Date.parse(receipt.generatedAt),
  }).blockers.includes('release_binding_mismatch'));

  const forgedSource = structuredClone(receipt);
  forgedSource.source.sha256 = 'b'.repeat(64);
  assert.ok(verifyMigrationVerificationReceipt(forgedSource, {
    expectedRelease: { ...release, head: release.gitHead }, root, now: Date.parse(receipt.generatedAt),
  }).blockers.includes('source_bytes_unbound'));
});

test('does not turn a HOLD observation into an eligible receipt', () => {
  const verification = passingVerification();
  verification.status = 'HOLD';
  verification.blockers = ['constraint_violations:example:1'];
  const receipt = buildMigrationVerificationReceipt({ verification, target: 'production', release, root });
  assert.equal(receipt.ok, false);
  assert.ok(verifyMigrationVerificationReceipt(receipt, {
    expectedRelease: { ...release, head: release.gitHead }, root, now: Date.parse(receipt.generatedAt),
  }).blockers.includes('receipt_not_ok'));
});
