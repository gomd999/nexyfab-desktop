import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCommercializationReadiness } from './commercialization-readiness-gate.mjs';

const domains = Object.fromEntries(['mechanical', 'building', 'civil', 'landscape', 'interior'].map(domain => [domain, { releaseEligible: true }]));
const passing = {
  currentRelease: { branch: 'release/test', head: 'head-1' },
  releaseBaseline: { release: { branch: 'release/test', head: 'head-1', baselineStatus: 'committed', workingTreeChanges: 0, deploymentId: 'd', buildId: 'b', rollbackDeploymentId: 'r', dockerImageDigest: 'sha256:x', railwayIgnore: { missing: [] } } },
  closedBeta: { ok: true, differences: [] }, liveSmoke: { status: 'pass' },
  productionProtectedState: { ok: true }, openscadHttpSmoke: { ok: true }, authenticatedE2E: { ok: true },
  resourceBaseline: { assessment: { currentMaxWithinTarget: true } },
  migrationReceipt: { ok: true }, restoreReceipt: { ok: true },
  syntheticCampaignReceipt: { ok: true, totalGatePasses: 1500 },
  validationCorpus: { lanes: { synthetic: { summary: { byDomain: { mechanical: 20, building: 20, civil: 20, landscape: 20, interior: 20 } } }, reference: { sourceReadOnly: true }, independentHoldout: { domains } } },
  security: { routeMatrixOk: true, cadApiControlsOk: true, secretFindings: 0, dependencyVulnerabilities: 0 },
  sevenDayOperationsReceipt: { ok: true }, expertReviewReceipt: { ok: true },
};

test('passes both tiers only with complete evidence', () => {
  const result = evaluateCommercializationReadiness(passing);
  assert.equal(result.privateBeta.eligible, true);
  assert.equal(result.commercialGa.eligible, true);
});

test('keeps private beta and GA fail-closed independently', () => {
  const input = structuredClone(passing);
  input.liveSmoke.status = 'fail';
  input.validationCorpus.lanes.independentHoldout.domains.mechanical.releaseEligible = false;
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.privateBeta.eligible, false);
  assert.ok(result.privateBeta.blockers.includes('production_smoke_not_passed'));
  assert.ok(result.commercialGa.blockers.includes('independent_holdout_not_eligible:mechanical'));
});

test('blocks a committed baseline that does not describe the current release head', () => {
  const input = structuredClone(passing);
  input.currentRelease.head = 'head-2';
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.privateBeta.eligible, false);
  assert.ok(result.privateBeta.blockers.includes('release_baseline_head_mismatch'));
  assert.ok(result.commercialGa.blockers.includes('release_baseline_head_mismatch'));
});
