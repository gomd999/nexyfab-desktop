import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectI18nVitestEvidence,
  EXPANDED_I18N_COMMAND,
  OFFICIAL_I18N_COMMAND,
  OFFICIAL_I18N_TEST_FILES,
  verifyI18nVitestEvidence,
} from './collect-i18n-vitest-evidence.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'nexyfab-i18n-evidence-'));
const expandedFiles = Array.from({ length: 32 }, (_, index) => `tests/i18n/source-${String(index).padStart(2, '0')}.test.ts`);
for (const relative of [...OFFICIAL_I18N_TEST_FILES, ...expandedFiles]) {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `export const source = ${JSON.stringify(relative)};\n`);
}

function rawVitest(files, tests, now = Date.now(), overrides = {}) {
  let remaining = tests;
  const testResults = files.map((name, index) => {
    const count = index === files.length - 1 ? remaining : Math.floor(tests / files.length);
    remaining -= count;
    return {
      name: path.join(root, name), status: 'passed',
      assertionResults: Array.from({ length: count }, (_, assertionIndex) => ({
        fullName: `${name}:${assertionIndex}`, title: `test-${assertionIndex}`, status: 'passed', failureMessages: [],
      })),
    };
  });
  return JSON.stringify({
    success: true, startTime: now,
    numTotalTests: tests, numPassedTests: tests, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    numFailedTestSuites: 0, numPendingTestSuites: 0,
    testResults, ...overrides,
  });
}

function evidence(suite = 'expanded', now = Date.now(), overrides = {}) {
  const files = suite === 'official' ? OFFICIAL_I18N_TEST_FILES : expandedFiles;
  const tests = suite === 'official' ? 40 : 230;
  const rawOutput = rawVitest(files, tests, now, overrides);
  const rawOutputPath = path.join(root, `vitest-${suite}.json`);
  writeFileSync(rawOutputPath, rawOutput);
  return collectI18nVitestEvidence({
    rawOutput, rawOutputPath, suite,
    command: suite === 'official' ? OFFICIAL_I18N_COMMAND : EXPANDED_I18N_COMMAND,
    root, sourcePaths: files, buildId: null, gitHead: null, now,
  });
}

test('derives current official 7-file/40-test and expanded 32-file/230-test counts from raw Vitest output', () => {
  const official = evidence('official');
  const expanded = evidence('expanded');
  assert.equal(official.pass, true);
  assert.deepEqual(official.counts, { files: 7, tests: 40, passed: 40, failed: 0, skipped: 0, todo: 0 });
  assert.equal(expanded.pass, true);
  assert.deepEqual(expanded.counts, { files: 32, tests: 230, passed: 230, failed: 0, skipped: 0, todo: 0 });
  assert.match(official.rawOutput.sha256, /^[a-f0-9]{64}$/);
  assert.equal(official.buildId, null);
  assert.equal(official.gitHead, null);
});

test('fails closed for failed, skipped, malformed, stale, or mismatched output', () => {
  const failed = evidence('expanded', Date.now(), { success: false, numFailedTests: 1 });
  assert.equal(failed.pass, false);
  assert.ok(failed.issues.includes('vitest_success_false'));
  const skippedRaw = JSON.parse(rawVitest(expandedFiles, 230));
  skippedRaw.testResults[0].assertionResults[0].status = 'skipped';
  const skippedPath = path.join(root, 'vitest-skipped.json');
  writeFileSync(skippedPath, JSON.stringify(skippedRaw));
  const skipped = collectI18nVitestEvidence({ rawOutput: JSON.stringify(skippedRaw), rawOutputPath: skippedPath, suite: 'expanded', command: EXPANDED_I18N_COMMAND, root, sourcePaths: expandedFiles, now: Date.now(), gitHead: null });
  assert.ok(skipped.issues.includes('vitest_nonpassing_assertions'));
  const malformed = collectI18nVitestEvidence({ rawOutput: '{not-json', suite: 'expanded', command: EXPANDED_I18N_COMMAND, root, now: Date.now(), gitHead: null });
  assert.equal(malformed.pass, false);
  assert.ok(malformed.issues.includes('raw_json_invalid'));
  const stale = collectI18nVitestEvidence({
    rawOutput: rawVitest(expandedFiles, 230, Date.now() - (25 * 60 * 60 * 1000)), suite: 'expanded',
    command: EXPANDED_I18N_COMMAND, root, sourcePaths: expandedFiles, now: Date.now(), gitHead: null,
  });
  assert.ok(stale.issues.includes('vitest_output_stale'));
  const wrongRaw = rawVitest(expandedFiles, 230);
  const wrongPath = path.join(root, 'vitest-wrong-command.json');
  writeFileSync(wrongPath, wrongRaw);
  const wrongCommand = collectI18nVitestEvidence({ rawOutput: wrongRaw, rawOutputPath: wrongPath, suite: 'expanded', command: 'npx vitest run i18n --reporter=dot', root, sourcePaths: expandedFiles, now: Date.now(), gitHead: null });
  assert.ok(wrongCommand.issues.includes('command_mismatch'));
});

