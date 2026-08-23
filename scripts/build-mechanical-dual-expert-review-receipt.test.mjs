import assert from 'node:assert/strict';
import crypto, { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { buildIndependentDomainReviewKit } from './build-independent-domain-review-kit.mjs';
import { buildMechanicalDualExpertReviewReceipt } from './build-mechanical-dual-expert-review-receipt.mjs';
import { validateMechanicalDualExpertReview } from './build-mechanical-product-scope-assessment.mjs';
import { independentDomainReviewPayload, independentDomainReviewTargetHash } from './validate-independent-domain-review-kit.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function approvedKit() {
  const kit = buildIndependentDomainReviewKit({ releaseChannel: 'mechanical-core' });
  const domain = generateKeyPairSync('ed25519');
  const independent = generateKeyPairSync('ed25519');
  const trustedReviewers = {
    'mechanical-expert': { publicKey: domain.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['domain-reviewer'] },
    'independent-expert': { publicKey: independent.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['independent-reviewer'] },
  };
  kit.cases.forEach((item, index) => {
    const sourceHash = hash(`source-${index}`);
    item.status = 'approved';
    item.source = { organizationId: `org-${index}`, lineageId: `lineage-${index}`, sourceSha256: sourceHash, licenseDecision: 'approved', independentOfTrainingAndReferenceCorpus: true, acquisitionAttestation: `attestation-${index}` };
    item.blindedRun = { inputSha256: sourceHash, outputArtifactHashes: [hash(`output-${index}`)], automaticValidationReceipt: { schema: 'nexyfab.domain-automatic-validation.v1', path: `receipts/case-${index}.json`, sha256: hash(`receipt-${index}`) }, executedAt: '2026-08-11T01:00:00.000Z' };
    const targetHash = independentDomainReviewTargetHash(kit, item);
    const domainReview = { reviewerId: 'mechanical-expert', independentFromBuild: true, decision: 'approved', reviewedAt: '2026-08-11T02:00:00.000Z', targetHash };
    const independentReview = { reviewerId: 'independent-expert', independentFromBuild: true, decision: 'approved', reviewedAt: '2026-08-11T03:00:00.000Z', targetHash };
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

test('refuses a pending review kit', () => {
  const kit = buildIndependentDomainReviewKit({ releaseChannel: 'mechanical-core' });
  assert.throws(() => buildMechanicalDualExpertReviewReceipt({ kit, kitBytes: Buffer.from(JSON.stringify(kit)) }), /KIT_NOT_ELIGIBLE/);
});

test('binds two independent reviewers to the exact approved kit bytes', () => {
  const { kit, trustedReviewers } = approvedKit();
  const bytes = Buffer.from(JSON.stringify(kit));
  const receipt = buildMechanicalDualExpertReviewReceipt({ kit, kitBytes: bytes, trustedReviewers });
  assert.equal(receipt.holdoutCorpusSha256, hash(bytes));
  assert.equal(receipt.reviewKitSchema, 'nexyfab.independent-domain-review-kit.v3');
  assert.equal(receipt.reviewers.length, 2);
  assert.equal(validateMechanicalDualExpertReview(receipt, hash(bytes)), true);
  assert.equal(validateMechanicalDualExpertReview(receipt, hash('different-kit')), false);
});
