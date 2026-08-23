import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateHoldoutAcquisitions } from './validate-holdout-acquisitions.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const freezeAt = '2026-08-11T00:00:00.000Z';
const acquiredAt = '2026-08-11T00:30:00.000Z';
const reviewedAt = '2026-08-11T01:00:00.000Z';
const queue = {
  schema: 'nexyfab.holdout-shortfall-acquisition-queue.v1',
  policy: {
    placeholdersAreNotCases: true,
    grantsApproval: false,
    scoreEligible: false,
    crossFamilyReuseForbidden: true,
    snapshotArchiveAndMembersShareLineage: true,
  },
  summary: { required: 1, acquired: 0, remaining: 1 },
  slots: [{
    slotId: 'robot-acquire-10', family: 'robot', status: 'missing', scoreEligible: false,
    requirements: {
      independentProductLineage: true,
      sourceSha256Required: true,
      commercialProvenanceReviewRequired: true,
      holdoutIsolationRequired: true,
      nativeDefinitionOccurrenceReviewRequired: true,
      preferredExactFormats: ['step'],
      conditionalFormats: ['zip'],
    },
  }],
};
const queueSha256 = hash(JSON.stringify(queue));
const existingCasesSha256 = hash('[]');

function write(root, relativePath, bytes) {
  const file = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  const content = fs.readFileSync(file);
  return { relativePath, bytes: content.length, sha256: hash(content) };
}

