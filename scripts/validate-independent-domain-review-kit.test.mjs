import assert from 'node:assert/strict';
import crypto, { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { buildIndependentDomainReviewKit } from './build-independent-domain-review-kit.mjs';
import {
  independentDomainReviewPayload,
  independentDomainReviewTargetHash,
  validateIndependentDomainReviewKit,
} from './validate-independent-domain-review-kit.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function signedMechanicalKit() {
  const kit = buildIndependentDomainReviewKit({ releaseChannel: 'mechanical-core', generatedAt: '2026-08-11T00:00:00.000Z' });
  const domain = generateKeyPairSync('ed25519');
  const independent = generateKeyPairSync('ed25519');
  const trustedReviewers = {
    domain: { publicKey: domain.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['domain-reviewer'] },
    independent: { publicKey: independent.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['independent-reviewer'] },
  };
  kit.cases.forEach((item, index) => {
    const sourceSha256 = hash(`source-${index}`);
    item.status = 'approved';
    item.source = { organizationId: `org-${index}`, lineageId: `lineage-${index}`, sourceSha256, licenseDecision: 'approved', independentOfTrainingAndReferenceCorpus: true, acquisitionAttestation: `attestation-${index}` };
    item.blindedRun = { inputSha256: sourceSha256, outputArtifactHashes: [hash(`output-${index}`)], automaticValidationReceipt: { schema: 'nexyfab.domain-automatic-validation.v1', path: `receipts/case-${index}.json`, sha256: hash(`receipt-${index}`) }, executedAt: '2026-08-11T01:00:00.000Z' };
    const targetHash = independentDomainReviewTargetHash(kit, item);
    const domainReview = { reviewerId: 'domain', independentFromBuild: true, decision: 'approved', reviewedAt: '2026-08-11T02:00:00.000Z', targetHash };
    const independentReview = { reviewerId: 'independent', independentFromBuild: true, decision: 'approved', reviewedAt: '2026-08-11T03:00:00.000Z', targetHash };
    item.reviews = {
      domainReviewer: { ...domainReview, signature: sign(null, Buffer.from(independentDomainReviewPayload(kit, item, 'domain-reviewer', domainReview)), domain.privateKey).toString('base64') },
      independentReviewer: { ...independentReview, signature: sign(null, Buffer.from(independentDomainReviewPayload(kit, item, 'independent-reviewer', independentReview)), independent.privateKey).toString('base64') },
      disagreementResolution: null,
    };
    item.releaseEligible = true;
  });
  kit.summary = { requiredCases: 20, acquiredCases: 20, approvedCases: 20, requiredSignedReviews: 40, completedSignedReviews: 40 };
  return { kit, trustedReviewers };
}

test('the fixed five-domain registry has 20 honest pending slots per domain', () => {
  const kit = JSON.parse(fs.readFileSync('docs/evidence/release/independent-domain-review-kit-260810.json', 'utf8'));
  const report = validateIndependentDomainReviewKit(kit);
  assert.equal(report.structurallyValid, true);
  assert.equal(report.releaseEligible, false);
  assert.deepEqual(report.counts, { mechanical: 20, building: 20, civil: 20, landscape: 20, interior: 20 });
  assert.deepEqual(report.summary, { requiredCases: 100, acquiredCases: 0, approvedCases: 0, requiredSignedReviews: 200, completedSignedReviews: 0 });
  assert.deepEqual(kit.cases[0].requiredAxes, [
    'dimension', 'topology', 'assembly', 'motion', 'collision clearance',
    'STEP roundtrip', 'drawing', 'BOM', 'manufacturing',
  ]);
});

test('a forged releaseEligible flag is rejected', () => {
  const kit = JSON.parse(fs.readFileSync('docs/evidence/release/independent-domain-review-kit-260810.json', 'utf8'));
  kit.cases[0].releaseEligible = true;
  const report = validateIndependentDomainReviewKit(kit);
  assert.equal(report.structurallyValid, false);
  assert.match(report.issues.join(','), /false_release_eligible/);
});

