#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const I18N_VITEST_EVIDENCE_SCHEMA = 'nexyfab.i18n-vitest-evidence.v1';
export const OFFICIAL_I18N_TEST_FILES = Object.freeze([
  'scripts/i18n/commercial-catalog.test.ts',
  'scripts/i18n/lang-coverage.test.ts',
  'scripts/i18n/locale-hardcode.test.ts',
  'src/lib/i18n/adminTranslations.test.ts',
  'src/lib/i18n/manufacturingTerms.test.ts',
  'src/lib/i18n/normalize.test.ts',
  'src/lib/i18n/serverLocale.test.ts',
]);
export const OFFICIAL_I18N_COMMAND = `npx vitest run ${OFFICIAL_I18N_TEST_FILES.join(' ')} --reporter=json`;
export const EXPANDED_I18N_COMMAND = 'npx vitest run i18n --reporter=json';
export const I18N_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_HEAD = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const SUITES = new Map([
  ['official', { command: OFFICIAL_I18N_COMMAND, expectedFiles: OFFICIAL_I18N_TEST_FILES, expectedTests: 40 }],
  ['expanded', { command: EXPANDED_I18N_COMMAND, expectedFiles: null, expectedTests: null }],
]);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const textBytes = value => Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''), 'utf8');
const canonical = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};

function normalizedRelativePath(root, value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const resolvedRoot = path.resolve(root);
  const candidate = path.isAbsolute(value) ? path.resolve(value) : path.resolve(resolvedRoot, value);
  const relative = path.relative(resolvedRoot, candidate).replaceAll('\\', '/');
  if (!relative || relative.startsWith('../') || relative === '..' || path.isAbsolute(relative)) return null;
  return relative;
}

function sourceBinding(root, relative) {
  const normalized = normalizedRelativePath(root, relative);
  if (!normalized) return { path: relative, valid: false, issue: 'source_path_invalid' };
  const absolute = path.resolve(root, ...normalized.split('/'));
  try {
    if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink() || !statSync(absolute).isFile()) {
      return { path: normalized, valid: false, issue: 'source_file_missing' };
    }
    const bytes = readFileSync(absolute);
    return { path: normalized, bytes: bytes.byteLength, sha256: sha256(bytes), valid: true };
  } catch {
    return { path: normalized, valid: false, issue: 'source_file_unreadable' };
  }
}

function sourcePathFromResult(root, value) {
  const raw = value?.name ?? value?.filepath ?? value?.filePath ?? value?.path;
  return normalizedRelativePath(root, raw);
}

export function readActualGitHead(root = process.cwd()) {
  try {
    const value = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
    return GIT_HEAD.test(value) ? value : null;
  } catch {
    return null;
  }
}

function resultAssertions(result) {
  return Array.isArray(result?.assertionResults) ? result.assertionResults : null;
}

function deriveCounts(raw) {
  if (!Array.isArray(raw?.testResults) || raw.testResults.length === 0) return null;
  const assertions = raw.testResults.flatMap(result => resultAssertions(result) ?? []);
  if (raw.testResults.some(result => !resultAssertions(result))) return null;
  const counts = { files: raw.testResults.length, tests: assertions.length, passed: 0, failed: 0, skipped: 0, todo: 0 };
  for (const assertion of assertions) {
    if (!assertion || typeof assertion.status !== 'string') return null;
    if (assertion.status === 'passed') counts.passed += 1;
    else if (assertion.status === 'failed') counts.failed += 1;
    else if (assertion.status === 'skipped' || assertion.status === 'pending') counts.skipped += 1;
    else if (assertion.status === 'todo') counts.todo += 1;
    else return null;
  }
  return counts;
}

/**
 * Convert raw Vitest JSON bytes into source-bound evidence.  The raw bytes,
 * command, suite, source files, and actual repository HEAD are all part of the
 * contract.  A caller cannot turn a hand-authored count object into PASS.
 */
