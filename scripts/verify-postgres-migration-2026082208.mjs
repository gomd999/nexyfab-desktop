#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
export {
  MIGRATION_RECEIPT_SCHEMA,
  MIGRATION_SOURCE_PATH,
  buildMigrationVerificationReceipt,
  verifyMigrationVerificationReceipt,
} from './postgres-migration-verification-receipt.mjs';

export const MIGRATION_VERSION = 2026082208;
export const RESULT_SCHEMA = 'nexyfab.postgres-migration-2208-readonly-verification.v1';

// Keep this inventory in lockstep with migration 2208 and the production
// readiness checks. It is deliberately data-only: this verifier never derives
// SQL from database metadata.
export const REQUIRED_CONSTRAINTS = Object.freeze([
  Object.freeze({
    table: 'nf_agentic_commercial_receipts',
    name: 'nf_agentic_commercial_receipts_execution_fk',
    type: 'f',
    kind: 'foreign_key',
    violationSql: `SELECT COUNT(*)::bigint AS count
      FROM public.nf_agentic_commercial_receipts AS receipt
      LEFT JOIN public.nf_precision_cad_execution_journal AS journal
        ON journal.execution_id = receipt.execution_id
      WHERE receipt.execution_id IS NOT NULL AND journal.execution_id IS NULL`,
  }),
  Object.freeze({
    table: 'nf_precision_cad_commercial_worker_artifacts',
    name: 'nf_worker_artifact_private_key_ck',
    type: 'c',
    kind: 'private_object_key',
    violationSql: `SELECT COUNT(*)::bigint AS count
      FROM public.nf_precision_cad_commercial_worker_artifacts
      WHERE NOT (object_key LIKE 'private/%'
        AND position('..' in object_key) = 0
        AND position(chr(92) in object_key) = 0
        AND position('://' in object_key) = 0)`,
  }),
  Object.freeze({
    table: 'nf_external_commercial_evidence',
    name: 'nf_external_evidence_private_key_ck',
    type: 'c',
    kind: 'private_object_key',
    violationSql: `SELECT COUNT(*)::bigint AS count
      FROM public.nf_external_commercial_evidence
      WHERE NOT (object_key LIKE 'private/commercial-evidence/%'
        AND position('..' in object_key) = 0
        AND position(chr(92) in object_key) = 0
        AND position('://' in object_key) = 0)`,
  }),
  Object.freeze({
    table: 'nf_agentic_commercial_receipts',
    name: 'nf_agentic_receipt_private_key_ck',
    type: 'c',
    kind: 'private_object_key',
    violationSql: `SELECT COUNT(*)::bigint AS count
      FROM public.nf_agentic_commercial_receipts
      WHERE NOT (object_key LIKE 'private/%'
        AND position('..' in object_key) = 0
        AND position(chr(92) in object_key) = 0
        AND position('://' in object_key) = 0)`,
  }),
]);

export const REQUIRED_TRIGGERS = Object.freeze([
  Object.freeze({ table: 'nf_precision_cad_execution_journal', name: 'nf_precision_cad_execution_journal_identity_immutable', functionName: 'nf_commercial_identity_immutable', triggerType: 19, identityColumns: ['execution_id', 'idempotency_key', 'project_id', 'workspace_id', 'workspace_revision', 'workspace_content_hash', 'command_hash', 'created_at'] }),
  Object.freeze({ table: 'nf_precision_cad_execution_events', name: 'nf_precision_cad_execution_events_immutable', functionName: 'nf_commercial_append_only_row', triggerType: 27, identityColumns: [] }),
  Object.freeze({ table: 'nf_external_commercial_evidence', name: 'nf_external_commercial_evidence_immutable', functionName: 'nf_commercial_append_only_row', triggerType: 27, identityColumns: [] }),
  Object.freeze({ table: 'nf_external_commercial_verifier_callbacks', name: 'nf_external_commercial_verifier_callbacks_immutable', functionName: 'nf_commercial_append_only_row', triggerType: 27, identityColumns: [] }),
  Object.freeze({ table: 'nf_precision_cad_commercial_callbacks', name: 'nf_precision_cad_commercial_callbacks_immutable', functionName: 'nf_commercial_append_only_row', triggerType: 27, identityColumns: [] }),
  Object.freeze({ table: 'nf_commercial_generation_receipt_bindings', name: 'nf_commercial_generation_receipt_binding_identity_immutable', functionName: 'nf_commercial_identity_immutable', triggerType: 19, identityColumns: ['tenant_id', 'project_id', 'run_id', 'receipt_id', 'generation_revision', 'workspace_revision', 'generation_program_sha256', 'target_sha256', 'created_at'] }),
  Object.freeze({ table: 'nf_external_commercial_verification_requests', name: 'nf_external_verification_request_identity_immutable', functionName: 'nf_commercial_identity_immutable', triggerType: 19, identityColumns: ['request_id', 'tenant_id', 'project_id', 'execution_id', 'generation_run_id', 'revision', 'model_content_hash', 'target_sha256', 'evidence_manifest_sha256', 'request_sha256', 'sequence', 'issued_at'] }),
  Object.freeze({ table: 'nf_commercial_generation_runs', name: 'nf_commercial_generation_run_identity_immutable', functionName: 'nf_commercial_identity_immutable', triggerType: 19, identityColumns: ['tenant_id', 'project_id', 'run_id', 'workspace_id', 'workspace_revision', 'created_at'] }),
]);

