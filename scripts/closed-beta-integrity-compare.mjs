#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { attachReceiptSha256, sha256, verifyReceiptSha256 } from './immutable-receipt-binding.mjs';

export const CLOSED_BETA_INTEGRITY_RECEIPT_SCHEMA = 'nexyfab.closed-beta-integrity-comparison.v2';
export const CLOSED_BETA_INTEGRITY_MAX_AGE_MS = 24 * 60 * 60_000;
const GIT_SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;
const SHA256 = /^[a-f0-9]{64}$/i;

function sortedKeys(value) {
  return Object.keys(value ?? {}).sort((a, b) => a.localeCompare(b));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function compareClosedBetaIntegrity(baseline, candidate) {
  const differences = [];
  const validateSnapshot = (snapshot, label) => {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      differences.push(`${label}_snapshot_invalid`);
      return;
    }
    if (!SHA256.test(String(snapshot?.source?.databasePathSha256 ?? ''))) differences.push(`${label}_database_path_hash_invalid`);
    if (!Number.isInteger(snapshot?.source?.databaseBytes) || snapshot.source.databaseBytes < 0) differences.push(`${label}_database_bytes_invalid`);
    if (!snapshot.tables || typeof snapshot.tables !== 'object' || Array.isArray(snapshot.tables) || Object.keys(snapshot.tables).length === 0) {
      differences.push(`${label}_protected_tables_invalid`);
    } else {
      for (const [table, value] of Object.entries(snapshot.tables)) {
        if (!table || !value || !Number.isInteger(value.rowCount) || value.rowCount < 0
          || !Array.isArray(value.columns) || value.columns.length === 0
          || new Set(value.columns).size !== value.columns.length
          || value.columns.some(column => typeof column !== 'string' || !column)
          || !SHA256.test(String(value.contentSha256 ?? ''))) differences.push(`${label}_table_invalid:${table}`);
      }
    }
    if (!Array.isArray(snapshot.files)) differences.push(`${label}_files_invalid`);
    else {
      const paths = new Set();
      for (const file of snapshot.files) {
        const relativePath = file?.relativePath;
        const pathValid = typeof relativePath === 'string' && relativePath.length > 0 && !path.isAbsolute(relativePath)
          && !relativePath.split(/[\\/]+/).includes('..') && !paths.has(relativePath);
        if (!pathValid || file.pathSha256 !== sha256(relativePath ?? '')
          || !Number.isInteger(file?.size) || file.size < 0
          || !SHA256.test(String(file?.contentSha256 ?? ''))) differences.push(`${label}_file_invalid:${relativePath ?? 'unknown'}`);
        if (typeof relativePath === 'string') paths.add(relativePath);
      }
    }
  };
  validateSnapshot(baseline, 'baseline');
  validateSnapshot(candidate, 'candidate');
  if (![1, 2].includes(baseline?.schemaVersion)) differences.push('baseline_schema_unsupported');
  if (![1, 2].includes(candidate?.schemaVersion)) differences.push('candidate_schema_unsupported');
  if (baseline?.source?.readonly !== true) differences.push('baseline_not_readonly');
  if (candidate?.source?.readonly !== true) differences.push('candidate_not_readonly');
  if (baseline?.source?.databasePathSha256 !== candidate?.source?.databasePathSha256) {
    differences.push('database_path_changed');
  }

  const baselineTables = sortedKeys(baseline?.tables);
  const candidateTables = sortedKeys(candidate?.tables);
  if (!sameJson(baselineTables, candidateTables)) {
    differences.push(`protected_table_set_changed:${baselineTables.join(',')}=>${candidateTables.join(',')}`);
  }
  for (const table of baselineTables.filter((name) => candidateTables.includes(name))) {
    const before = baseline.tables[table];
    const after = candidate.tables[table];
    if (!sameJson(before?.columns, after?.columns)) differences.push(`table_columns_changed:${table}`);
    if (before?.rowCount !== after?.rowCount) differences.push(`table_row_count_changed:${table}:${before?.rowCount}=>${after?.rowCount}`);
    if (before?.contentSha256 !== after?.contentSha256) differences.push(`table_content_changed:${table}`);
  }

  const byPath = (snapshot) => new Map((snapshot?.files ?? []).map((file) => [file.relativePath, file]));
  const baselineFiles = byPath(baseline);
  const candidateFiles = byPath(candidate);
  const baselinePaths = [...baselineFiles.keys()].sort((a, b) => a.localeCompare(b));
  const candidatePaths = [...candidateFiles.keys()].sort((a, b) => a.localeCompare(b));
  if (!sameJson(baselinePaths, candidatePaths)) differences.push('protected_file_set_changed');
  for (const relativePath of baselinePaths.filter((name) => candidateFiles.has(name))) {
    const before = baselineFiles.get(relativePath);
    const after = candidateFiles.get(relativePath);
    if (before.pathSha256 !== after.pathSha256) differences.push(`file_path_hash_changed:${relativePath}`);
    if (before.size !== after.size) differences.push(`file_size_changed:${relativePath}:${before.size}=>${after.size}`);
    if (before.contentSha256 !== after.contentSha256) differences.push(`file_content_changed:${relativePath}`);
  }

  const protectedRowCount = candidateTables.reduce((sum, table) => {
    const count = candidate?.tables?.[table]?.rowCount;
    return sum + (Number.isInteger(count) && count >= 0 ? count : 0);
  }, 0);
  const protectedFileBytes = candidatePaths.reduce((sum, relativePath) => {
    const size = candidateFiles.get(relativePath)?.size;
    return sum + (Number.isInteger(size) && size >= 0 ? size : 0);
  }, 0);
  return {
    ok: differences.length === 0,
    differences,
    summary: {
      protectedTableCount: candidateTables.length,
      protectedRowCount,
      protectedFileCount: candidatePaths.length,
      protectedFileBytes,
    },
  };
}

