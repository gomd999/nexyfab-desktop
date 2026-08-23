#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { attachReceiptSha256, verifyReceiptSha256 } from './immutable-receipt-binding.mjs';
import { ORDERED_MIGRATION_DESCRIPTORS, runPostgresMigration } from './run-postgres-migrations.mjs';

export const COMMERCIAL_MIGRATION_VERSIONS = Object.freeze([
  2026082202, 2026082203, 2026082204, 2026082205, 2026082206, 2026082207, 2026082208,
]);
export const PRODUCTION_MIGRATION_RECEIPT_SCHEMA = 'nexyfab.postgres-migration-receipt.v2';
export const PRODUCTION_TARGET = 'production';
export const RECEIPT_MAX_AGE_MS = 24 * 60 * 60_000;

const SHA256 = /^[a-f0-9]{64}$/i;
const GIT_COMMIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const quoteIdentifier = value => `"${String(value).replaceAll('"', '""')}"`;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytesDigest = bytes => createHash('sha256').update(bytes).digest('hex');

export function changedBusinessRowCounts(beforeBusinessRows = [], afterBusinessRows = []) {
  const beforeRows = new Map(beforeBusinessRows ?? []);
  const afterRows = new Map(afterBusinessRows ?? []);
  return [...new Set([...beforeRows.keys(), ...afterRows.keys()])]
    .filter(table => (beforeRows.get(table) ?? 0) !== (afterRows.get(table) ?? 0))
    .sort();
}

function commercialDescriptors(descriptors = ORDERED_MIGRATION_DESCRIPTORS) {
  const byVersion = new Map(descriptors.map(descriptor => [Number(descriptor.version), descriptor]));
  return COMMERCIAL_MIGRATION_VERSIONS.map(version => {
    const descriptor = byVersion.get(version);
    if (!descriptor) throw new Error(`commercial_migration_descriptor_missing:${version}`);
    return descriptor;
  });
}

function normalizedRelativePath(root, sourcePath) {
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, sourcePath);
  const relative = path.relative(resolvedRoot, absolute).replaceAll('\\', '/');
  if (!relative || relative === '.' || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error('unsafe_migration_source_path');
  }
  return relative;
}

function sourceBinding({ root, descriptor }) {
  const relativePath = normalizedRelativePath(root, descriptor.sqlFile);
  const absolute = path.resolve(root, relativePath);
  const linkStat = fs.lstatSync(absolute);
  if (linkStat.isSymbolicLink()) throw new Error(`migration_source_symlink_rejected:${relativePath}`);
  const realRoot = fs.realpathSync.native(path.resolve(root));
  const realFile = fs.realpathSync.native(absolute);
  const realRelative = path.relative(realRoot, realFile);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error(`migration_source_symlink_rejected:${relativePath}`);
  }
  const stat = fs.statSync(realFile);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`migration_source_not_a_file:${relativePath}`);
  const bytes = fs.readFileSync(realFile);
  return { path: relativePath, bytes: bytes.byteLength, sha256: bytesDigest(bytes) };
}

export function readCommercialMigrationSources({ root = process.cwd(), descriptors = ORDERED_MIGRATION_DESCRIPTORS } = {}) {
  return commercialDescriptors(descriptors).map(descriptor => ({
    version: Number(descriptor.version),
    name: descriptor.name,
    source: sourceBinding({ root, descriptor }),
  }));
}

function realGitHead(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function releaseMetadata({ release = {}, root = process.cwd(), env = process.env } = {}) {
  return {
    buildId: release.buildId ?? env.RELEASE_BUILD_ID ?? env.NEXYFAB_BUILD_ID ?? null,
    deploymentId: release.deploymentId ?? env.RELEASE_DEPLOYMENT_ID ?? env.RAILWAY_DEPLOYMENT_ID ?? null,
    gitHead: release.gitHead ?? env.RELEASE_GIT_HEAD ?? env.RAILWAY_GIT_COMMIT_SHA ?? realGitHead(root),
  };
}

function validSnapshot(snapshot) {
  if (!snapshot || !Number.isInteger(snapshot.tableCount) || snapshot.tableCount < 0
    || !Number.isSafeInteger(snapshot.totalRows) || snapshot.totalRows < 0
    || !SHA256.test(String(snapshot.businessRowCountSha256 ?? ''))
    || !Array.isArray(snapshot.businessRows)) return false;
  const names = new Set();
  let businessTotalRows = 0;
  for (const row of snapshot.businessRows) {
    if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !row[0]
      || names.has(row[0]) || !Number.isSafeInteger(row[1]) || row[1] < 0) return false;
    names.add(row[0]);
    businessTotalRows += row[1];
    if (!Number.isSafeInteger(businessTotalRows)) return false;
  }
  return snapshot.tableCount >= snapshot.businessRows.length
    && snapshot.totalRows >= businessTotalRows
    && snapshot.businessRowCountSha256 === digest(snapshot.businessRows);
}

