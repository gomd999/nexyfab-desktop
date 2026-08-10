#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function sortedKeys(value) {
  return Object.keys(value ?? {}).sort((a, b) => a.localeCompare(b));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function compareClosedBetaIntegrity(baseline, candidate) {
  const differences = [];
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

  return {
    ok: differences.length === 0,
    differences,
    summary: {
      protectedTableCount: candidateTables.length,
      protectedRowCount: candidate?.summary?.protectedRowCount ?? null,
      protectedFileCount: candidatePaths.length,
      protectedFileBytes: candidate?.summary?.fileBytes ?? null,
    },
  };
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
    const read = (file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    const result = compareClosedBetaIntegrity(read(baselinePath), read(candidatePath));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = main();
