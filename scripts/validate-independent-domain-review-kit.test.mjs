import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { validateIndependentDomainReviewKit } from './validate-independent-domain-review-kit.mjs';

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
