import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectI18nVitestEvidence,
  EXPANDED_I18N_COMMAND,
  OFFICIAL_I18N_COMMAND,
  OFFICIAL_I18N_TEST_FILES,
} from './collect-i18n-vitest-evidence.mjs';
import { buildCommercialI18nReleaseReceipt, signFullProductArtifactReviewReceipt, verifyFullProductArtifactReviewReceipt } from './build-commercial-i18n-release-receipt.mjs';

const locales = ['kr', 'en', 'ja', 'cn', 'es', 'ar'];
const completeCatalog = JSON.parse(readFileSync(new URL('../../src/lib/i18n/commercialTranslations.generated.json', import.meta.url), 'utf8'));
const evidenceRoot = mkdtempSync(path.join(os.tmpdir(), 'nexyfab-i18n-review-'));
const automatedEvidenceRoot = mkdtempSync(path.join(os.tmpdir(), 'nexyfab-i18n-vitest-'));
const expandedSourcePaths = Array.from({ length: 32 }, (_, index) => `tests/i18n/source-${String(index).padStart(2, '0')}.test.ts`);
for (const relative of [...OFFICIAL_I18N_TEST_FILES, ...expandedSourcePaths]) {
  const absolute = path.join(automatedEvidenceRoot, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `export const source = ${JSON.stringify(relative)};\n`);
}
const evidenceFile = (relative, content) => {
  const bytes = Buffer.from(content);
  writeFileSync(path.join(evidenceRoot, relative), bytes);
  return { path: relative, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
};
const rawVitest = (sourcePaths, tests, now = Date.now()) => {
  let remaining = tests;
  const testResults = sourcePaths.map((name, index) => {
    const count = index === sourcePaths.length - 1 ? remaining : Math.floor(tests / sourcePaths.length);
    remaining -= count;
    return {
      name: path.join(automatedEvidenceRoot, name),
      status: 'passed',
      assertionResults: Array.from({ length: count }, (_, assertionIndex) => ({
        fullName: `${name}:${assertionIndex}`, title: `test-${assertionIndex}`, status: 'passed', failureMessages: [],
      })),
    };
  });
  return JSON.stringify({
    success: true, startTime: now,
    numTotalTests: tests, numPassedTests: tests, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    numFailedTestSuites: 0, numPendingTestSuites: 0, testResults,
  });
};
const automatedEvidence = (suite, buildId = 'build-1', gitHead = 'a'.repeat(40), now = Date.now()) => {
  const sourcePaths = suite === 'official' ? OFFICIAL_I18N_TEST_FILES : expandedSourcePaths;
  const tests = suite === 'official' ? 40 : 230;
  const rawOutput = rawVitest(sourcePaths, tests, now);
  const rawOutputPath = path.join(automatedEvidenceRoot, `vitest-${suite}.json`);
  writeFileSync(rawOutputPath, rawOutput);
  return collectI18nVitestEvidence({
    rawOutput, rawOutputPath, suite,
    command: suite === 'official' ? OFFICIAL_I18N_COMMAND : EXPANDED_I18N_COMMAND,
    root: automatedEvidenceRoot, sourcePaths, buildId, gitHead, now,
  });
};
const reviewFixture = (buildId = 'build-1', head = 'a'.repeat(40), overrides = {}) => {
  const artifact = kind => {
    const output = evidenceFile(`${kind}.artifact`, `${kind}-artifact`);
    const evidence = evidenceFile(`${kind}.evidence`, `${kind}-evidence`);
    return {
      kind, status: 'PASS', reviewStatus: 'APPROVED', releaseReady: true, synthetic: false,
      buildId, head, locales, artifactPath: output.path, evidencePath: evidence.path,
      artifactBytes: output.bytes, evidenceBytes: evidence.bytes,
      artifactSha256: output.sha256, evidenceSha256: evidence.sha256,
    };
  };
  return signFullProductArtifactReviewReceipt({
    schema: 'nexyfab.commercial-i18n-full-product-artifact-review.v1', reviewerId: 'i18n-reviewer-1', buildId, head,
    generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), locales,
    artifacts: { visual: artifact('visual'), rtl: artifact('rtl'), email: artifact('email'), pdf: artifact('pdf'), export: artifact('export') },
    ...overrides,
  }, 'x'.repeat(32));
};
test('i18n receipt is HOLD for incomplete or legacy scope and never synthesizes PASS', () => {
  const receipt = buildCommercialI18nReleaseReceipt({ Hello: { ko: '안녕', en: 'Hello', ja: 'こんにちは', zh: '你好', es: 'Hola', ar: 'مرحبا' } });
  assert.equal(receipt.status, 'HOLD');
  assert.match(receipt.receiptSha256, /^[a-f0-9]{64}$/);
  assert.equal(receipt.automatedStatus, 'HOLD');
  assert.equal(receipt.gaReady, false);
});

