#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { attachReceiptSha256, sha256, verifyReceiptSha256 } from './immutable-receipt-binding.mjs';

export const PROTECTED_STATE_RECEIPT_SCHEMA = 'nexyfab.production-protected-state-compare.v2';
export const PROTECTED_STATE_MAX_AGE_MS = 24 * 60 * 60_000;
const SHA256 = /^[a-f0-9]{64}$/i;
const GIT_SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;

const quote = value => `"${String(value).replaceAll('"', '""')}"`;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const protectedPatterns = [
  /^nf_users$/,
  /^nf_(projects|files|documents|document_permissions|document_versions|document_locks|shares|comments)$/,
  /^nf_(workspaces|workspace_members)$/,
  /^nf_(rfqs|quotes|contracts|orders)$/,
  /^nf_(factories|partner_tokens|partner_sessions|partner_invites)$/,
  /^nf_(orgs|org_members|teams|team_members)$/,
  /^partner_applications$/,
];
const volatileColumns = new Set([
  'updated_at', 'last_login', 'last_login_at', 'last_seen_at', 'last_active_at',
  'accessed_at', 'last_used_at', 'expires_at', 'revoked_at', 'failed_login_attempts',
  'locked_until', 'session_version', 'login_count', 'last_login_fingerprint',
  'last_login_ip',
]);

export function databaseIdentitySha256(connectionString) {
  const url = new URL(connectionString);
  return sha256({ protocol: url.protocol, hostname: url.hostname.toLowerCase(), port: url.port, database: decodeURIComponent(url.pathname.replace(/^\//, '')) });
}

async function describe(client) {
  const tables = (await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
  )).rows.map(row => String(row.table_name)).filter(name => protectedPatterns.some(pattern => pattern.test(name)));
  const result = new Map();
  for (const table of tables) {
    const columns = (await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
      [table],
    )).rows.map(row => String(row.column_name));
    const primaryKey = (await client.query(
      `SELECT a.attname AS column_name
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
        WHERE i.indrelid=$1::regclass AND i.indisprimary
        ORDER BY array_position(i.indkey, a.attnum)`,
      [`public.${quote(table)}`],
    )).rows.map(row => String(row.column_name));
    result.set(table, { columns, primaryKey });
  }
  return result;
}

export function stableColumns(table, columns) {
  return columns.filter(column => {
    if (volatileColumns.has(column)) return false;
    if (/sessions?$/.test(table) && /(token|secret|nonce)/i.test(column)) return false;
    return true;
  });
}

async function tableRows(client, table, primaryKey, stable) {
  const selected = [...new Set([...primaryKey, ...stable])];
  const order = primaryKey.length ? ` ORDER BY ${primaryKey.map(quote).join(', ')}` : '';
  const rows = (await client.query(`SELECT ${selected.map(quote).join(', ')} FROM ${quote(table)}${order}`)).rows;
  const byIdentity = new Map();
  for (const row of rows) {
    const identity = primaryKey.length
      ? JSON.stringify(primaryKey.map(column => row[column] ?? null))
      : hash(stable.map(column => [column, row[column] ?? null]));
    byIdentity.set(identity, Object.fromEntries(
      stable.map(column => [column, hash(row[column] ?? null)]),
    ));
  }
  return { rows: byIdentity, stateSha256: hash([...byIdentity.entries()]) };
}

function releaseBlockers(release) {
  return [
    ...(typeof release?.buildId === 'string' && release.buildId.trim() ? [] : ['release_build_id_missing']),
    ...(typeof release?.deploymentId === 'string' && release.deploymentId.trim() ? [] : ['release_deployment_id_missing']),
    ...(GIT_SHA.test(String(release?.gitHead ?? '')) ? [] : ['release_git_head_invalid']),
  ];
}

/** Build an immutable receipt from already-observed database state. This pure
 * boundary keeps receipt tests deterministic and makes `ok` derived solely
 * from blockers rather than from a caller-supplied label. */
export function buildProtectedStateReceipt({
  tables = {}, blockers = [], evidence, release = null, generatedAt = new Date().toISOString(), now = Date.now(),
} = {}) {
  const derivedBlockers = [...(Array.isArray(blockers) ? blockers : ['blockers_malformed']), ...releaseBlockers(release)];
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp) || timestamp > now + 5 * 60_000 || timestamp < now - PROTECTED_STATE_MAX_AGE_MS) derivedBlockers.push('generated_at_stale_or_invalid');
  const uniqueBlockers = [...new Set(derivedBlockers)];
  const unsigned = {
    schema: PROTECTED_STATE_RECEIPT_SCHEMA,
    generatedAt,
    ok: uniqueBlockers.length === 0,
    status: uniqueBlockers.length === 0 ? 'PASS' : 'HOLD',
    policy: 'Every pre-release protected row and stable field must remain present and unchanged; volatile login/session telemetry is excluded while credential hashes remain protected.',
    protectedTableCount: Object.keys(tables ?? {}).length,
    tables: tables && typeof tables === 'object' ? tables : {},
    blockers: uniqueBlockers,
    release,
    freshness: {
      generatedAt,
      maxAgeMs: PROTECTED_STATE_MAX_AGE_MS,
      expiresAt: Number.isFinite(timestamp) ? new Date(timestamp + PROTECTED_STATE_MAX_AGE_MS).toISOString() : null,
    },
    evidence: evidence ?? null,
  };
  return attachReceiptSha256({
    ...unsigned,
    comparisonSha256: sha256({ tables: unsigned.tables, blockers: unsigned.blockers, evidence: unsigned.evidence }),
  });
}

