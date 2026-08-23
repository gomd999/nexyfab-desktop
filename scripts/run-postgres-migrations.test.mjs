import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { migrationChecksum, migrationDecision, orderedMigrationInputs } from './run-postgres-migrations.mjs';

test('migration checksum is deterministic and content-bound', () => {
  assert.equal(migrationChecksum('SELECT 1'), migrationChecksum('SELECT 1'));
  assert.notEqual(migrationChecksum('SELECT 1'), migrationChecksum('SELECT 2'));
});

test('migration decision fails closed on changed applied SQL', () => {
  assert.equal(migrationDecision(undefined, 'abc'), 'apply');
  assert.equal(migrationDecision({ checksum: 'abc' }, 'abc'), 'already_applied');
  assert.equal(migrationDecision({ checksum: 'old' }, 'new'), 'checksum_mismatch');
});

test('keeps immutable migrations ordered before the remote CAD agent state migration', () => {
  const migrations = orderedMigrationInputs('/trusted/immutable-2001.sql');
  assert.deepEqual(migrations.map(item => item.version), [2026082001, 2026082002, 2026082101, 2026082102, 2026082201, 2026082202, 2026082203, 2026082204, 2026082205, 2026082206, 2026082207, 2026082208, 2026082301]);
  assert.match(migrations[0].sqlPath, /immutable-2001\.sql$/);
  assert.match(migrations[1].sqlPath, /db-postgres-migration-2026082002\.sql$/);
  assert.match(migrations[2].sqlPath, /db-postgres-migration-2026082101\.sql$/);
  assert.match(migrations[3].sqlPath, /db-postgres-migration-2026082102\.sql$/);
  assert.match(migrations[4].sqlPath, /db-postgres-migration-2026082201\.sql$/);
  assert.match(migrations[5].sqlPath, /db-postgres-migration-2026082202\.sql$/);
  assert.match(migrations[6].sqlPath, /db-postgres-migration-2026082203\.sql$/);
  assert.match(migrations[7].sqlPath, /db-postgres-migration-2026082204\.sql$/);
  assert.match(migrations[8].sqlPath, /db-postgres-migration-2026082205\.sql$/);
  assert.match(migrations[9].sqlPath, /db-postgres-migration-2026082206\.sql$/);
  assert.match(migrations[10].sqlPath, /db-postgres-migration-2026082207\.sql$/);
  assert.match(migrations[11].sqlPath, /db-postgres-migration-2026082208\.sql$/);
  assert.match(migrations[12].sqlPath, /db-postgres-migration-2026082301\.sql$/);
});

test('2301 is an append-only mapping migration and does not rewrite prior SQL', () => {
  const migrations = orderedMigrationInputs();
  assert.match(migrations.at(-1).sqlPath, /db-postgres-migration-2026082301\.sql$/);
  assert.notEqual(migrations.at(-1).sqlPath, migrations.at(-2).sqlPath);
});

test('2208 adds safe hardening primitives without rewriting the 2202-2207 schema', () => {
  const sql = readFileSync(new URL('../src/lib/db-postgres-migration-2026082208.sql', import.meta.url), 'utf8');
  assert.match(sql, /nf_agentic_commercial_receipts_execution_fk[\s\S]*NOT VALID/);
  assert.match(sql, /nf_precision_cad_execution_journal_identity_immutable/);
  assert.match(sql, /nf_worker_artifact_private_key_ck[\s\S]*NOT VALID/);
  assert.match(sql, /nf_external_evidence_private_key_ck[\s\S]*NOT VALID/);
  assert.match(sql, /nf_agentic_receipt_private_key_ck[\s\S]*NOT VALID/);
  assert.match(sql, /nf_precision_cad_execution_events_immutable/);
  assert.match(sql, /nf_external_commercial_evidence_immutable/);
  assert.match(sql, /nf_external_commercial_verifier_callbacks_immutable/);
  assert.match(sql, /nf_precision_cad_commercial_callbacks_immutable/);
  assert.match(sql, /nf_commercial_generation_receipt_binding_identity_immutable/);
  assert.match(sql, /nf_external_verification_request_identity_immutable/);
  assert.match(sql, /nf_commercial_generation_run_identity_immutable/);
  assert.match(sql, /nf_commercial_identity_immutable/);
});
