import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyReferenceArtifact, isSecretLikePath, referenceLineage } from './reference-utilization-policy.mjs';

test('routes every important corpus format without granting training or commercial truth', () => {
  const cases = {
    'arm/assembly.STEP': 'exact_exchange_regression',
    'arm/body.x_t': 'governed_automated_regression',
    'arm/body.IGES': 'bounded_geometry_regression',
    'arm/assembly.SLDASM': 'native_semantics_review_queue',
    'arm/drawing.png': 'visual_reference',
    'arm/manual.pdf': 'document_reference',
    'arm/source.zip': 'archive_lineage_container',
    'result/ir/step/arm.json': 'derived_ir_reuse',
    'arm/setup.exe': 'security_quarantine',
    'arm/unknown.foo': 'catalog_only',
  };
  for (const [file, lane] of Object.entries(cases)) {
    const result = classifyReferenceArtifact(file);
    assert.equal(result.lane, lane, file);
    assert.equal(result.trainingEligible, false, file);
    assert.equal(result.commercialScoreEligible, false, file);
    assert.ok(result.roles.length > 0, file);
  }
});
test('keeps snapshot members in one product lineage', () => {
  assert.equal(referenceLineage('set/robot-5-dof-1.snapshot.2/a.iam'), 'robot-5-dof-1');
  assert.equal(referenceLineage('set/robot-5-dof-1.snapshot.2.zip'), 'robot-5-dof-1');
});

test('excludes secret-like paths without revealing them in the artifact manifest', () => {
  assert.equal(isSecretLikePath('product/.env'), true);
  assert.equal(isSecretLikePath('product/private.pem'), true);
  assert.equal(isSecretLikePath('product/model.step'), false);
});
