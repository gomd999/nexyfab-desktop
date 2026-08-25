import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  LEGACY_2026082001_CHECKSUMS,
  migrationChecksum,
  migrationDecision,
  orderedMigrationInputs,
} from './run-postgres-migrations.mjs';

test('migration checksum is deterministic and content-bound', () => {
  assert.equal(migrationChecksum('SELECT 1'), migrationChecksum('SELECT 1'));
  assert.notEqual(migrationChecksum('SELECT 1'), migrationChecksum('SELECT 2'));
  assert.equal(
    migrationChecksum('SELECT 1;\r\nSELECT 2;\r\n'),
    migrationChecksum('SELECT 1;\nSELECT 2;\n'),
  );
});

test('migration decision fails closed on changed applied SQL', () => {
  assert.equal(migrationDecision(undefined, 'abc'), 'apply');
  assert.equal(migrationDecision({ checksum: 'abc' }, 'abc'), 'already_applied');
  assert.equal(migrationDecision({ checksum: 'old' }, 'new'), 'checksum_mismatch');
  assert.equal(
    migrationDecision(
      { checksum: LEGACY_2026082001_CHECKSUMS[0] },
      'new',
      LEGACY_2026082001_CHECKSUMS,
    ),
    'accepted_legacy_checksum',
  );
  assert.equal(
    migrationDecision({ checksum: 'unknown-legacy' }, 'new', LEGACY_2026082001_CHECKSUMS),
    'checksum_mismatch',
  );
});

test('keeps immutable migrations ordered before the remote CAD agent state migration', () => {
  const migrations = orderedMigrationInputs('/trusted/immutable-2001.sql');
  assert.deepEqual(migrations.map(item => item.version), [2026082001, 2026082002, 2026082101, 2026082102, 2026082201, 2026082202, 2026082203, 2026082204, 2026082205, 2026082206, 2026082207, 2026082208, 2026082301, 2026082401, 2026082402, 2026082403, 2026082501, 2026082502, 2026082601, 2026082602]);
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
  assert.match(migrations[13].sqlPath, /db-postgres-migration-2026082401\.sql$/);
  assert.match(migrations[14].sqlPath, /db-postgres-migration-2026082402\.sql$/);
  assert.match(migrations[15].sqlPath, /db-postgres-migration-2026082403\.sql$/);
  assert.match(migrations[16].sqlPath, /db-postgres-migration-2026082501\.sql$/);
  assert.match(migrations[17].sqlPath, /db-postgres-migration-2026082502\.sql$/);
  assert.match(migrations[18].sqlPath, /db-postgres-migrations\.sql$/);
  assert.match(migrations[19].sqlPath, /db-postgres-migration-2026082602\.sql$/);
  assert.deepEqual(migrations[0].acceptedAppliedChecksums, LEGACY_2026082001_CHECKSUMS);
  assert.equal(migrations[18].acceptedAppliedChecksums, undefined);
});

test('2602 adds immutable private AI Design source artifacts', () => {
  const migration = orderedMigrationInputs().find(item => item.version === 2026082602);
  const sql = readFileSync(migration.sqlPath, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS nf_ai_design_source_artifacts/);
  assert.match(sql, /object_key LIKE 'private\/%'/);
  assert.match(sql, /nf_ai_design_source_artifact_immutable/);
});

test('2601 replays the idempotent legacy baseline under a new immutable version', () => {
  const migration = orderedMigrationInputs().find(item => item.version === 2026082601);
  const sql = readFileSync(migration.sqlPath, 'utf8');
  assert.equal(migration.name, 'postgres_schema_reconciliation_20260826');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS nf_cad_job_registry/);
  assert.match(sql, /ALTER TABLE nf_projects ADD COLUMN IF NOT EXISTS org_id TEXT/);
  assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|COLUMN|DATABASE|SCHEMA)\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
});