test('rejects tampered evidence hash and source binding bytes', () => {
  const value = evidence();
  const tamperedHash = { ...value, rawOutput: { ...value.rawOutput, sha256: 'f'.repeat(64) } };
  assert.equal(verifyI18nVitestEvidence(tamperedHash, { suite: 'expanded', command: EXPANDED_I18N_COMMAND, root, buildId: null, gitHead: null }).ok, false);
  const tamperedSource = { ...value, sourceBindings: value.sourceBindings.map((binding, index) => index === 0 ? { ...binding, bytes: binding.bytes + 1 } : binding) };
  assert.equal(verifyI18nVitestEvidence(tamperedSource, { suite: 'expanded', command: EXPANDED_I18N_COMMAND, root, buildId: null, gitHead: null }).ok, false);
});

test('re-reads an optional raw-output binding and rejects tampered output bytes', () => {
  const rawPath = path.join(root, 'vitest-expanded.json');
  const raw = rawVitest(expandedFiles, 230);
  writeFileSync(rawPath, raw);
  const value = collectI18nVitestEvidence({
    rawOutput: raw, rawOutputPath: rawPath, suite: 'expanded', command: EXPANDED_I18N_COMMAND,
    root, sourcePaths: expandedFiles, now: Date.now(), gitHead: null,
  });
  assert.equal(verifyI18nVitestEvidence(value, { suite: 'expanded', command: EXPANDED_I18N_COMMAND, root, buildId: null, gitHead: null }).ok, true);
  writeFileSync(rawPath, `${raw}\n tampered`);
  const result = verifyI18nVitestEvidence(value, { suite: 'expanded', command: EXPANDED_I18N_COMMAND, root, buildId: null, gitHead: null });
  assert.ok(result.issues.includes('raw_output_binding_mismatch'));
});

test('rejects build/head mismatch while allowing local evidence with nullable release IDs', () => {
  const value = evidence();
  assert.equal(verifyI18nVitestEvidence(value, { suite: 'expanded', command: EXPANDED_I18N_COMMAND, root, buildId: null, gitHead: null }).ok, true);
  assert.ok(verifyI18nVitestEvidence(value, { suite: 'expanded', command: EXPANDED_I18N_COMMAND, root, buildId: 'release-build', gitHead: null }).issues.includes('build_id_mismatch'));
  const withHeadRaw = rawVitest(expandedFiles, 230);
  const withHeadPath = path.join(root, 'vitest-with-head.json');
  writeFileSync(withHeadPath, withHeadRaw);
  const withHead = collectI18nVitestEvidence({ rawOutput: withHeadRaw, rawOutputPath: withHeadPath, suite: 'expanded', command: EXPANDED_I18N_COMMAND, root, sourcePaths: expandedFiles, now: Date.now(), buildId: 'release-build', gitHead: 'a'.repeat(40) });
  assert.ok(verifyI18nVitestEvidence(withHead, { suite: 'expanded', command: EXPANDED_I18N_COMMAND, root, buildId: 'other-build', gitHead: 'a'.repeat(40) }).issues.includes('build_id_mismatch'));
  assert.ok(verifyI18nVitestEvidence(withHead, { suite: 'expanded', command: EXPANDED_I18N_COMMAND, root, buildId: 'release-build', gitHead: 'b'.repeat(40) }).issues.includes('git_head_mismatch'));
});

test('legacy unstructured measurements cannot qualify as automated evidence', () => {
  const legacy = { files: 32, tests: 230, passed: 230, exitCode: 0, buildId: 'release-build', head: 'a'.repeat(40), outputSha256: 'b'.repeat(64) };
  const result = verifyI18nVitestEvidence(legacy, { suite: 'expanded', command: EXPANDED_I18N_COMMAND, root, buildId: 'release-build', gitHead: 'a'.repeat(40) });
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes('evidence_schema_invalid'));
});
