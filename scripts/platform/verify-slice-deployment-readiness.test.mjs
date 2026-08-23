import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../../config/platform/slice-deployment.v1.json' with { type: 'json' };
import stagingEvidence from '../../docs/evidence/platform-runtime/slice-deployment-staging.json' with { type: 'json' };
import { evaluateSliceDeploymentReadiness, evaluateStagingEvidence } from './verify-slice-deployment-readiness.mjs';

test('all three slices have local build, health, and rollback declarations', () => {
  const result = evaluateSliceDeploymentReadiness(manifest);
  assert.equal(result.ok, true);
  assert.equal(result.slices.length, 3);
  assert.ok(result.slices.every(slice => slice.status === 'READY_FOR_STAGING'));
});

test('readiness remains fail-closed when a source is missing', () => {
  const result = evaluateSliceDeploymentReadiness({ ...manifest, slices: [{ ...manifest.slices[0], sourceRoots: ['missing.ts'] }] });
  assert.equal(result.ok, false);
  assert.match(result.slices[0].issues[0], /source_missing/);
});

test('live staging evidence binds seven successful runtime services and rollback targets', () => {
  const result = evaluateStagingEvidence(stagingEvidence, manifest);
  assert.equal(result.ok, true);
  assert.equal(result.state, 'PASS_WITH_HOLDS');
  assert.equal(result.scopes.length, 3);
});

test('staging evidence fails closed when an image digest is not immutable', () => {
  const evidence = structuredClone(stagingEvidence);
  evidence.scopes[0].services[0].imageDigest = 'latest';
  const result = evaluateStagingEvidence(evidence, manifest);
  assert.equal(result.ok, false);
  assert.match(result.issues.join(','), /deployment_digest_invalid/);
});