export function collectI18nVitestEvidence({
  rawOutput,
  suite,
  command,
  root = process.cwd(),
  buildId = process.env.NEXYFAB_BUILD_ID?.trim() || null,
  gitHead = readActualGitHead(root),
  now = Date.now(),
  maxAgeMs = I18N_EVIDENCE_MAX_AGE_MS,
  sourcePaths,
  rawOutputPath,
} = {}) {
  const issues = [];
  const contract = SUITES.get(suite);
  const bytes = textBytes(rawOutput);
  let raw = null;
  try { raw = JSON.parse(bytes.toString('utf8')); } catch { issues.push('raw_json_invalid'); }
  if (!contract) issues.push('suite_invalid');
  if (typeof command !== 'string' || command !== contract?.command) issues.push('command_mismatch');
  if (!bytes.byteLength) issues.push('raw_output_empty');
  const counts = raw ? deriveCounts(raw) : null;
  if (!counts) issues.push('vitest_results_invalid');
  if (raw && raw.success !== true) issues.push('vitest_success_false');
  if (raw && (raw.numFailedTests > 0 || raw.numFailedTestSuites > 0)) issues.push('vitest_failures_present');
  if (counts && (counts.failed > 0 || counts.skipped > 0 || counts.todo > 0)) issues.push('vitest_nonpassing_assertions');
  if (counts && raw && (
    raw.numTotalTests !== counts.tests
    || raw.numPassedTests !== counts.passed
    || raw.numFailedTests !== counts.failed
    || raw.numPendingTests !== counts.skipped
    || raw.numTodoTests !== counts.todo
    || raw.numFailedTestSuites !== 0
    || raw.numPendingTestSuites !== 0
  )) issues.push('vitest_aggregate_mismatch');
  const startedAt = Number(raw?.startTime);
  if (!Number.isFinite(startedAt)) issues.push('vitest_start_time_missing');
  else if (startedAt > now + 5 * 60 * 1000) issues.push('vitest_start_time_in_future');
  else if (now - startedAt > maxAgeMs) issues.push('vitest_output_stale');

  const resultPaths = raw?.testResults?.map(result => sourcePathFromResult(root, result));
  if (resultPaths?.some(value => !value)) issues.push('vitest_source_path_missing');
  const uniqueResultPaths = resultPaths ? [...new Set(resultPaths)] : [];
  if (resultPaths && uniqueResultPaths.length !== resultPaths.length) issues.push('vitest_source_path_duplicate');
  if (contract?.expectedFiles && JSON.stringify([...uniqueResultPaths].sort()) !== JSON.stringify([...contract.expectedFiles].sort())) {
    issues.push('official_source_set_mismatch');
  }
  if (contract?.expectedTests !== null && counts && counts.tests !== contract.expectedTests) issues.push('official_test_count_mismatch');
  if (contract && suite === 'expanded' && counts?.tests <= 0) issues.push('expanded_test_count_missing');

  if (sourcePaths && JSON.stringify([...sourcePaths].sort()) !== JSON.stringify([...uniqueResultPaths].sort())) {
    issues.push('source_paths_mismatch');
  }
  const paths = uniqueResultPaths;
  const bindings = Array.isArray(paths) ? paths.map(relative => sourceBinding(root, relative)) : [];
  if (!Array.isArray(paths) || paths.length === 0) issues.push('source_bindings_missing');
  if (bindings.some(binding => binding.valid !== true)) issues.push('source_binding_invalid');
  const normalizedBuildId = typeof buildId === 'string' && buildId.trim() ? buildId.trim() : null;
  const normalizedGitHead = typeof gitHead === 'string' && GIT_HEAD.test(gitHead.trim()) ? gitHead.trim() : null;
  if (gitHead !== null && normalizedGitHead === null) issues.push('git_head_invalid');
  const normalizedRawOutputPath = normalizedRelativePath(root, rawOutputPath);
  if (!normalizedRawOutputPath) issues.push('raw_output_path_missing_or_invalid');
  else {
    const rawBinding = sourceBinding(root, normalizedRawOutputPath);
    if (!rawBinding.valid || rawBinding.bytes !== bytes.byteLength || rawBinding.sha256 !== sha256(bytes)) {
      issues.push('raw_output_binding_mismatch');
    }
  }
  const evidence = {
    schema: I18N_VITEST_EVIDENCE_SCHEMA,
    suite: suite ?? null,
    command: command ?? null,
    generatedAt: Number.isFinite(startedAt) ? new Date(startedAt).toISOString() : null,
    buildId: normalizedBuildId,
    gitHead: normalizedGitHead,
    rawOutput: {
      path: normalizedRawOutputPath,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    },
    sourceBindings: bindings.map(binding => {
      const output = { ...binding };
      delete output.valid;
      delete output.issue;
      return output;
    }),
    counts: counts ?? { files: 0, tests: 0, passed: 0, failed: 0, skipped: 0, todo: 0 },
    pass: issues.length === 0,
    issues: [...new Set(issues)],
  };
  evidence.evidenceSha256 = sha256(canonical(evidence));
  return evidence;
}