test('a review case cannot omit a required commercial verification axis', () => {
  const kit = JSON.parse(fs.readFileSync('docs/evidence/release/independent-domain-review-kit-260810.json', 'utf8'));
  kit.cases[0].requiredAxes = kit.cases[0].requiredAxes.filter(axis => axis !== 'manufacturing');
  const report = validateIndependentDomainReviewKit(kit);
  assert.equal(report.structurallyValid, false);
  assert.match(report.issues.join(','), /case_required_axes_invalid:mechanical-independent-01/);
});

test('mechanical-core creates exactly twenty mechanical cases without spatial scope', () => {
  const kit = buildIndependentDomainReviewKit({ releaseChannel: 'mechanical-core', generatedAt: '2026-08-11T00:00:00.000Z' });
  const report = validateIndependentDomainReviewKit(kit);
  assert.equal(report.structurallyValid, true);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.releaseChannel, 'mechanical-core');
  assert.deepEqual(report.requiredDomains, ['mechanical']);
  assert.deepEqual(report.counts, { mechanical: 20 });
  assert.deepEqual(report.summary, { requiredCases: 20, acquiredCases: 0, approvedCases: 0, requiredSignedReviews: 40, completedSignedReviews: 0 });
  assert.equal(kit.cases.some(item => item.domain !== 'mechanical'), false);
});

test('mechanical-core rejects a spatial case injected into its review kit', () => {
  const kit = buildIndependentDomainReviewKit({ releaseChannel: 'mechanical-core' });
  kit.cases[0].domain = 'building';
  const report = validateIndependentDomainReviewKit(kit);
  assert.equal(report.structurallyValid, false);
  assert.match(report.issues.join(','), /case_domain_out_of_release_scope/);
});

test('verified-building creates an isolated twenty-case review channel', () => {
  const kit = buildIndependentDomainReviewKit({ releaseChannel: 'verified-building' });
  const report = validateIndependentDomainReviewKit(kit);
  assert.equal(report.structurallyValid, true);
  assert.equal(report.releaseEligible, false);
  assert.deepEqual(report.requiredDomains, ['building']);
  assert.deepEqual(report.counts, { building: 20 });
  assert.equal(kit.cases.every(item => item.domain === 'building'), true);

  kit.requiredDomains = ['building', 'interior'];
  assert.match(validateIndependentDomainReviewKit(kit).issues.join(','), /required_domains_contract_mismatch/);
});

for (const [releaseChannel, domain] of [
  ['verified-building', 'building'],
  ['verified-interior', 'interior'],
  ['verified-civil', 'civil'],
  ['verified-landscape', 'landscape'],
]) {
  test(`${releaseChannel} cannot borrow evidence from a sibling spatial discipline`, () => {
    const kit = buildIndependentDomainReviewKit({ releaseChannel });
    assert.deepEqual(kit.requiredDomains, [domain]);
    assert.equal(kit.cases.length, 20);
    assert.equal(kit.cases.every(item => item.domain === domain), true);
    const sibling = domain === 'building' ? 'interior' : 'building';
    kit.cases[0].domain = sibling;
    assert.match(validateIndependentDomainReviewKit(kit).issues.join(','), /case_domain_out_of_release_scope/);
  });
}

test('v3 releases only exact case targets signed by distinct trusted role keys', () => {
  const { kit, trustedReviewers } = signedMechanicalKit();
  const now = Date.parse('2026-08-11T04:00:00.000Z');
  assert.equal(validateIndependentDomainReviewKit(kit, { trustedReviewers, now }).releaseEligible, true);
  kit.cases[0].blindedRun.outputArtifactHashes[0] = hash('tampered-output');
  const tampered = validateIndependentDomainReviewKit(kit, { trustedReviewers, now });
  assert.equal(tampered.releaseEligible, false);
  assert.match(tampered.issues.join(','), /review_signature_invalid:mechanical-independent-01/);
});

test('v3 refuses a label-only automatic validation receipt without a bound file hash', () => {
  const { kit, trustedReviewers } = signedMechanicalKit();
  kit.cases[0].blindedRun.automaticValidationReceipt = 'receipt-label-only';
  const report = validateIndependentDomainReviewKit(kit, { trustedReviewers, now: Date.parse('2026-08-11T04:00:00.000Z') });
  assert.equal(report.releaseEligible, false);
  assert.match(report.issues.join(','), /false_release_eligible:mechanical-independent-01/);
});
