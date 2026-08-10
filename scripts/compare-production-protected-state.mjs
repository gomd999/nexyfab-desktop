#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

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
  return byIdentity;
}

export async function compareProtectedState({ baselineUrl, candidateUrl }) {
  const baseline = new pg.Client({ connectionString: baselineUrl });
  const candidate = new pg.Client({ connectionString: candidateUrl });
  await Promise.all([baseline.connect(), candidate.connect()]);
  try {
    const [baselineSchema, candidateSchema] = await Promise.all([describe(baseline), describe(candidate)]);
    const blockers = [];
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
      const [before, after] = await Promise.all([
        tableRows(baseline, table, primaryKey, stable),
        tableRows(candidate, table, primaryKey, stable),
      ]);
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
      };
    }
    return {
      schema: 'nexyfab.production-protected-state-compare.v1',
      generatedAt: new Date().toISOString(),
      ok: blockers.length === 0,
      policy: 'Every pre-release protected row and stable field must remain present and unchanged; volatile login/session telemetry is excluded while credential hashes remain protected.',
      protectedTableCount: baselineSchema.size,
      tables,
      blockers,
    };
  } finally {
    await Promise.allSettled([baseline.end(), candidate.end()]);
  }
}

export async function main() {
  const baselineUrl = process.env.BASELINE_DATABASE_URL;
  const candidateUrl = process.env.DATABASE_URL;
  if (!baselineUrl || !candidateUrl) throw new Error('BASELINE_DATABASE_URL and DATABASE_URL are required');
  const output = path.resolve(process.env.PROTECTED_STATE_RECEIPT_OUTPUT ?? 'docs/evidence/release/production-protected-state-receipt.json');
  const receipt = await compareProtectedState({ baselineUrl, candidateUrl });
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
