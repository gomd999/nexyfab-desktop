import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateHoldoutAcquisitions } from './validate-holdout-acquisitions.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const signed = (reviewerId, reviewedAt = '2026-08-11T01:00:00.000Z') => ({
  decision: 'approved', reviewerId, reviewedAt, signedArtifactHash: hash(`${reviewerId}:${reviewedAt}`),
});
const queue = {
  schema: 'nexyfab.holdout-shortfall-acquisition-queue.v1',
  slots: [{
    slotId: 'robot-acquire-10', family: 'robot', requirements: {
      preferredExactFormats: ['step'], conditionalFormats: ['zip'],
    },
  }],
};

function validSubmission(bytes) {
  return {
    schema: 'nexyfab.holdout-acquisition-submission.v1',
    modelFreeze: {
      releaseHead: 'a'.repeat(40), frozenAt: '2026-08-11T00:00:00.000Z', receiptHash: 'b'.repeat(64),
    },
    records: [{
      slotId: 'robot-acquire-10', family: 'robot', lineageGroup: 'robot:independent-product-10',
      relativePath: 'robot.step', extension: 'step', sourceHash: hash(bytes), bytes: Buffer.byteLength(bytes),
      sourceAcquiredAt: '2026-08-11T00:30:00.000Z',
      provenance: {
        sourceUrl: 'https://manufacturer.example/cad/robot-10', provider: 'Manufacturer',
        licenseId: 'commercial-evaluation-approved', licenseUrl: 'https://manufacturer.example/terms',
        commercialUseStatus: 'approved', review: signed('license-reviewer'),
      },
      holdoutIsolation: {
        excludedFromTraining: true, excludedFromFineTuning: true, excludedFromPromptDevelopment: true,
        evaluationAccessRestricted: true, accessControlReceiptHash: 'c'.repeat(64), review: signed('isolation-reviewer'),
      },
      nativeStructure: {
        definitions: 5, occurrences: 7, transforms: 7, joints: 6,
        extractor: 'governed-native-cad-worker', receiptHash: 'd'.repeat(64), review: signed('domain-reviewer'),
      },
    }],
  };
}

test('accepts a complete independent acquisition without exposing protected review data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-holdout-acquisition-'));
  try {
    const bytes = 'ISO-10303-21; independent robot product';
    fs.writeFileSync(path.join(root, 'robot.step'), bytes);
    const receipt = validateHoldoutAcquisitions({ queue, existingCases: [], submission: validSubmission(bytes), corpusRoot: root });
    assert.equal(receipt.readyForCuration, true);
    assert.deepEqual(receipt.summary, { required: 1, submitted: 1, valid: 1, invalid: 0, missing: 0 });
    const serialized = JSON.stringify(receipt);
    assert.equal(serialized.includes('license-reviewer'), false);
    assert.equal(serialized.includes(root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects reused lineage/hash, live pre-freeze data, and same-person isolation review', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-holdout-acquisition-'));
  try {
    const bytes = 'ISO-10303-21; reused robot product';
    fs.writeFileSync(path.join(root, 'robot.step'), bytes);
    const submission = validSubmission(bytes);
    submission.records[0].lineageGroup = 'Robot:Existing-Product';
    submission.records[0].sourceHash = hash(bytes).toUpperCase();
    submission.records[0].sourceAcquiredAt = '2026-08-10T23:59:59.000Z';
    submission.records[0].holdoutIsolation.review = signed('license-reviewer');
    const receipt = validateHoldoutAcquisitions({
      queue,
      existingCases: [{ holdoutGroup: 'robot:existing-product', sourceHash: hash(bytes) }],
      submission,
      corpusRoot: root,
    });
    assert.equal(receipt.readyForCuration, false);
    const issues = receipt.results[0].issues;
    for (const issue of [
      'lineage_overlaps_existing_holdout', 'source_hash_overlaps_existing_holdout',
      'source_acquired_before_model_freeze', 'provenance_and_isolation_reviewers_must_differ',
    ]) assert.ok(issues.includes(issue), `missing issue: ${issue}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('requires every governed slot and a review for conditional archive formats', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-holdout-acquisition-'));
  try {
    const bytes = 'archive fixture';
    fs.writeFileSync(path.join(root, 'robot.zip'), bytes);
    const submission = validSubmission(bytes);
    submission.records[0].relativePath = 'robot.zip';
    submission.records[0].extension = 'zip';
    const receipt = validateHoldoutAcquisitions({ queue, existingCases: [], submission, corpusRoot: root });
    assert.equal(receipt.readyForCuration, false);
    assert.ok(receipt.results[0].issues.includes('conditional_format_review:decision_not_approved'));

    const empty = validateHoldoutAcquisitions({ queue, existingCases: [], submission: { ...submission, records: [] }, corpusRoot: root });
    assert.deepEqual(empty.missingSlots, ['robot-acquire-10']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