test('keeps complete local automated evidence PASS_LOCAL while release status remains HOLD without build/head', () => {
  const prior = { build: process.env.NEXYFAB_BUILD_ID, head: process.env.RAILWAY_GIT_COMMIT_SHA, automatedRoot: process.env.I18N_AUTOMATED_EVIDENCE_ROOT };
  delete process.env.NEXYFAB_BUILD_ID;
  delete process.env.RAILWAY_GIT_COMMIT_SHA;
  process.env.I18N_AUTOMATED_EVIDENCE_ROOT = automatedEvidenceRoot;
  const receipt = buildCommercialI18nReleaseReceipt(completeCatalog, { official: automatedEvidence('official', null, null), expanded: automatedEvidence('expanded', null, null) });
  assert.equal(receipt.automatedStatus, 'PASS_LOCAL');
  assert.equal(receipt.status, 'HOLD');
  assert.equal(receipt.gaReady, false);
  assert.ok(receipt.blockers.includes('AUTOMATED_I18N_RELEASE_ID_MISSING'));
  if (prior.build === undefined) delete process.env.NEXYFAB_BUILD_ID; else process.env.NEXYFAB_BUILD_ID = prior.build;
  if (prior.head === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA; else process.env.RAILWAY_GIT_COMMIT_SHA = prior.head;
  if (prior.automatedRoot === undefined) delete process.env.I18N_AUTOMATED_EVIDENCE_ROOT; else process.env.I18N_AUTOMATED_EVIDENCE_ROOT = prior.automatedRoot;
});

test('separates real catalog pair coverage from 40/40 and 224/224 test counts and binds measurements to build/head', () => {
  const prior = { build: process.env.NEXYFAB_BUILD_ID, head: process.env.RAILWAY_GIT_COMMIT_SHA, secret: process.env.GENERATION_EVIDENCE_SIGNING_SECRET, evidenceRoot: process.env.I18N_AUTOMATED_EVIDENCE_ROOT };
  process.env.NEXYFAB_BUILD_ID = 'build-1'; process.env.RAILWAY_GIT_COMMIT_SHA = 'a'.repeat(40); process.env.GENERATION_EVIDENCE_SIGNING_SECRET = 'x'.repeat(32);
  process.env.I18N_AUTOMATED_EVIDENCE_ROOT = automatedEvidenceRoot;
  const receipt = buildCommercialI18nReleaseReceipt({}, { official: automatedEvidence('official'), expanded: automatedEvidence('expanded') });
  assert.equal(receipt.catalog.sourcePairs > 40, true);
  assert.notEqual(receipt.catalog.sourcePairs, 40);
  assert.equal(receipt.status, 'HOLD');
  assert.equal(receipt.automatedStatus, 'HOLD');
  assert.match(receipt.receiptHmacSha256, /^[a-f0-9]{64}$/);
  if (prior.build === undefined) delete process.env.NEXYFAB_BUILD_ID; else process.env.NEXYFAB_BUILD_ID = prior.build;
  if (prior.head === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA; else process.env.RAILWAY_GIT_COMMIT_SHA = prior.head;
  if (prior.secret === undefined) delete process.env.GENERATION_EVIDENCE_SIGNING_SECRET; else process.env.GENERATION_EVIDENCE_SIGNING_SECRET = prior.secret;
  if (prior.evidenceRoot === undefined) delete process.env.I18N_AUTOMATED_EVIDENCE_ROOT; else process.env.I18N_AUTOMATED_EVIDENCE_ROOT = prior.evidenceRoot;
});

test('qualifies only when signed full-product artifact review is bound to build/head and all six locales and surfaces', () => {
  const prior = { build: process.env.NEXYFAB_BUILD_ID, head: process.env.RAILWAY_GIT_COMMIT_SHA, secret: process.env.GENERATION_EVIDENCE_SIGNING_SECRET, evidenceRoot: process.env.I18N_FULL_PRODUCT_EVIDENCE_ROOT, automatedRoot: process.env.I18N_AUTOMATED_EVIDENCE_ROOT };
  process.env.NEXYFAB_BUILD_ID = 'build-1'; process.env.RAILWAY_GIT_COMMIT_SHA = 'a'.repeat(40); process.env.GENERATION_EVIDENCE_SIGNING_SECRET = 'x'.repeat(32); process.env.I18N_FULL_PRODUCT_EVIDENCE_ROOT = evidenceRoot;
  process.env.I18N_AUTOMATED_EVIDENCE_ROOT = automatedEvidenceRoot;
  const review = reviewFixture();
  const receipt = buildCommercialI18nReleaseReceipt(completeCatalog, { official: automatedEvidence('official'), expanded: automatedEvidence('expanded'), fullProductReview: review });
  assert.equal(verifyFullProductArtifactReviewReceipt(review, { buildId: 'build-1', head: 'a'.repeat(40), secret: 'x'.repeat(32), evidenceRoot }).ok, true);
  assert.equal(receipt.fullProductReviewStatus, 'QUALIFIED');
  assert.equal(receipt.status, 'QUALIFIED');
  assert.equal(receipt.gaReady, true);
  if (prior.build === undefined) delete process.env.NEXYFAB_BUILD_ID; else process.env.NEXYFAB_BUILD_ID = prior.build;
  if (prior.head === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA; else process.env.RAILWAY_GIT_COMMIT_SHA = prior.head;
  if (prior.secret === undefined) delete process.env.GENERATION_EVIDENCE_SIGNING_SECRET; else process.env.GENERATION_EVIDENCE_SIGNING_SECRET = prior.secret;
  if (prior.evidenceRoot === undefined) delete process.env.I18N_FULL_PRODUCT_EVIDENCE_ROOT; else process.env.I18N_FULL_PRODUCT_EVIDENCE_ROOT = prior.evidenceRoot;
  if (prior.automatedRoot === undefined) delete process.env.I18N_AUTOMATED_EVIDENCE_ROOT; else process.env.I18N_AUTOMATED_EVIDENCE_ROOT = prior.automatedRoot;
});

test('keeps full-product review HOLD for absent, unsigned, stale, synthetic and transplanted evidence', () => {
  const prior = { build: process.env.NEXYFAB_BUILD_ID, head: process.env.RAILWAY_GIT_COMMIT_SHA, secret: process.env.GENERATION_EVIDENCE_SIGNING_SECRET, evidenceRoot: process.env.I18N_FULL_PRODUCT_EVIDENCE_ROOT, automatedRoot: process.env.I18N_AUTOMATED_EVIDENCE_ROOT };
  process.env.NEXYFAB_BUILD_ID = 'build-1'; process.env.RAILWAY_GIT_COMMIT_SHA = 'a'.repeat(40); process.env.GENERATION_EVIDENCE_SIGNING_SECRET = 'x'.repeat(32); process.env.I18N_FULL_PRODUCT_EVIDENCE_ROOT = evidenceRoot;
  process.env.I18N_AUTOMATED_EVIDENCE_ROOT = automatedEvidenceRoot;
  const build = fullProductReview => buildCommercialI18nReleaseReceipt(completeCatalog, { official: automatedEvidence('official'), expanded: automatedEvidence('expanded'), fullProductReview });
  assert.equal(build(null).status, 'HOLD');
  const unsigned = reviewFixture(); delete unsigned.receiptHmacSha256;
  assert.equal(build(unsigned).status, 'HOLD');
  assert.throws(() => reviewFixture('build-1', 'a'.repeat(40), { generatedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() }), /not_signable/);
  const synthetic = reviewFixture(); synthetic.artifacts.visual.synthetic = true;
  assert.throws(() => signFullProductArtifactReviewReceipt(synthetic, 'x'.repeat(32)), /not_signable/);
  assert.equal(build(synthetic).status, 'HOLD');
  const tampered = reviewFixture();
  writeFileSync(path.join(evidenceRoot, tampered.artifacts.visual.artifactPath), 'tampered-output');
  assert.equal(build(tampered).status, 'HOLD');
  const transplanted = reviewFixture('other-build', 'c'.repeat(40));
  assert.equal(build(transplanted).status, 'HOLD');
  if (prior.build === undefined) delete process.env.NEXYFAB_BUILD_ID; else process.env.NEXYFAB_BUILD_ID = prior.build;
  if (prior.head === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA; else process.env.RAILWAY_GIT_COMMIT_SHA = prior.head;
  if (prior.secret === undefined) delete process.env.GENERATION_EVIDENCE_SIGNING_SECRET; else process.env.GENERATION_EVIDENCE_SIGNING_SECRET = prior.secret;
  if (prior.evidenceRoot === undefined) delete process.env.I18N_FULL_PRODUCT_EVIDENCE_ROOT; else process.env.I18N_FULL_PRODUCT_EVIDENCE_ROOT = prior.evidenceRoot;
  if (prior.automatedRoot === undefined) delete process.env.I18N_AUTOMATED_EVIDENCE_ROOT; else process.env.I18N_AUTOMATED_EVIDENCE_ROOT = prior.automatedRoot;
});