function receiptBlockers({ target, release, migration, sources, before, after, changedBusinessTables, generatedAt }) {
  const blockers = [];
  if (target !== PRODUCTION_TARGET) blockers.push('target_not_production');
  if (typeof release?.buildId !== 'string' || !release.buildId.trim()) blockers.push('release_build_id_missing');
  if (typeof release?.deploymentId !== 'string' || !release.deploymentId.trim()) blockers.push('release_deployment_id_missing');
  if (!GIT_COMMIT_SHA.test(String(release?.gitHead ?? ''))) blockers.push('release_git_head_invalid');
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp)) blockers.push('generated_at_invalid');
  if (!Array.isArray(sources) || sources.length !== COMMERCIAL_MIGRATION_VERSIONS.length) blockers.push('migration_sources_incomplete');
  const observed = new Map(Array.isArray(migration?.migrations)
    ? migration.migrations.map(item => [Number(item?.version), item]) : []);
  if (migration?.ok !== true) blockers.push('migration_action_incomplete');
  for (const version of COMMERCIAL_MIGRATION_VERSIONS) {
    const source = sources?.find(item => item.version === version)?.source;
    const database = observed.get(version);
    if (!database) {
      blockers.push(`migration_observation_missing:${version}`);
      continue;
    }
    if (!SHA256.test(String(database.checksum ?? '')) || database.checksum !== source?.sha256) blockers.push(`migration_checksum_mismatch:${version}`);
    if (!['apply', 'already_applied'].includes(database.decision)) blockers.push(`migration_decision_incomplete:${version}`);
  }
  if (!validSnapshot(before)) blockers.push('before_observation_incomplete');
  if (!validSnapshot(after)) blockers.push('after_observation_incomplete');
  if (changedBusinessTables.length > 0) blockers.push(`business_row_counts_changed:${changedBusinessTables.join(',')}`);
  return [...new Set(blockers)];
}

export function buildMigrationReceipt({
  migration = null, before = null, after = null, target = PRODUCTION_TARGET, release = null,
  root = process.cwd(), generatedAt = new Date().toISOString(), descriptors = ORDERED_MIGRATION_DESCRIPTORS,
} = {}) {
  let sources = [];
  let sourceError = null;
  try { sources = readCommercialMigrationSources({ root, descriptors }); } catch (error) { sourceError = error; }
  const resolvedRelease = releaseMetadata({ release: release ?? {}, root });
  const changedBusinessTables = validSnapshot(before) && validSnapshot(after)
    ? changedBusinessRowCounts(before.businessRows, after.businessRows) : [];
  const blockers = receiptBlockers({ target, release: resolvedRelease, migration, sources, before, after, changedBusinessTables, generatedAt });
  if (sourceError) blockers.push('migration_source_unavailable');
  const observed = new Map(Array.isArray(migration?.migrations)
    ? migration.migrations.map(item => [Number(item?.version), item]) : []);
  const migrations = sources.map(item => {
    const database = observed.get(item.version) ?? null;
    return {
      version: item.version, name: item.name, source: item.source,
      sourcePath: item.source.path, sourceBytes: item.source.bytes, sourceSha256: item.source.sha256,
      databaseChecksum: typeof database?.checksum === 'string' ? database.checksum : null,
      decision: typeof database?.decision === 'string' ? database.decision : null,
      checksumMatchesSource: database?.checksum === item.source.sha256,
    };
  });
  const timestamp = Date.parse(generatedAt);
  const expiresAt = Number.isFinite(timestamp) ? new Date(timestamp + RECEIPT_MAX_AGE_MS).toISOString() : null;
  const complete = blockers.length === 0;
  return attachReceiptSha256({
    schema: PRODUCTION_MIGRATION_RECEIPT_SCHEMA, generatedAt, ok: complete, status: complete ? 'PASS' : 'HOLD',
    target, release: resolvedRelease, freshness: { generatedAt, maxAgeMs: RECEIPT_MAX_AGE_MS, expiresAt }, migrations,
    before: validSnapshot(before) ? { tableCount: before.tableCount, totalRows: before.totalRows, businessRowCountSha256: before.businessRowCountSha256 } : null,
    after: validSnapshot(after) ? { tableCount: after.tableCount, totalRows: after.totalRows, businessRowCountSha256: after.businessRowCountSha256 } : null,
    changedBusinessTables, blockers,
  });
}

export const buildProductionMigrationReceipt = buildMigrationReceipt;

