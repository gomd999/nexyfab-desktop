import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MIGRATION_RECEIPT_SCHEMA = 'nexyfab.postgres-migration-verification-receipt.v1';
export const MIGRATION_SOURCE_PATH = 'src/lib/db-postgres-migration-2026082208.sql';
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_COMMIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(Buffer.isBuffer(value) ? value : canonicalJson(value)).digest('hex');
}

function normalizedRelativePath(root, filePath) {
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, filePath);
  const relative = path.relative(resolvedRoot, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('unsafe_migration_source_path');
  }
  return relative.replaceAll('\\', '/');
}

function readSourceBinding({ root, sourcePath }) {
  const relativePath = normalizedRelativePath(root, sourcePath);
  const absolute = path.resolve(root, relativePath);
  const linkStat = fs.lstatSync(absolute);
  if (linkStat.isSymbolicLink()) throw new Error('migration_source_symlink_rejected');
  const realRoot = fs.realpathSync.native(path.resolve(root));
  const realFile = fs.realpathSync.native(absolute);
  const realRelative = path.relative(realRoot, realFile);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('migration_source_symlink_rejected');
  const stat = fs.statSync(realFile);
  if (!stat.isFile() || stat.size <= 0) throw new Error('migration_source_not_a_file');
  const bytes = fs.readFileSync(realFile);
  return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) };
}

function assertRelease(release) {
  if (typeof release?.buildId !== 'string' || release.buildId.length === 0) throw new Error('migration_release_build_id_missing');
  if (typeof release?.deploymentId !== 'string' || release.deploymentId.length === 0) throw new Error('migration_release_deployment_id_missing');
  if (!GIT_COMMIT_SHA.test(String(release?.gitHead ?? ''))) throw new Error('migration_release_git_head_invalid');
}

function unsignedReceipt(receipt) {
  const { receiptSha256: _ignored, ...unsigned } = receipt ?? {};
  return unsigned;
}

export function buildMigrationVerificationReceipt({
  verification,
  target,
  release,
  root = process.cwd(),
  sourcePath = MIGRATION_SOURCE_PATH,
  generatedAt = new Date().toISOString(),
}) {
  if (verification?.schema !== 'nexyfab.postgres-migration-2208-readonly-verification.v1') {
    throw new Error('migration_verification_schema_invalid');
  }
  if (Number(verification?.migrationVersion) !== 2026082208) throw new Error('migration_verification_version_invalid');
  if (verification?.readOnly !== true || verification?.mutationsAttempted !== false) {
    throw new Error('migration_verification_not_read_only');
  }
  if (typeof target !== 'string' || target.length === 0) throw new Error('migration_target_missing');
  assertRelease(release);

  const source = readSourceBinding({ root, sourcePath });
  const sourceChecksum = verification?.migration?.sourceChecksum;
  const databaseChecksum = verification?.migration?.databaseChecksum;
  if (source.sha256 !== sourceChecksum || !SHA256.test(String(databaseChecksum ?? ''))) {
    throw new Error('migration_source_checksum_unbound');
  }

  const receipt = {
    schema: MIGRATION_RECEIPT_SCHEMA,
    generatedAt,
    ok: verification.status === 'PASS',
    target,
    release: { buildId: release.buildId, deploymentId: release.deploymentId, gitHead: release.gitHead },
    source,
    migration: {
      version: 2026082208,
      sourceSha256: source.sha256,
      databaseChecksum,
      checksumMatchesSource: verification?.migration?.checksumMatchesSource === true,
    },
    verification,
    verificationSha256: sha256(verification),
  };
  return { ...receipt, receiptSha256: sha256(receipt) };
}