export function verifyProtectedStateReceipt(receipt, {
  expectedRelease = null, now = Date.now(), maxAgeMs = PROTECTED_STATE_MAX_AGE_MS,
} = {}) {
  const blockers = [];
  const generatedAt = Date.parse(receipt?.generatedAt);
  if (receipt?.schema !== PROTECTED_STATE_RECEIPT_SCHEMA) blockers.push('receipt_schema_invalid');
  if (receipt?.ok !== true || receipt?.status !== 'PASS') blockers.push('receipt_not_pass');
  if (!Number.isFinite(generatedAt) || generatedAt > now + 5 * 60_000 || generatedAt < now - maxAgeMs) blockers.push('receipt_stale');
  if (receipt?.freshness?.generatedAt !== receipt?.generatedAt || receipt?.freshness?.maxAgeMs !== PROTECTED_STATE_MAX_AGE_MS
    || receipt?.freshness?.expiresAt !== (Number.isFinite(generatedAt) ? new Date(generatedAt + PROTECTED_STATE_MAX_AGE_MS).toISOString() : null)) blockers.push('receipt_freshness_unbound');
  if (!verifyReceiptSha256(receipt)) blockers.push('receipt_hash_mismatch');
  if (releaseBlockers(receipt?.release).length) blockers.push('release_metadata_invalid');
  const expectedGit = expectedRelease?.head ?? expectedRelease?.gitHead;
  if (expectedRelease && (receipt?.release?.buildId !== expectedRelease.buildId || receipt?.release?.deploymentId !== expectedRelease.deploymentId || receipt?.release?.gitHead !== expectedGit)) blockers.push('release_binding_mismatch');
  const tables = receipt?.tables;
  if (!tables || typeof tables !== 'object' || Array.isArray(tables) || Object.keys(tables).length === 0
    || receipt?.protectedTableCount !== Object.keys(tables).length) blockers.push('table_count_invalid');
  const tableEntries = tables && typeof tables === 'object' ? Object.entries(tables) : [];
  for (const [table, value] of tableEntries) {
    if (!table || !value || !Number.isInteger(value.baselineRows) || value.baselineRows < 0
      || !Number.isInteger(value.candidateRows) || value.candidateRows < 0
      || !Number.isInteger(value.newRows) || value.newRows < 0
      || !Number.isInteger(value.missingRows) || value.missingRows < 0
      || !Number.isInteger(value.changedExistingRows) || value.changedExistingRows < 0
      || !Number.isInteger(value.primaryKeyColumns) || value.primaryKeyColumns <= 0
      || !Number.isInteger(value.stableColumnCount) || value.stableColumnCount < 0
      || !SHA256.test(String(value.stableColumnSetSha256 ?? ''))
      || !SHA256.test(String(value.baselineStateSha256 ?? '')) || !SHA256.test(String(value.candidateStateSha256 ?? ''))
      || !value.changedColumns || typeof value.changedColumns !== 'object' || Array.isArray(value.changedColumns)) blockers.push(`table_shape_invalid:${table}`);
    const changedColumnCounts = value?.changedColumns && typeof value.changedColumns === 'object' && !Array.isArray(value.changedColumns)
      ? Object.values(value.changedColumns) : [];
    if (value?.missingRows !== 0 || value?.changedExistingRows !== 0
      || value?.candidateRows !== value?.baselineRows + value?.newRows
      || (value?.newRows === 0 && value?.baselineStateSha256 !== value?.candidateStateSha256)
      || changedColumnCounts.length !== 0
      || changedColumnCounts.some(count => !Number.isInteger(count) || count <= 0)) blockers.push(`table_derivation_invalid:${table}`);
  }
  if (!Array.isArray(receipt?.blockers) || receipt.blockers.length !== 0) blockers.push('receipt_blockers_present');
  const evidence = receipt?.evidence;
  const validEvidence = SHA256.test(String(evidence?.baseline?.identitySha256 ?? ''))
    && SHA256.test(String(evidence?.baseline?.stateSha256 ?? ''))
    && SHA256.test(String(evidence?.candidate?.identitySha256 ?? ''))
    && SHA256.test(String(evidence?.candidate?.stateSha256 ?? ''))
    && evidence.baseline.identitySha256 !== evidence.candidate.identitySha256;
  if (!validEvidence) blockers.push('state_evidence_invalid');
  const expectedBaselineState = sha256(Object.fromEntries(tableEntries.map(([table, value]) => [table, value?.baselineStateSha256])));
  const expectedCandidateState = sha256(Object.fromEntries(tableEntries.map(([table, value]) => [table, value?.candidateStateSha256])));
  if (validEvidence && (evidence.baseline.stateSha256 !== expectedBaselineState || evidence.candidate.stateSha256 !== expectedCandidateState)) blockers.push('state_derivation_mismatch');
  if (receipt?.ok !== (Array.isArray(receipt?.blockers) && receipt.blockers.length === 0)) blockers.push('ok_label_not_derived');
  const comparisonSha256 = sha256({ tables: receipt?.tables, blockers: receipt?.blockers, evidence });
  if (!SHA256.test(String(receipt?.comparisonSha256 ?? '')) || receipt.comparisonSha256 !== comparisonSha256) blockers.push('comparison_hash_mismatch');
  return { ok: blockers.length === 0, blockers: [...new Set(blockers)] };
}