const FORBIDDEN_SQL = /\b(?:ALTER|CREATE|DROP|TRUNCATE|INSERT|UPDATE|DELETE|MERGE|CALL|DO|EXECUTE|VALIDATE|APPLY)\b/i;

export function assertSelectOnly(sql) {
  if (!/^\s*SELECT\b/i.test(sql) || FORBIDDEN_SQL.test(sql)) {
    throw new Error('readonly_verifier_rejected_non_select');
  }
}

async function selectOnly(client, sql, params = []) {
  assertSelectOnly(sql);
  return client.query(sql, params);
}

function checksum(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

function countValue(value) {
  if (value === null || value === undefined) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function migrationState(row, sourceChecksum) {
  const present = Number(row?.version) === MIGRATION_VERSION;
  const databaseChecksum = typeof row?.checksum === 'string' ? row.checksum : null;
  return {
    present,
    name: present && typeof row?.name === 'string' ? row.name : null,
    databaseChecksum,
    sourceChecksum,
    checksumMatchesSource: present && databaseChecksum === sourceChecksum,
  };
}

export function evaluateHardeningVerification({ migration, constraints, triggers, sourceChecksum }) {
  const migrationResult = migrationState(migration, sourceChecksum);
  const constraintResults = REQUIRED_CONSTRAINTS.map(required => {
    const observed = constraints?.find(item => item?.name === required.name && item?.table === required.table) ?? null;
    const violationCount = countValue(observed?.violationCount);
    return {
      table: required.table,
      name: required.name,
      kind: required.kind,
      present: Boolean(observed),
      typeMatches: Boolean(observed && observed.type === required.type),
      validated: Boolean(observed?.validated),
      violationCount,
    };
  });
  const triggerResults = REQUIRED_TRIGGERS.map(required => {
    const observed = triggers?.find(item => item?.name === required.name && item?.table === required.table) ?? null;
    const definition = typeof observed?.definition === 'string' ? observed.definition.toLowerCase() : '';
    const definitionMatches = Boolean(observed
      && observed.functionName === required.functionName
      && Number(observed.triggerType) === required.triggerType
      && required.identityColumns.every(column => definition.includes(`'${column}'`)));
    return {
      table: required.table,
      name: required.name,
      present: Boolean(observed),
      enabled: Boolean(observed && observed.enabled),
      definitionMatches,
    };
  });

  const blockers = [];
  if (!migrationResult.present) blockers.push(`migration_missing:${MIGRATION_VERSION}`);
  if (!migrationResult.checksumMatchesSource) blockers.push(`migration_checksum_mismatch:${MIGRATION_VERSION}`);
  for (const constraint of constraintResults) {
    if (!constraint.present) blockers.push(`constraint_missing:${constraint.name}`);
    else if (!constraint.typeMatches) blockers.push(`constraint_type_mismatch:${constraint.name}`);
    if (constraint.violationCount === null) blockers.push(`constraint_violation_count_unavailable:${constraint.name}`);
    else if (constraint.violationCount > 0) blockers.push(`constraint_violations:${constraint.name}:${constraint.violationCount}`);
    if (constraint.present && !constraint.validated) blockers.push(`constraint_not_valid:${constraint.name}`);
  }
  for (const trigger of triggerResults) {
    if (!trigger.present) blockers.push(`trigger_missing:${trigger.name}`);
    else if (!trigger.enabled) blockers.push(`trigger_disabled:${trigger.name}`);
    if (trigger.present && !trigger.definitionMatches) blockers.push(`trigger_definition_mismatch:${trigger.name}`);
  }

  const validationPlan = constraintResults.map(constraint => {
    const canValidate = constraint.present && constraint.typeMatches && constraint.violationCount === 0 && !constraint.validated;
    return {
      table: constraint.table,
      constraint: constraint.name,
      status: constraint.validated ? 'COMPLETE' : canValidate ? 'READY_FOR_APPROVED_CHANGE' : 'BLOCKED',
      violationCount: constraint.violationCount,
      sql: canValidate ? `ALTER TABLE public.${constraint.table} VALIDATE CONSTRAINT ${constraint.name};` : null,
    };
  });

  return {
    schema: RESULT_SCHEMA,
    migrationVersion: MIGRATION_VERSION,
    readOnly: true,
    mutationsAttempted: false,
    status: blockers.length === 0 ? 'PASS' : 'HOLD',
    migration: migrationResult,
    constraints: constraintResults,
    triggers: triggerResults,
    validationPlan,
    blockers,
  };
}

export async function inspectCommercialHardening({ client, migrationSqlPath = path.resolve(process.cwd(), 'src/lib/db-postgres-migration-2026082208.sql') }) {
  const sourceChecksum = checksum(fs.readFileSync(migrationSqlPath));
  const migrationQuery = await selectOnly(
    client,
    'SELECT version, name, checksum FROM public.nf_schema_migrations WHERE version = $1',
    [MIGRATION_VERSION],
  );
  const constraintQuery = await selectOnly(client, `SELECT c.conname AS name, r.relname AS table_name,
      c.contype AS type, c.convalidated AS validated
    FROM pg_constraint AS c
    JOIN pg_class AS r ON r.oid = c.conrelid
    JOIN pg_namespace AS n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public' AND c.conname = ANY($1::text[])
    ORDER BY c.conname`, [REQUIRED_CONSTRAINTS.map(item => item.name)]);
  const triggerQuery = await selectOnly(client, `SELECT t.tgname AS name, r.relname AS table_name,
      t.tgenabled AS enabled, t.tgisinternal AS internal, t.tgtype AS trigger_type,
      p.proname AS function_name, pg_get_triggerdef(t.oid, true) AS definition
    FROM pg_trigger AS t
    JOIN pg_class AS r ON r.oid = t.tgrelid
    JOIN pg_namespace AS n ON n.oid = r.relnamespace
    JOIN pg_proc AS p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
      AND t.tgname = ANY($1::text[])
    ORDER BY t.tgname`, [REQUIRED_TRIGGERS.map(item => item.name)]);

  const violations = [];
  for (const required of REQUIRED_CONSTRAINTS) {
    const result = await selectOnly(client, required.violationSql);
    violations.push({ name: required.name, table: required.table, violationCount: result.rows?.[0]?.count ?? null });
  }
  return evaluateHardeningVerification({
    migration: migrationQuery.rows?.[0] ?? null,
    sourceChecksum,
    constraints: (constraintQuery.rows ?? []).map(row => ({
      name: row.name,
      table: row.table_name,
      type: row.type,
      validated: row.validated,
      violationCount: violations.find(item => item.name === row.name && item.table === row.table_name)?.violationCount ?? null,
    })),
    triggers: (triggerQuery.rows ?? []).map(row => ({
      name: row.name,
      table: row.table_name,
      enabled: row.enabled !== 'D' && row.enabled !== false,
      triggerType: row.trigger_type,
      functionName: row.function_name,
      definition: row.definition,
    })),
  });
}

function errorResult(code) {
  return {
    schema: RESULT_SCHEMA,
    migrationVersion: MIGRATION_VERSION,
    readOnly: true,
    mutationsAttempted: false,
    status: 'HOLD',
    error: code,
    blockers: [code],
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stdout.write(`${JSON.stringify(errorResult('database_url_missing'), null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: 'nexyfab-2208-readonly-verifier' });
  try {
    await client.connect();
    const result = await inspectCommercialHardening({ client });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === 'PASS' ? 0 : 1;
  } catch {
    process.stdout.write(`${JSON.stringify(errorResult('database_readonly_inspection_failed'), null, 2)}\n`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
