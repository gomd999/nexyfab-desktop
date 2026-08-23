import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import {
  REQUIRED_CONSTRAINTS,
  REQUIRED_TRIGGERS,
  evaluateHardeningVerification,
  inspectCommercialHardening,
} from './verify-postgres-migration-2026082208.mjs';

const sourceChecksum = 'a'.repeat(64);

function completeInput(overrides = {}) {
  return {
    migration: { version: 2026082208, name: 'commercial_database_hardening_20260823', checksum: sourceChecksum },
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
      definition: `CREATE TRIGGER ${item.name} BEFORE UPDATE ON ${item.table} EXECUTE FUNCTION ${item.functionName}(${item.identityColumns.map(column => `'${column}'`).join(', ')})`,
    })),
    ...overrides,
  };
}

test('returns deterministic PASS only when migration, constraints, triggers, and rows are clean', () => {
  const first = evaluateHardeningVerification(completeInput());
  const second = evaluateHardeningVerification(completeInput());
  assert.equal(first.status, 'PASS');
  assert.equal(first.readOnly, true);
  assert.equal(first.mutationsAttempted, false);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('keeps NOT VALID constraints on HOLD and emits a non-executed validation plan', () => {
  const constraints = completeInput().constraints.map(item => item.name === REQUIRED_CONSTRAINTS[0].name
    ? { ...item, validated: false }
    : item);
  const result = evaluateHardeningVerification(completeInput({ constraints }));
  assert.equal(result.status, 'HOLD');
  assert.ok(result.blockers.includes('constraint_not_valid:nf_agentic_commercial_receipts_execution_fk'));
  assert.equal(result.validationPlan[0].status, 'READY_FOR_APPROVED_CHANGE');
  assert.match(result.validationPlan[0].sql, /VALIDATE CONSTRAINT/);
});

test('holds on missing objects, checksum mismatch, disabled trigger, and legacy violations', () => {
  const input = completeInput({
    migration: { version: 2026082208, checksum: 'b'.repeat(64) },
    constraints: completeInput().constraints.slice(1).map(item => item.name === REQUIRED_CONSTRAINTS[1].name
      ? { ...item, violationCount: '2' }
      : item),
    triggers: completeInput().triggers.map(item => item.name === REQUIRED_TRIGGERS[0].name
      ? { ...item, enabled: false }
      : item),
  });
  const result = evaluateHardeningVerification(input);
  assert.equal(result.status, 'HOLD');
  assert.ok(result.blockers.includes('migration_checksum_mismatch:2026082208'));
  assert.ok(result.blockers.includes('constraint_missing:nf_agentic_commercial_receipts_execution_fk'));
  assert.ok(result.blockers.includes('constraint_violations:nf_worker_artifact_private_key_ck:2'));
  assert.ok(result.blockers.includes('trigger_disabled:nf_precision_cad_execution_journal_identity_immutable'));
});

test('holds a same-named trigger wired to the wrong function or identity arguments', () => {
  const triggers = completeInput().triggers.map(item => item.name === REQUIRED_TRIGGERS[0].name
    ? { ...item, functionName: 'nf_untrusted_trigger', definition: item.definition.replace("'command_hash'", "'approval_hash'") }
    : item);
  const result = evaluateHardeningVerification(completeInput({ triggers }));
  assert.equal(result.status, 'HOLD');
  assert.ok(result.blockers.includes('trigger_definition_mismatch:nf_precision_cad_execution_journal_identity_immutable'));
});

test('inspection executes only SELECT statements and never validates or applies constraints', async () => {
  const queries = [];
  const sourcePath = new URL('../src/lib/db-postgres-migration-2026082208.sql', import.meta.url);
  const source = fs.readFileSync(sourcePath);
  const actualSourceChecksum = createHash('sha256').update(source).digest('hex');
  const fakeClient = {
    async query(sql, params) {
      queries.push({ sql, params });
      assert.match(sql, /^\s*SELECT\b/i);
      assert.doesNotMatch(sql, /\b(?:ALTER|VALIDATE|APPLY|INSERT|UPDATE|DELETE)\b/i);
      if (sql.includes('FROM public.nf_schema_migrations')) return { rows: [{ version: 2026082208, name: 'commercial_database_hardening_20260823', checksum: actualSourceChecksum }] };
      if (sql.includes('FROM pg_constraint')) return { rows: REQUIRED_CONSTRAINTS.map(item => ({ name: item.name, table_name: item.table, type: item.type, validated: true })) };
      if (sql.includes('FROM pg_trigger')) return { rows: REQUIRED_TRIGGERS.map(item => ({
        name: item.name,
        table_name: item.table,
        enabled: 'O',
        internal: false,
        trigger_type: item.triggerType,
        function_name: item.functionName,
        definition: `CREATE TRIGGER ${item.name} BEFORE UPDATE ON ${item.table} EXECUTE FUNCTION ${item.functionName}(${item.identityColumns.map(column => `'${column}'`).join(', ')})`,
      })) };
      return { rows: [{ count: 0 }] };
    },
  };
  const result = await inspectCommercialHardening({ client: fakeClient, migrationSqlPath: sourcePath });
  assert.equal(result.status, 'PASS');
  assert.equal(result.mutationsAttempted, false);
  assert.equal(queries.length, 3 + REQUIRED_CONSTRAINTS.length);
  assert.ok(source.length > 0);
});