export function verifyMigrationVerificationReceipt(receipt, {
  expectedRelease = null,
  root = process.cwd(),
  now = Date.now(),
  maxAgeMs = 24 * 60 * 60_000,
  expectedTarget = null,
  expectedSourcePath = MIGRATION_SOURCE_PATH,
} = {}) {
  const generatedAt = Date.parse(receipt?.generatedAt);
  const source = receipt?.source;
  const migration = receipt?.migration;
  const verification = receipt?.verification;
  const blockers = [];
  const fail = code => blockers.push(code);

  if (receipt?.schema !== MIGRATION_RECEIPT_SCHEMA) fail('receipt_schema_invalid');
  if (receipt?.ok !== true) fail('receipt_not_ok');
  if (typeof receipt?.target !== 'string' || !receipt.target) fail('receipt_target_missing');
  if (expectedTarget !== null && receipt?.target !== expectedTarget) fail('receipt_target_mismatch');
  if (!Number.isFinite(generatedAt) || generatedAt > now + 5 * 60_000 || generatedAt < now - maxAgeMs) fail('receipt_stale');
  if (typeof receipt?.release?.buildId !== 'string' || !receipt.release.buildId) fail('release_build_id_missing');
  if (typeof receipt?.release?.deploymentId !== 'string' || !receipt.release.deploymentId) fail('release_deployment_id_missing');
  if (!GIT_COMMIT_SHA.test(String(receipt?.release?.gitHead ?? ''))) fail('release_git_head_invalid');
  const expectedGitHead = expectedRelease?.head ?? expectedRelease?.gitHead;
  if (!expectedRelease || typeof expectedRelease.buildId !== 'string' || !expectedRelease.buildId
    || typeof expectedRelease.deploymentId !== 'string' || !expectedRelease.deploymentId
    || !GIT_COMMIT_SHA.test(String(expectedGitHead ?? ''))) fail('release_expectation_missing');
  else if (receipt.release.buildId !== expectedRelease.buildId
    || receipt.release.deploymentId !== expectedRelease.deploymentId
    || receipt.release.gitHead !== expectedGitHead) fail('release_binding_mismatch');

  if (source?.path !== expectedSourcePath) fail('source_path_mismatch');
  if (!Number.isInteger(source?.bytes) || source.bytes <= 0) fail('source_bytes_invalid');
  if (!SHA256.test(String(source?.sha256 ?? ''))) fail('source_checksum_invalid');
  if (migration?.version !== 2026082208) fail('migration_version_invalid');
  if (migration?.sourceSha256 !== source?.sha256) fail('migration_source_checksum_mismatch');
  if (!SHA256.test(String(migration?.databaseChecksum ?? ''))) fail('migration_database_checksum_invalid');
  if (migration?.checksumMatchesSource !== true || migration.databaseChecksum !== migration.sourceSha256) fail('migration_checksum_mismatch');

  if (verification?.schema !== 'nexyfab.postgres-migration-2208-readonly-verification.v1'
    || verification?.migrationVersion !== 2026082208
    || verification?.status !== 'PASS'
    || verification?.readOnly !== true
    || verification?.mutationsAttempted !== false
    || !Array.isArray(verification?.blockers)
    || verification.blockers.length !== 0) fail('verification_not_pass');
  if (verification?.migration?.sourceChecksum !== source?.sha256
    || verification?.migration?.databaseChecksum !== migration?.databaseChecksum
    || verification?.migration?.checksumMatchesSource !== true) fail('verification_migration_unbound');
  if (receipt?.verificationSha256 !== sha256(verification)) fail('verification_hash_mismatch');
  if (!SHA256.test(String(receipt?.receiptSha256 ?? '')) || receipt.receiptSha256 !== sha256(unsignedReceipt(receipt))) {
    fail('receipt_hash_mismatch');
  }
  try {
    const actual = readSourceBinding({ root, sourcePath: source.path });
    if (actual.path !== source.path || actual.bytes !== source.bytes || actual.sha256 !== source.sha256) fail('source_bytes_unbound');
  } catch {
    fail('source_unavailable');
  }

  return { ok: blockers.length === 0, blockers: [...new Set(blockers)] };
}