function writeJson(root, relativePath, value) {
  return write(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function review(root, { kind, slotId, family, sourceHash, subjectHash, reviewerId }) {
  const attestation = {
    schema: 'nexyfab.holdout-review-attestation.v1',
    kind,
    slotId,
    family,
    sourceHash,
    subjectHash,
    decision: 'approved',
    reviewerId,
    reviewedAt,
    signatureVerification: {
      status: 'verified',
      algorithm: 'ed25519',
      keyId: `controlled-review:${reviewerId}`,
      verifiedAt: reviewedAt,
      receiptHash: hash(`signature:${kind}:${reviewerId}:${subjectHash}`),
    },
  };
  return {
    decision: 'approved',
    reviewerId,
    reviewedAt,
    subjectHash,
    signedArtifact: writeJson(root, `reviews/${slotId}-${kind}.json`, attestation),
  };
}

function validFixture(root, { extension = 'step', bytes = 'ISO-10303-21; independent robot product' } = {}) {
  const slotId = 'robot-acquire-10';
  const family = 'robot';
  const source = write(root, `sources/robot.${extension}`, bytes);
  const sourceHash = source.sha256;
  const freezeReceipt = writeJson(root, 'receipts/model-freeze.json', {
    schema: 'nexyfab.model-freeze-receipt.v1',
    releaseHead: 'a'.repeat(40),
    frozenAt: freezeAt,
    queueSha256,
    existingCasesSha256,
    signatureVerification: {
      status: 'verified',
      algorithm: 'ed25519',
      keyId: 'controlled-release:model-freeze',
      verifiedAt: freezeAt,
      receiptHash: hash(`model-freeze:${queueSha256}:${existingCasesSha256}`),
    },
  });
  const licenseEvidence = write(root, 'licenses/robot-license.html', '<html>Commercial evaluation permitted.</html>');
  const isolationReceipt = writeJson(root, `receipts/${slotId}-isolation.json`, {
    schema: 'nexyfab.holdout-isolation-receipt.v1',
    slotId,
    family,
    sourceHash,
    effectiveAt: '2026-08-11T00:15:00.000Z',
    accessPolicyId: 'holdout-evaluation-only-v1',
    controls: {
      excludedFromTraining: true,
      excludedFromFineTuning: true,
      excludedFromPromptDevelopment: true,
      evaluationAccessRestricted: true,
    },
  });
  const nativeReceipt = writeJson(root, `receipts/${slotId}-native.json`, {
    schema: 'nexyfab.native-structure-receipt.v1',
    slotId,
    family,
    sourceHash,
    generatedAt: '2026-08-11T00:45:00.000Z',
    extractor: {
      name: 'governed-native-cad-worker',
      version: '1.0.0',
      artifactHash: 'e'.repeat(64),
    },
    counts: { definitions: 5, occurrences: 7, transforms: 7, joints: 6 },
  });
  const record = {
    slotId,
    family,
    lineageGroup: 'robot:independent-product-10',
    relativePath: source.relativePath,
    extension,
    sourceHash,
    bytes: source.bytes,
    sourceAcquiredAt: acquiredAt,
    provenance: {
      sourceUrl: 'https://manufacturer.example/cad/robot-10',
      provider: 'Manufacturer',
      productId: 'ROBOT-10',
      licenseId: 'commercial-evaluation-approved',
      licenseUrl: 'https://manufacturer.example/terms',
      commercialUseStatus: 'approved',
      licenseEvidence,
      review: review(root, { kind: 'provenance', slotId, family, sourceHash, subjectHash: licenseEvidence.sha256, reviewerId: 'license-reviewer' }),
    },
    holdoutIsolation: {
      excludedFromTraining: true,
      excludedFromFineTuning: true,
      excludedFromPromptDevelopment: true,
      evaluationAccessRestricted: true,
      accessControlReceipt: isolationReceipt,
      review: review(root, { kind: 'holdout_isolation', slotId, family, sourceHash, subjectHash: isolationReceipt.sha256, reviewerId: 'isolation-reviewer' }),
    },
    nativeStructure: {
      definitions: 5,
      occurrences: 7,
      transforms: 7,
      joints: 6,
      extractor: 'governed-native-cad-worker',
      extractorVersion: '1.0.0',
      extractorArtifactHash: 'e'.repeat(64),
      receipt: nativeReceipt,
      review: review(root, { kind: 'native_structure', slotId, family, sourceHash, subjectHash: nativeReceipt.sha256, reviewerId: 'domain-reviewer' }),
    },
  };
  return {
    source,
    submission: {
      schema: 'nexyfab.holdout-acquisition-submission.v2',
      queueBinding: { sha256: queueSha256, slotCount: 1 },
      existingCorpusBinding: { sha256: existingCasesSha256, caseCount: 0 },
      modelFreeze: { releaseHead: 'a'.repeat(40), frozenAt: freezeAt, receipt: freezeReceipt },
      records: [record],
    },
  };
}

function validate(root, submission, existingCases = []) {
  return validateHoldoutAcquisitions({
    queue,
    queueSha256,
    existingCases,
    existingCasesSha256,
    submission,
    corpusRoot: root,
  });
}

function withRoot(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-holdout-acquisition-'));
  try { return callback(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('accepts a fully hash-bound acquisition and redacts protected intake data', () => withRoot(root => {
  const { submission } = validFixture(root);
  const receipt = validate(root, submission);
  assert.equal(receipt.readyForCuration, true);
  assert.deepEqual(receipt.summary, { required: 1, submitted: 1, valid: 1, invalid: 0, missing: 0 });
  const serialized = JSON.stringify(receipt);
  for (const secret of ['license-reviewer', 'manufacturer.example', 'ROBOT-10', root]) {
    assert.equal(serialized.includes(secret), false, `receipt leaked ${secret}`);
  }
}));

test('rejects reused lineage/hash, pre-freeze acquisition, and reviewer role reuse', () => withRoot(root => {
  const { submission } = validFixture(root);
  const record = submission.records[0];
  record.lineageGroup = 'Robot:Existing-Product';
  record.sourceHash = record.sourceHash.toUpperCase();
  record.sourceAcquiredAt = '2026-08-10T23:59:59.000Z';
  record.holdoutIsolation.review.reviewerId = 'license-reviewer';
  const receipt = validate(root, submission, [{ holdoutGroup: 'robot:existing-product', sourceHash: record.sourceHash }]);
  assert.equal(receipt.readyForCuration, false);
  const issues = receipt.results[0].issues;
  for (const issue of [
    'lineage_overlaps_existing_holdout',
    'source_hash_overlaps_existing_holdout',
    'source_acquired_at_before_required_boundary',
    'reviewer_roles_must_differ',
  ]) assert.ok(issues.includes(issue), `missing issue: ${issue}`);
}));

test('rejects a self-reported native count that is not bound by the extraction receipt', () => withRoot(root => {
  const { submission } = validFixture(root);
  submission.records[0].nativeStructure.occurrences = 99;
  const receipt = validate(root, submission);
  assert.equal(receipt.readyForCuration, false);
  assert.ok(receipt.results[0].issues.includes('native_structure:receipt_occurrences_mismatch'));
}));

test('rejects mutated receipt bytes and isolation controls that disagree with the signed record', () => withRoot(root => {
  const { submission } = validFixture(root);
  const record = submission.records[0];
  fs.appendFileSync(path.join(root, ...record.nativeStructure.receipt.relativePath.split('/')), '\nmutation');
  record.holdoutIsolation.excludedFromTraining = false;
  const receipt = validate(root, submission);
  const issues = receipt.results[0].issues;
  assert.ok(issues.includes('native_structure:receipt:size_mismatch'));
  assert.ok(issues.includes('native_structure:receipt:hash_mismatch'));
  assert.ok(issues.includes('holdout_isolation:excludedFromTraining_required'));
}));

test('rejects queue/corpus bindings that do not match the frozen inputs', () => withRoot(root => {
  const { submission } = validFixture(root);
  submission.queueBinding.sha256 = 'f'.repeat(64);
  submission.existingCorpusBinding.caseCount = 88;
  const receipt = validate(root, submission);
  assert.ok(receipt.globalIssues.includes('queue_binding_mismatch'));
  assert.ok(receipt.globalIssues.includes('existing_corpus_binding_mismatch'));
  assert.equal(receipt.readyForCuration, false);
}));

test('rejects an unsigned model freeze and a review timestamp before its native receipt', () => withRoot(root => {
  const { submission } = validFixture(root);
  const freezePath = path.join(root, ...submission.modelFreeze.receipt.relativePath.split('/'));
  const freezeReceipt = JSON.parse(fs.readFileSync(freezePath, 'utf8'));
  delete freezeReceipt.signatureVerification;
  const changedFreeze = writeJson(root, submission.modelFreeze.receipt.relativePath, freezeReceipt);
  submission.modelFreeze.receipt = changedFreeze;
  submission.records[0].nativeStructure.review.reviewedAt = '2026-08-11T00:40:00.000Z';
  const receipt = validate(root, submission);
  assert.ok(receipt.globalIssues.includes('model_freeze_receipt:signature_not_verified'));
  assert.ok(receipt.results[0].issues.includes('native_structure_review:reviewed_at_before_required_boundary'));
  assert.equal(receipt.readyForCuration, false);
}));

test('rejects duplicate source URL and provider product identity even when a second hash is used', () => withRoot(root => {
  const { submission } = validFixture(root);
  const duplicate = structuredClone(submission.records[0]);
  duplicate.relativePath = write(root, 'sources/robot-duplicate.step', 'different CAD bytes').relativePath;
  duplicate.sourceHash = hash('different CAD bytes');
  duplicate.bytes = Buffer.byteLength('different CAD bytes');
  submission.records.push(duplicate);
  const receipt = validate(root, submission);
  const issues = receipt.results[1].issues;
  assert.ok(issues.includes('provenance_source_url_duplicate_in_submission'));
  assert.ok(issues.includes('provenance_product_identity_duplicate_in_submission'));
}));

test('requires a reviewed safe archive manifest for ZIP and rejects traversal/executable members', () => withRoot(root => {
  const { submission } = validFixture(root, { extension: 'zip', bytes: 'archive fixture bytes' });
  const record = submission.records[0];
  const archiveManifest = writeJson(root, 'receipts/robot-archive-manifest.json', {
    schema: 'nexyfab.holdout-archive-manifest.v1',
    slotId: record.slotId,
    family: record.family,
    sourceHash: record.sourceHash,
    generatedAt: '2026-08-11T00:40:00.000Z',
    scanner: { name: 'safe-archive-scanner', version: '1.0.0', artifactHash: '9'.repeat(64) },
    expandedBytes: 3,
    entries: [
      { relativePath: '../escape.step', kind: 'file', encrypted: false, bytes: 1, sha256: '1'.repeat(64) },
      { relativePath: 'payload.exe', kind: 'file', encrypted: false, bytes: 2, sha256: '2'.repeat(64) },
    ],
  });
  record.archiveManifest = archiveManifest;
  record.conditionalFormatReview = review(root, {
    kind: 'conditional_format', slotId: record.slotId, family: record.family,
    sourceHash: record.sourceHash, subjectHash: archiveManifest.sha256, reviewerId: 'domain-reviewer',
  });
  const receipt = validate(root, submission);
  const issues = receipt.results[0].issues;
  assert.ok(issues.includes('archive_manifest:member_path_unsafe'));
  assert.ok(issues.includes('archive_manifest:dangerous_member_extension'));
  assert.ok(issues.includes('reviewer_roles_must_differ'));
  assert.equal(receipt.readyForCuration, false);
}));

test('rejects non-canonical source traversal before reading bytes', () => withRoot(root => {
  const { submission } = validFixture(root);
  submission.records[0].relativePath = 'sources/../sources/robot.step';
  const receipt = validate(root, submission);
  assert.ok(receipt.results[0].issues.includes('relative_path_noncanonical'));
  assert.equal(receipt.readyForCuration, false);
}));

test('rejects using source CAD bytes as license evidence', () => withRoot(root => {
  const { submission, source } = validFixture(root);
  const record = submission.records[0];
  record.provenance.licenseEvidence = source;
  const receipt = validate(root, submission);
  assert.ok(receipt.results[0].issues.includes('source_path_reused_as_control_artifact'));
  assert.equal(receipt.readyForCuration, false);
}));

test('rejects a symlinked source that escapes the controlled root when the host supports symlinks', t => withRoot(root => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-holdout-outside-'));
  try {
    const outsideFile = path.join(outside, 'outside.step');
    fs.writeFileSync(outsideFile, 'outside CAD');
    const link = path.join(root, 'sources', 'linked.step');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    try { fs.symlinkSync(outsideFile, link, 'file'); } catch { t.skip('host does not permit symlink creation'); return; }
    const { submission } = validFixture(root);
    const record = submission.records[0];
    record.relativePath = 'sources/linked.step';
    record.extension = 'step';
    record.sourceHash = hash('outside CAD');
    record.bytes = Buffer.byteLength('outside CAD');
    const receipt = validate(root, submission);
    assert.ok(receipt.results[0].issues.includes('source_path_symlink_forbidden'));
    assert.equal(receipt.readyForCuration, false);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
}));