/**
 * Wrap a comparison in a release-bound, immutable receipt.  The comparison
 * itself is intentionally kept separate for backwards-compatible diagnostics;
 * only this v2 packet is eligible for commercialization.
 */
export function buildClosedBetaIntegrityReceipt(result, {
  baselinePath,
  candidatePath,
  baselineBytes,
  candidateBytes,
  release,
  generatedAt = new Date().toISOString(),
  root = process.cwd(),
  now = Date.now(),
} = {}) {
  const blockers = [];
  const resolvedRoot = path.resolve(root);
  const binding = (filePath, bytes, label) => {
    try {
      if (typeof filePath !== 'string' || !filePath) throw new Error('path_missing');
      const absolute = path.resolve(resolvedRoot, filePath);
      const relativePath = path.relative(resolvedRoot, absolute).replaceAll('\\', '/');
      if (!relativePath || relativePath === '.' || relativePath.startsWith('../') || path.isAbsolute(relativePath)) throw new Error('path_outside_root');
      const linkStat = fs.lstatSync(absolute);
      if (linkStat.isSymbolicLink()) throw new Error('path_symlink');
      const realRoot = fs.realpathSync.native(resolvedRoot);
      const realFile = fs.realpathSync.native(absolute);
      const realRelative = path.relative(realRoot, realFile);
      if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('path_realpath_outside_root');
      const actual = fs.readFileSync(realFile);
      if (!Buffer.isBuffer(bytes) || !actual.equals(bytes)) throw new Error('source_bytes_changed');
      const stat = fs.statSync(realFile);
      if (!stat.isFile() || stat.size <= 0) throw new Error('source_not_regular_file');
      return { path: relativePath, bytes: actual.byteLength, sha256: sha256(actual) };
    } catch (error) {
      blockers.push(`${label}_${error instanceof Error ? error.message : String(error)}`);
      return { path: typeof filePath === 'string' ? filePath.replaceAll('\\', '/') : null, bytes: null, sha256: null };
    }
  };
  let authoritative = result;
  try {
    const baseline = JSON.parse(Buffer.from(baselineBytes).toString('utf8'));
    const candidate = JSON.parse(Buffer.from(candidateBytes).toString('utf8'));
    authoritative = compareClosedBetaIntegrity(baseline, candidate);
  } catch {
    blockers.push('snapshot_parse_failed');
  }
  const baselineBinding = binding(baselinePath, baselineBytes, 'baseline_snapshot');
  const candidateBinding = binding(candidatePath, candidateBytes, 'candidate_snapshot');
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp) || timestamp > now + 5 * 60_000 || timestamp < now - CLOSED_BETA_INTEGRITY_MAX_AGE_MS) blockers.push('generated_at_stale_or_invalid');
  const resolvedRelease = release ?? null;
  if (typeof resolvedRelease?.buildId !== 'string' || !resolvedRelease.buildId.trim()) blockers.push('release_build_id_missing');
  if (typeof resolvedRelease?.deploymentId !== 'string' || !resolvedRelease.deploymentId.trim()) blockers.push('release_deployment_id_missing');
  if (!GIT_SHA.test(String(resolvedRelease?.gitHead ?? ''))) blockers.push('release_git_head_invalid');
  if (authoritative?.ok !== true) blockers.push('comparison_not_clean');
  const unsigned = {
    schema: CLOSED_BETA_INTEGRITY_RECEIPT_SCHEMA,
    generatedAt,
    ok: blockers.length === 0 && authoritative?.ok === true,
    status: blockers.length === 0 && authoritative?.ok === true ? 'PASS' : 'HOLD',
    blockers: [...new Set(blockers)],
    differences: Array.isArray(authoritative?.differences) ? authoritative.differences : ['comparison_result_missing'],
    summary: authoritative?.summary ?? null,
    release: resolvedRelease,
    freshness: {
      generatedAt,
      maxAgeMs: CLOSED_BETA_INTEGRITY_MAX_AGE_MS,
      expiresAt: Number.isFinite(timestamp) ? new Date(timestamp + CLOSED_BETA_INTEGRITY_MAX_AGE_MS).toISOString() : null,
    },
    evidence: {
      baselineSnapshot: baselineBinding,
      candidateSnapshot: candidateBinding,
    },
  };
  return attachReceiptSha256({
    ...unsigned,
    comparisonSha256: sha256({ differences: unsigned.differences, summary: unsigned.summary, evidence: unsigned.evidence }),
  });
}