export function verifyMigrationReceipt(receipt, {
  root = process.cwd(), expectedRelease = null, now = Date.now(), maxAgeMs = RECEIPT_MAX_AGE_MS, expectedTarget = PRODUCTION_TARGET,
} = {}) {
  const blockers = [];
  const fail = code => blockers.push(code);
  const generatedAt = Date.parse(receipt?.generatedAt);
  if (receipt?.schema !== PRODUCTION_MIGRATION_RECEIPT_SCHEMA) fail('receipt_schema_invalid');
  if (receipt?.ok !== true || receipt?.status !== 'PASS') fail('receipt_not_pass');
  if (receipt?.target !== expectedTarget) fail('receipt_target_mismatch');
  if (!Number.isFinite(generatedAt) || generatedAt > now + 5 * 60_000 || generatedAt < now - maxAgeMs) fail('receipt_stale');
  if (receipt?.freshness?.generatedAt !== receipt?.generatedAt
    || receipt?.freshness?.maxAgeMs !== RECEIPT_MAX_AGE_MS) fail('receipt_freshness_unbound');
  if (!verifyReceiptSha256(receipt)) fail('receipt_hash_mismatch');
  const release = receipt?.release;
  if (typeof release?.buildId !== 'string' || !release.buildId) fail('release_build_id_missing');
  if (typeof release?.deploymentId !== 'string' || !release.deploymentId) fail('release_deployment_id_missing');
  if (!GIT_COMMIT_SHA.test(String(release?.gitHead ?? ''))) fail('release_git_head_invalid');
  const expectedGitHead = expectedRelease?.head ?? expectedRelease?.gitHead;
  if (expectedRelease && (release.buildId !== expectedRelease.buildId || release.deploymentId !== expectedRelease.deploymentId || release.gitHead !== expectedGitHead)) fail('release_binding_mismatch');
  if (!Array.isArray(receipt?.migrations) || receipt.migrations.length !== COMMERCIAL_MIGRATION_VERSIONS.length) fail('migration_set_incomplete');
  else {
    let actualSources = [];
    try { actualSources = readCommercialMigrationSources({ root }); } catch { fail('migration_source_unavailable'); }
    const byVersion = new Map(receipt.migrations.map(item => [item?.version, item]));
    for (const item of actualSources) {
      const bound = byVersion.get(item.version);
      if (!bound || bound.source?.path !== item.source.path || bound.source?.bytes !== item.source.bytes
        || bound.source?.sha256 !== item.source.sha256 || bound.sourceSha256 !== item.source.sha256
        || bound.sourceBytes !== item.source.bytes || bound.databaseChecksum !== item.source.sha256
        || !['apply', 'already_applied'].includes(bound.decision)) fail(`migration_binding_invalid:${item.version}`);
    }
  }
  if (!Array.isArray(receipt?.blockers) || receipt.blockers.length !== 0) fail('receipt_blockers_present');
  return { ok: blockers.length === 0, blockers: [...new Set(blockers)] };
}

export const verifyProductionMigrationReceipt = verifyMigrationReceipt;

async function snapshotRows(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name")).rows.map(row => String(row.table_name));
    const rows = [];
    for (const table of tables) {
      const result = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${quoteIdentifier(table)}`);
      rows.push([table, Number(result.rows[0].count)]);
    }
    const businessRows = rows.filter(([table]) => table !== 'nf_schema_migrations');
    return { observed: true, tableCount: tables.length, totalRows: rows.reduce((sum, [, count]) => sum + count, 0), businessRowCountSha256: digest(businessRows), businessRows };
  } finally { await client.end(); }
}

export async function migrateWithReceipt({ databaseUrl, sqlPath, outputPath, target = PRODUCTION_TARGET, release, root = process.cwd() }) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (target !== PRODUCTION_TARGET) throw new Error('migration_target_must_be_production');
  let before = null;
  let migration = null;
  let after = null;
  let failure = null;
  try {
    before = await snapshotRows(databaseUrl);
  } catch (error) {
    // A failed preflight observation must never be followed by a migration
    // action. Persist a HOLD receipt so the failure is auditable.
    failure = error;
  }
  if (before) {
    try { migration = await runPostgresMigration({ databaseUrl, sqlPath }); } catch (error) { failure = error; }
    if (migration) {
      try { after = await snapshotRows(databaseUrl); } catch (error) { failure = failure ?? error; }
    }
  }
  const receipt = buildMigrationReceipt({ migration, before, after, target, release, root });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
  if (!receipt.ok) throw new Error(`${failure instanceof Error ? failure.message : 'migration_receipt_not_pass'}:${receipt.blockers.join(',')}`);
  return receipt;
}

if (import.meta.url === new URL(`file:///${process.argv[1]?.replaceAll('\\', '/')}`).href) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const outputPath = path.resolve(process.env.MIGRATION_RECEIPT_OUTPUT ?? 'docs/evidence/release/production-migration-receipt.json');
  const sqlPath = path.resolve(process.env.POSTGRES_MIGRATION_SQL ?? 'src/lib/db-postgres-migrations.sql');
  const target = process.env.MIGRATION_TARGET ?? PRODUCTION_TARGET;
  const release = { buildId: process.env.RELEASE_BUILD_ID ?? process.env.NEXYFAB_BUILD_ID, deploymentId: process.env.RELEASE_DEPLOYMENT_ID ?? process.env.RAILWAY_DEPLOYMENT_ID, gitHead: process.env.RELEASE_GIT_HEAD ?? process.env.RAILWAY_GIT_COMMIT_SHA };
  migrateWithReceipt({ databaseUrl, sqlPath, outputPath, target, release })
    .then(receipt => process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`))
    .catch(error => { process.stderr.write(`[postgres-migration-receipt] ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
