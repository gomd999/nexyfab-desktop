import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCommercializationReadiness } from './commercialization-readiness-gate.mjs';

const domains = Object.fromEntries(['mechanical', 'building', 'civil', 'landscape', 'interior'].map(domain => [domain, { releaseEligible: true }]));
const complexFamilies = ['robot', 'gearbox', 'pressure_vessel', 'turbomachinery', 'factory_equipment', 'interior'];
const complexHoldoutCases = complexFamilies.flatMap((family, familyIndex) => Array.from({ length: 20 }, (_, index) => ({
  schema: 'nexyfab.complex-benchmark-case.v2',
  caseId: `${family}-${index + 1}`,
  family,
  split: 'holdout',
  sourceHash: `${familyIndex}-${index}`.padEnd(64, 'a'),
  holdoutGroup: `${family}:independent-${index + 1}`,
  assertions: [{ id: 'geometry', required: true }],
})));
const complexGroundTruthValidation = {
  schema: 'nexyfab.complex-ground-truth-approval-validation.v1',
  summary: { cases: 120, records: 120, approved: 120, pending: 0, invalid: 0, rejected: 0, changesRequested: 0 },
  byFamily: Object.fromEntries(complexFamilies.map(family => [family, { cases: 20, approved: 20 }])),
};
const passing = {
  currentRelease: { branch: 'release/test', head: 'head-1', workingTreeChanges: 0 },
  releaseBaseline: { release: { branch: 'release/test', head: 'head-1', baselineStatus: 'committed', workingTreeChanges: 0, deploymentId: 'd', buildId: 'b', rollbackDeploymentId: 'r', dockerImageDigest: 'sha256:x', railwayIgnore: { missing: [] } } },
  closedBeta: { ok: true, differences: [] }, liveSmoke: { status: 'pass' },
  productionProtectedState: { ok: true }, openscadHttpSmoke: { ok: true }, authenticatedE2E: { ok: true },
  resourceBaseline: { assessment: { currentMaxWithinTarget: true } },
  migrationReceipt: { ok: true }, restoreReceipt: { ok: true },
  syntheticCampaignReceipt: { ok: true, totalGatePasses: 1500 },
  complexHoldoutCases,
  complexGroundTruthValidation,
  complexProductScope: { decision: { broadComplexProductSelfServiceEligible: true, manufacturingReleaseGuaranteed: true } },
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

test('does not trust an old clean baseline after release files become dirty', () => {
  const input = structuredClone(passing);
  input.currentRelease.workingTreeChanges = 1;
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.privateBeta.eligible, false);
  assert.ok(result.privateBeta.blockers.includes('current_release_working_tree_dirty'));
});

test('commercial GA requires the complete complex-product corpus, dual approvals, and manufacturing scope', () => {
  const input = structuredClone(passing);
  input.complexHoldoutCases.pop();
  input.complexGroundTruthValidation.summary.approved = 119;
  input.complexGroundTruthValidation.byFamily.interior.approved = 19;
  input.complexProductScope.decision.broadComplexProductSelfServiceEligible = false;
  input.complexProductScope.decision.manufacturingReleaseGuaranteed = false;
  const result = evaluateCommercializationReadiness(input);
  assert.equal(result.privateBeta.eligible, true);
  assert.equal(result.commercialGa.eligible, false);
  for (const blocker of [
    'complex_holdout_integrity_incomplete',
    'complex_holdout_family_incomplete:interior:19/20',
    'complex_ground_truth_dual_approval_incomplete',
    'complex_product_self_service_not_eligible',
    'complex_manufacturing_release_not_verified',
  ]) assert.ok(result.commercialGa.blockers.includes(blocker), `missing blocker: ${blocker}`);
});
