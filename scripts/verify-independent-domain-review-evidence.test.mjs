import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildIndependentDomainReviewKit } from './build-independent-domain-review-kit.mjs';
import { verifyIndependentDomainReviewEvidence } from './verify-independent-domain-review-evidence.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
test('pending kit fails closed when receipt files are absent', () => {
  const kit = buildIndependentDomainReviewKit({ releaseChannel: 'mechanical-core' });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-evidence-'));
  const report = verifyIndependentDomainReviewEvidence(kit, { evidenceRoot: root });
  assert.equal(report.releaseEligible, false);
  assert.match(report.issues.join(','), /receipt_file_missing/);
});

test('receipt verification binds exact bytes and declared output hashes', () => {
  const kit = buildIndependentDomainReviewKit({ releaseChannel: 'mechanical-core' });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-evidence-'));
  const item = kit.cases[0];
  const receipt = { schema: 'nexyfab.domain-automatic-validation.v1', caseId: item.caseId, inputSha256: hash('input'), outputArtifactHashes: [hash('output')] };
  const bytes = Buffer.from(JSON.stringify(receipt));
  fs.mkdirSync(path.join(root, 'receipts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'receipts/case.json'), bytes);
  item.source = { organizationId: 'org', lineageId: 'lineage', sourceSha256: hash('input'), licenseDecision: 'approved', independentOfTrainingAndReferenceCorpus: true, acquisitionAttestation: 'external-attestation' };
  item.blindedRun = { inputSha256: hash('input'), outputArtifactHashes: [hash('output')], automaticValidationReceipt: { schema: receipt.schema, path: 'receipts/case.json', sha256: hash(bytes) }, executedAt: '2026-08-22T00:00:00Z' };
  const report = verifyIndependentDomainReviewEvidence(kit, { evidenceRoot: root });
  assert.equal(report.checkedReceipts, 1);
  assert.equal(report.issues.some(issue => issue.includes(item.caseId)), false);
});

test('receipt verification rejects a parent directory symlink that escapes the evidence root', t => {
  const kit = buildIndependentDomainReviewKit({ releaseChannel: 'mechanical-core' });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-evidence-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-evidence-outside-'));
  const item = kit.cases[0];
  const receipt = { schema: 'nexyfab.domain-automatic-validation.v1', caseId: item.caseId, inputSha256: hash('input'), outputArtifactHashes: [hash('output')] };
  const bytes = Buffer.from(JSON.stringify(receipt));
  fs.writeFileSync(path.join(outside, 'case.json'), bytes);
  try {
    fs.symlinkSync(outside, path.join(root, 'receipts'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    t.skip('directory symlinks are unavailable in this environment');
    return;
  }
  item.source = { organizationId: 'org', lineageId: 'lineage', sourceSha256: hash('input'), licenseDecision: 'approved', independentOfTrainingAndReferenceCorpus: true, acquisitionAttestation: 'external-attestation' };
  item.blindedRun = { inputSha256: hash('input'), outputArtifactHashes: [hash('output')], automaticValidationReceipt: { schema: receipt.schema, path: 'receipts/case.json', sha256: hash(bytes) }, executedAt: '2026-08-22T00:00:00Z' };
  const report = verifyIndependentDomainReviewEvidence(kit, { evidenceRoot: root });
  assert.equal(report.checkedReceipts, 0);
  assert.match(report.issues.join(','), new RegExp(`receipt_file_missing:${item.caseId}`));
});