test('2301 is an append-only mapping migration and does not rewrite prior SQL', () => {
  const migrations = orderedMigrationInputs();
  const migration = migrations.find(item => item.version === 2026082301);
  assert.match(migration.sqlPath, /db-postgres-migration-2026082301\.sql$/);
});

test('2401 adds the authority-owned Canonical CAD V2 journal without rewriting prior SQL', () => {
  const migrations = orderedMigrationInputs();
  const migration = migrations.find(item => item.version === 2026082401);
  const sql = readFileSync(migration.sqlPath, 'utf8');
  assert.match(migration.sqlPath, /db-postgres-migration-2026082401\.sql$/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS nf_cad_canonical_v2_revisions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS nf_cad_canonical_v2_heads/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS nf_cad_canonical_v2_invalidations/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS nf_cad_canonical_v2_locks/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS nf_cad_canonical_v2_audit/);
  assert.match(sql, /nf_cad_v2_revisions_immutable/);
  assert.match(sql, /nf_cad_v2_head_identity_immutable/);
});

test('2402 adds durable AI Design V10 CAS heads and immutable artifacts', () => {
  const migrations = orderedMigrationInputs();
  const migration = migrations.find(item => item.version === 2026082402);
  const sql = readFileSync(migration.sqlPath, 'utf8');
  assert.match(migration.sqlPath, /db-postgres-migration-2026082402\.sql$/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS nf_ai_design_workspace_runtimes/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS nf_ai_design_complex_workspaces/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS nf_ai_design_artifacts/);
  assert.match(sql, /nf_ai_design_runtime_identity_immutable/);
  assert.match(sql, /nf_ai_design_artifact_immutable/);
});

test('2403 adds a leased AI-to-Precision outbox and immutable receipt ledger', () => {
  const migration = orderedMigrationInputs().find(item => item.version === 2026082403);
  const sql = readFileSync(migration.sqlPath, 'utf8');
  assert.match(migration.sqlPath, /db-postgres-migration-2026082403\.sql$/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS nf_ai_precision_bridge_outbox/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS nf_ai_precision_bridge_receipts/);
  assert.match(sql, /'VERIFIED_UNKNOWN'/);
  assert.match(sql, /nf_ai_precision_bridge_outbox_identity_immutable/);
  assert.match(sql, /nf_ai_precision_bridge_receipt_immutable/);
  assert.match(sql, /nf_ai_precision_bridge_json_binding_ck/);
  assert.match(sql, /nf_ai_precision_bridge_receipt_authority_ck/);
  assert.match(sql, /nf_ai_precision_bridge_receipt_binding_guard/);
  assert.match(sql, /a\.artifact_kind = 'precision_request'/);
  assert.match(sql, /a\.artifact_kind = 'precision_receipt'/);
  assert.match(sql, /c\.aggregate_json::jsonb -> 'precisionReceipts'/);
  assert.match(sql, /'CLAIMED', 'SENT', 'VERIFIED_UNKNOWN'/);
});

test('2501 moves commercial payment order columns out of request-time DDL', () => {
  const migration = orderedMigrationInputs().find(item => item.version === 2026082501);
  const sql = readFileSync(migration.sqlPath, 'utf8');
  assert.match(migration.sqlPath, /db-postgres-migration-2026082501\.sql$/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS toss_order_id TEXT/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS updated_at BIGINT/);
  assert.match(sql, /uq_orders_toss_order_id/);
});

test('2502 binds immutable commercial worker input and committed output roles', () => {
  const migration = orderedMigrationInputs().find(item => item.version === 2026082502);
  const sql = readFileSync(migration.sqlPath, 'utf8');
  assert.match(migration.sqlPath, /db-postgres-migration-2026082502\.sql$/);
  assert.match(sql, /nf_precision_cad_commercial_input_artifacts/);
  assert.match(sql, /nf_precision_cad_commercial_output_intents/);
  assert.match(sql, /commercial_execution_v3_input_required/);
  assert.match(sql, /nf_precision_cad_commercial_input_immutable/);
  assert.match(sql, /nf_precision_cad_commercial_output_identity_guard/);
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
