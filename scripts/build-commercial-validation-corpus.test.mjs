import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCommercialValidationCorpus, COMMERCIAL_DOMAINS } from './build-commercial-validation-corpus.mjs';

test('builds 20 synthetic cases per domain and keeps GA fail-closed', () => {
  const result = buildCommercialValidationCorpus({
    countPerDomain: 20,
    referencePath: 'reference.json',
    referenceManifest: {
      __sha256: 'a'.repeat(64),
      policy: { sourceReadOnly: true, trainingUseAllowed: false, commercialScoreRequiresApproval: true },
      summary: { assignedFiles: 10 },
    },
  });
  assert.equal(result.lanes.synthetic.summary.total, 100);
  for (const domain of COMMERCIAL_DOMAINS) {
    assert.equal(result.lanes.synthetic.summary.byDomain[domain], 20);
    assert.equal(result.lanes.independentHoldout.domains[domain].releaseEligible, false);
  }
  assert.equal(result.policy.syntheticMayCertifyCommercialAccuracy, false);
  assert.equal(result.policy.referenceMayCertifyCommercialAccuracy, false);
  assert.equal(result.policy.trainingFromReferenceAllowed, false);
  assert.equal(result.decision, 'development_and_private_evaluation_ready_ga_blocked');
});

test('rejects undersized synthetic lanes', () => {
  assert.throws(() => buildCommercialValidationCorpus({
    countPerDomain: 19,
    referencePath: 'reference.json',
    referenceManifest: { policy: {}, summary: {} },
  }), /integer >= 20/);
});