function verifyBinding(binding, root, seen) {
  if (typeof binding?.path !== 'string' || !binding.path || path.isAbsolute(binding.path)
    || binding.path === '.' || binding.path.split(/[\\/]+/).includes('..')
    || !Number.isInteger(binding.bytes) || binding.bytes <= 0 || !/^[a-f0-9]{64}$/i.test(String(binding.sha256 ?? ''))) return null;
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, binding.path);
  if (absolute !== resolvedRoot && !absolute.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  try {
    if (fs.lstatSync(absolute).isSymbolicLink()) return null;
    const realRoot = fs.realpathSync.native(resolvedRoot);
    const realFile = fs.realpathSync.native(absolute);
    const realRelative = path.relative(realRoot, realFile);
    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative) || seen.has(realFile)) return null;
    const bytes = fs.readFileSync(realFile);
    const stat = fs.statSync(realFile);
    if (!stat.isFile() || bytes.byteLength !== binding.bytes || sha256(bytes) !== binding.sha256) return null;
    seen.add(realFile);
    return bytes;
  } catch { return null; }
}

export function verifyClosedBetaIntegrityReceipt(receipt, {
  root = process.cwd(), expectedRelease = null, now = Date.now(), maxAgeMs = CLOSED_BETA_INTEGRITY_MAX_AGE_MS,
} = {}) {
  const blockers = [];
  const generatedAt = Date.parse(receipt?.generatedAt);
  if (receipt?.schema !== CLOSED_BETA_INTEGRITY_RECEIPT_SCHEMA) blockers.push('receipt_schema_invalid');
  if (receipt?.ok !== true || receipt?.status !== 'PASS') blockers.push('receipt_not_pass');
  if (!Number.isFinite(generatedAt) || generatedAt > now + 5 * 60_000 || generatedAt < now - maxAgeMs) blockers.push('receipt_stale');
  if (receipt?.freshness?.generatedAt !== receipt?.generatedAt || receipt?.freshness?.maxAgeMs !== CLOSED_BETA_INTEGRITY_MAX_AGE_MS
    || receipt?.freshness?.expiresAt !== (Number.isFinite(generatedAt) ? new Date(generatedAt + CLOSED_BETA_INTEGRITY_MAX_AGE_MS).toISOString() : null)) blockers.push('receipt_freshness_unbound');
  if (!verifyReceiptSha256(receipt)) blockers.push('receipt_hash_mismatch');
  const release = receipt?.release;
  if (typeof release?.buildId !== 'string' || !release.buildId.trim() || typeof release?.deploymentId !== 'string' || !release.deploymentId.trim() || !GIT_SHA.test(String(release?.gitHead ?? ''))) blockers.push('release_metadata_invalid');
  const expectedGit = expectedRelease?.head ?? expectedRelease?.gitHead;
  if (expectedRelease && (release?.buildId !== expectedRelease.buildId || release?.deploymentId !== expectedRelease.deploymentId || release?.gitHead !== expectedGit)) blockers.push('release_binding_mismatch');
  const seen = new Set();
  const baselineBytes = verifyBinding(receipt?.evidence?.baselineSnapshot, root, seen);
  const candidateBytes = verifyBinding(receipt?.evidence?.candidateSnapshot, root, seen);
  if (!baselineBytes || !candidateBytes) blockers.push('source_bindings_invalid');
  let expected;
  try {
    expected = compareClosedBetaIntegrity(JSON.parse(baselineBytes.toString('utf8')), JSON.parse(candidateBytes.toString('utf8')));
  } catch { blockers.push('source_snapshots_invalid'); }
  if (expected && (!sameJson(receipt?.differences, expected.differences) || !sameJson(receipt?.summary, expected.summary)
    || receipt?.ok !== expected.ok)) blockers.push('comparison_derivation_mismatch');
  if (expected?.ok !== true) blockers.push('comparison_not_clean');
  const comparisonSha256 = sha256({ differences: receipt?.differences, summary: receipt?.summary, evidence: receipt?.evidence });
  if (!/^[a-f0-9]{64}$/i.test(String(receipt?.comparisonSha256 ?? '')) || receipt.comparisonSha256 !== comparisonSha256) blockers.push('comparison_hash_mismatch');
  if (!Array.isArray(receipt?.blockers) || receipt.blockers.length !== 0) blockers.push('receipt_blockers_present');
  return { ok: blockers.length === 0, blockers: [...new Set(blockers)] };
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function main(args = process.argv.slice(2)) {
  const baselinePath = valueAfter(args, '--baseline');
  const candidatePath = valueAfter(args, '--candidate');
  if (!baselinePath || !candidatePath) {
    process.stderr.write('usage: node scripts/closed-beta-integrity-compare.mjs --baseline <snapshot.json> --candidate <snapshot.json>\n');
    return 2;
  }
  try {
    const baselineBytes = fs.readFileSync(path.resolve(baselinePath));
    const candidateBytes = fs.readFileSync(path.resolve(candidatePath));
    const result = compareClosedBetaIntegrity(JSON.parse(baselineBytes.toString('utf8')), JSON.parse(candidateBytes.toString('utf8')));
    const receipt = buildClosedBetaIntegrityReceipt(result, {
      baselinePath,
      candidatePath,
      baselineBytes,
      candidateBytes,
      release: {
        buildId: process.env.RELEASE_BUILD_ID ?? null,
        deploymentId: process.env.RELEASE_DEPLOYMENT_ID ?? null,
        gitHead: process.env.RELEASE_GIT_HEAD ?? null,
      },
    });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return receipt.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = main();
