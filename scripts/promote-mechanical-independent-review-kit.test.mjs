import assert from 'node:assert/strict';
import crypto, { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { buildIndependentDomainReviewKit } from './build-independent-domain-review-kit.mjs';
import { promoteMechanicalIndependentReviewKit } from './promote-mechanical-independent-review-kit.mjs';
import { independentDomainReviewPayload, independentDomainReviewTargetHash } from './validate-independent-domain-review-kit.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const baseCorpus = {
  schema: 'nexyfab.commercial-validation-corpus.v1',
  generatedAt: '2026-08-10T00:00:00.000Z',
  policy: {},
  lanes: { independentHoldout: { domains: { mechanical: { releaseEligible: false } } } },
  decision: 'development_and_private_evaluation_ready_ga_blocked',
};

function approvedKit() {
  const kit = buildIndependentDomainReviewKit({ releaseChannel: 'mechanical-core', generatedAt: '2026-08-11T00:00:00.000Z' });
  const domain = generateKeyPairSync('ed25519');
  const independent = generateKeyPairSync('ed25519');
  const trustedReviewers = {
    'reviewer-a': { publicKey: domain.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['domain-reviewer'] },
    'reviewer-b': { publicKey: independent.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['independent-reviewer'] },
  };
  kit.cases.forEach((item, index) => {
    const sourceHash = hash(`source-${index}`);
    item.status = 'approved';
    item.source = {
      organizationId: `org-${index}`,
      lineageId: `lineage-${index}`,
      sourceSha256: sourceHash,
      licenseDecision: 'approved',
      independentOfTrainingAndReferenceCorpus: true,
      acquisitionAttestation: `acquisition-${index}`,
    };
    item.blindedRun = {
      inputSha256: sourceHash,
      outputArtifactHashes: [hash(`output-${index}`)],
      automaticValidationReceipt: { schema: 'nexyfab.domain-automatic-validation.v1', path: `receipts/case-${index}.json`, sha256: hash(`automatic-${index}`) },
      executedAt: '2026-08-11T01:00:00.000Z',
    };
    const targetHash = independentDomainReviewTargetHash(kit, item);
    const domainReview = { reviewerId: 'reviewer-a', independentFromBuild: true, decision: 'approved', reviewedAt: '2026-08-11T02:00:00.000Z', targetHash };
    const independentReview = { reviewerId: 'reviewer-b', independentFromBuild: true, decision: 'approved', reviewedAt: '2026-08-11T03:00:00.000Z', targetHash };
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

test('refuses to promote the honest pending mechanical kit', () => {
  const kit = buildIndependentDomainReviewKit({ releaseChannel: 'mechanical-core' });
  assert.throws(() => promoteMechanicalIndependentReviewKit({
    baseCorpus, kit, kitPath: 'kit.json', kitBytes: Buffer.from(JSON.stringify(kit)),
  }), /REVIEW_KIT_NOT_ELIGIBLE/);
});

test('promotes only a complete 20-case dual-reviewed mechanical kit and binds its bytes', () => {
  const { kit, trustedReviewers } = approvedKit();
  const bytes = Buffer.from(JSON.stringify(kit));
  const promoted = promoteMechanicalIndependentReviewKit({
    baseCorpus,
    kit,
    kitPath: 'controlled/mechanical-kit.json',
    kitBytes: bytes,
    generatedAt: '2026-08-11T04:00:00.000Z',
    trustedReviewers,
  });
  assert.equal(promoted.schema, 'nexyfab.commercial-validation-corpus.v2');
  assert.equal(promoted.releaseChannel, 'mechanical-core');
  assert.deepEqual(promoted.requiredDomains, ['mechanical']);
  assert.deepEqual(promoted.lanes.independentHoldout.domains.mechanical, {
    requiredCases: 20,
    approvedCases: 20,
    requiredIndependentReviewers: 2,
    independentReviewers: 2,
    releaseEligible: true,
    blockers: [],
    sourceReviewKit: { path: 'controlled/mechanical-kit.json', sha256: hash(bytes) },
  });
  assert.equal(promoted.promotion.sourceMutated, false);
});