export function verifyI18nVitestEvidence(value, { suite, command, root = process.cwd(), buildId, gitHead, now = Date.now(), maxAgeMs = I18N_EVIDENCE_MAX_AGE_MS } = {}) {
  const issues = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, issues: ['evidence_missing'] };
  if (value.schema !== I18N_VITEST_EVIDENCE_SCHEMA) issues.push('evidence_schema_invalid');
  const contract = SUITES.get(suite ?? value.suite);
  if (!contract) issues.push('suite_invalid');
  if (value.suite !== (suite ?? value.suite)) issues.push('suite_mismatch');
  if (value.command !== (command ?? contract?.command)) issues.push('command_mismatch');
  if (value.pass !== true || !Array.isArray(value.issues) || value.issues.length > 0) issues.push('evidence_not_pass');
  const counts = value.counts;
  if (!counts || !Number.isSafeInteger(counts.files) || !Number.isSafeInteger(counts.tests) || counts.files <= 0 || counts.tests <= 0
    || counts.passed !== counts.tests || counts.failed !== 0 || counts.skipped !== 0 || counts.todo !== 0) issues.push('counts_invalid');
  if (contract?.expectedFiles && counts?.files !== contract.expectedFiles.length) issues.push('official_file_count_mismatch');
  if (contract?.expectedTests !== null && counts?.tests !== contract.expectedTests) issues.push('official_test_count_mismatch');
  const generatedAt = Date.parse(value.generatedAt);
  if (!Number.isFinite(generatedAt)) issues.push('timestamp_missing');
  else if (generatedAt > now + 5 * 60 * 1000) issues.push('timestamp_in_future');
  else if (now - generatedAt > maxAgeMs) issues.push('evidence_stale');
  if (!value.rawOutput || typeof value.rawOutput.path !== 'string'
    || !Number.isSafeInteger(value.rawOutput.bytes) || value.rawOutput.bytes <= 0
    || !SHA256.test(String(value.rawOutput.sha256 ?? ''))) issues.push('raw_output_binding_invalid');
  if (typeof value.rawOutput?.path === 'string') {
    const actual = sourceBinding(root, value.rawOutput.path);
    if (!actual.valid || actual.bytes !== value.rawOutput.bytes || actual.sha256 !== value.rawOutput.sha256) issues.push('raw_output_binding_mismatch');
  }
  if (!Array.isArray(value.sourceBindings) || value.sourceBindings.length !== counts?.files) issues.push('source_bindings_invalid');
  else {
    const paths = value.sourceBindings.map(binding => binding?.path);
    if (new Set(paths).size !== paths.length) issues.push('source_binding_duplicate');
    for (const binding of value.sourceBindings) {
      const actual = sourceBinding(root, binding?.path);
      if (!actual.valid || actual.bytes !== binding.bytes || actual.sha256 !== binding.sha256) issues.push(`source_binding_mismatch:${binding?.path ?? 'unknown'}`);
    }
  }
  if (buildId !== undefined && value.buildId !== (buildId || null)) issues.push('build_id_mismatch');
  if (gitHead !== undefined && value.gitHead !== (gitHead || null)) issues.push('git_head_mismatch');
  const unsigned = { ...value };
  delete unsigned.evidenceSha256;
  if (!SHA256.test(String(value.evidenceSha256 ?? '')) || value.evidenceSha256 !== sha256(canonical(unsigned))) issues.push('evidence_hash_invalid');
  if (typeof value.rawOutput?.path === 'string') {
    try {
      const rawOutput = readFileSync(path.resolve(root, ...value.rawOutput.path.replaceAll('\\', '/').split('/')));
      const recomputed = collectI18nVitestEvidence({
        rawOutput,
        rawOutputPath: value.rawOutput.path,
        suite: suite ?? value.suite,
        command: command ?? value.command,
        root,
        buildId: value.buildId,
        gitHead: value.gitHead,
        now,
        maxAgeMs,
      });
      if (canonical(recomputed) !== canonical(value)) issues.push('evidence_rederivation_mismatch');
    } catch {
      issues.push('evidence_rederivation_failed');
    }
  }
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

export function readRawVitestEvidence(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) throw new Error('vitest_input_required');
  return readFileSync(path.resolve(inputPath));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = new Map(process.argv.slice(2).filter(value => value.startsWith('--')).map(value => {
    const index = value.indexOf('=');
    return index < 0 ? [value.slice(2), true] : [value.slice(2, index), value.slice(index + 1)];
  }));
  const suite = args.get('suite') ?? 'expanded';
  const command = args.get('command') ?? SUITES.get(suite)?.command;
  const root = path.resolve(args.get('root') ?? process.cwd());
  const inputPath = args.get('input');
  const evidence = collectI18nVitestEvidence({ rawOutput: readRawVitestEvidence(inputPath), rawOutputPath: inputPath, suite, command, root });
  if (args.get('output')) writeFileSync(path.resolve(args.get('output')), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
  if (!evidence.pass) process.exitCode = 1;
}