export const buildProductionProtectedStateReceipt = buildProtectedStateReceipt;
export const verifyProductionProtectedStateReceipt = verifyProtectedStateReceipt;

export async function compareProtectedState({ baselineUrl, candidateUrl, release = null, generatedAt = new Date().toISOString() }) {
  const baseline = new pg.Client({ connectionString: baselineUrl });
  const candidate = new pg.Client({ connectionString: candidateUrl });
  await Promise.all([baseline.connect(), candidate.connect()]);
  try {
    const [baselineSchema, candidateSchema] = await Promise.all([describe(baseline), describe(candidate)]);
    const blockers = [];
    const baselineTableNames = [...baselineSchema.keys()].sort();
    const candidateTableNames = [...candidateSchema.keys()].sort();
    if (JSON.stringify(baselineTableNames) !== JSON.stringify(candidateTableNames)) blockers.push('protected_table_set_changed');
    const tables = {};
    for (const [table, baselineInfo] of baselineSchema) {
      const candidateInfo = candidateSchema.get(table);
      if (!candidateInfo) {
        blockers.push(`protected_table_missing:${table}`);
        continue;
      }
      const primaryKey = baselineInfo.primaryKey;
      const stable = stableColumns(table, baselineInfo.columns);
      if (primaryKey.length === 0) blockers.push(`primary_key_missing:${table}`);
      if (hash(baselineInfo.columns) !== hash(candidateInfo.columns)) blockers.push(`columns_changed:${table}`);
      if (hash(primaryKey) !== hash(candidateInfo.primaryKey)) blockers.push(`primary_key_changed:${table}`);
      const [beforeSnapshot, afterSnapshot] = await Promise.all([
        tableRows(baseline, table, primaryKey, stable),
        tableRows(candidate, table, primaryKey, stable),
      ]);
      const before = beforeSnapshot.rows;
      const after = afterSnapshot.rows;
      let missingRows = 0;
      let changedExistingRows = 0;
      const changedColumns = {};
      for (const [identity, beforeFields] of before) {
        if (!after.has(identity)) missingRows += 1;
        else {
          const afterFields = after.get(identity);
          const columns = stable.filter(column => beforeFields[column] !== afterFields[column]);
          if (columns.length) {
            changedExistingRows += 1;
            for (const column of columns) changedColumns[column] = (changedColumns[column] ?? 0) + 1;
          }
        }
      }
      const newRows = [...after.keys()].filter(identity => !before.has(identity)).length;
      if (missingRows) blockers.push(`protected_rows_missing:${table}:${missingRows}`);
      if (changedExistingRows) blockers.push(`protected_rows_changed:${table}:${changedExistingRows}`);
      tables[table] = {
        baselineRows: before.size,
        candidateRows: after.size,
        newRows,
        missingRows,
        changedExistingRows,
        changedColumns,
        primaryKeyColumns: primaryKey.length,
        stableColumnCount: stable.length,
        stableColumnSetSha256: hash(stable),
        baselineStateSha256: beforeSnapshot.stateSha256,
        candidateStateSha256: afterSnapshot.stateSha256,
      };
    }
    const evidence = {
      baseline: {
        identitySha256: databaseIdentitySha256(baselineUrl),
        stateSha256: sha256(Object.fromEntries(Object.entries(tables).map(([table, value]) => [table, value.baselineStateSha256]))),
      },
      candidate: {
        identitySha256: databaseIdentitySha256(candidateUrl),
        stateSha256: sha256(Object.fromEntries(Object.entries(tables).map(([table, value]) => [table, value.candidateStateSha256]))),
      },
    };
    if (evidence.baseline.identitySha256 === evidence.candidate.identitySha256) blockers.push('database_identity_not_distinct');
    return buildProtectedStateReceipt({ tables, blockers, release, generatedAt, evidence });
  } finally {
    await Promise.allSettled([baseline.end(), candidate.end()]);
  }
}

export async function main() {
  const baselineUrl = process.env.BASELINE_DATABASE_URL;
  const candidateUrl = process.env.DATABASE_URL;
  if (!baselineUrl || !candidateUrl) throw new Error('BASELINE_DATABASE_URL and DATABASE_URL are required');
  const output = path.resolve(process.env.PROTECTED_STATE_RECEIPT_OUTPUT ?? 'docs/evidence/release/production-protected-state-receipt.json');
  const receipt = await compareProtectedState({
    baselineUrl,
    candidateUrl,
    release: {
      buildId: process.env.RELEASE_BUILD_ID ?? null,
      deploymentId: process.env.RELEASE_DEPLOYMENT_ID ?? null,
      gitHead: process.env.RELEASE_GIT_HEAD ?? null,
    },
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ ok: receipt.ok, protectedTableCount: receipt.protectedTableCount, blockers: receipt.blockers }));
  return receipt.ok ? 0 : 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) void main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(`[production-protected-state] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
