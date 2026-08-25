import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDomainCandidates } from './build-domain-accuracy-candidates.mjs';
import { COMMERCIAL_SYNTHETIC_REQUIRED_AXES } from './build-commercial-synthetic-campaign-receipt.mjs';
import { runCommercialSyntheticCampaign } from './run-commercial-synthetic-campaign.mjs';

function corpus(candidate) {
  return {
    schema: 'nexyfab.commercial-validation-corpus.v1',
    lanes: { synthetic: { cases: [candidate] } },
  };
}

test('executes raw template-rebuild assertions instead of accepting count-only PASS', async () => {
  const candidate = buildDomainCandidates('mechanical', 1)[0];
  const observation = await runCommercialSyntheticCampaign({
    corpus: corpus(candidate),
    domains: ['mechanical'],
    casesPerDomain: 1,
    campaigns: 1,
    repeats: 2,
    generatedAt: '2026-08-25T08:00:00.000Z',
  });
  assert.equal(observation.sourceBundle.cases.length, 1);
  assert.equal(observation.resultBundle.results.length, 2);
  assert.deepEqual(observation.resultBundle.results[0].assertions.map(item => item.axis), COMMERCIAL_SYNTHETIC_REQUIRED_AXES);
  assert.ok(observation.resultBundle.results.every(run => run.requiredGatesPassed
    && run.assertions.every(assertion => assertion.status === 'pass')));
  assert.equal(observation.resultBundle.claimBoundary.certifiesCommercialAccuracy, false);
});

test('fails the campaign when the corpus artifact identity is transplanted', async () => {
  const candidate = { ...buildDomainCandidates('mechanical', 1)[0], artifactHash: 'f'.repeat(64) };
  await assert.rejects(() => runCommercialSyntheticCampaign({
    corpus: corpus(candidate),
    domains: ['mechanical'],
    casesPerDomain: 1,
    campaigns: 1,
    repeats: 1,
  }), /synthetic_campaign_observation_failed/);
});
