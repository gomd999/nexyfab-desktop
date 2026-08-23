import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../../config/platform/slice-deployment.v1.json' with { type: 'json' };
import localRuntimeEvidence from '../../docs/evidence/platform-runtime/slice-local-runtime.json' with { type: 'json' };
import stagingEvidence from '../../docs/evidence/platform-runtime/slice-deployment-staging.json' with { type: 'json' };
import { evaluateLocalRuntimeEvidence, evaluateSliceDeploymentReadiness, evaluateStagingEvidence } from './verify-slice-deployment-readiness.mjs';

const evidenceNow = new Date('2026-08-23T16:30:00.000Z');
const contextFingerprints = Object.fromEntries(localRuntimeEvidence.slices.map(slice => [slice.scope, {
  sha256: slice.sourceTreeSha256,
  fileCount: slice.sourceFileCount,
}]));
const localOptions = { now: evidenceNow, contextFingerprints, requireCurrentSource: true };

test('all three slices have local build, health, and rollback declarations', () => {
  const result = evaluateSliceDeploymentReadiness(manifest);
  assert.equal(result.ok, true);
  assert.equal(result.slices.length, 3);
  assert.ok(result.slices.every(slice => slice.status === 'ISOLATED_CONTEXT_READY'));
});

test('readiness remains fail-closed when a source is missing', () => {
  const result = evaluateSliceDeploymentReadiness({ ...manifest, slices: [{ ...manifest.slices[0], sourceRoots: ['missing.ts'] }] });
  assert.equal(result.ok, false);
  assert.match(result.slices[0].issues[0], /source_missing/);
});

test('readiness rejects a repository-root compatibility build', () => {
  const changed = structuredClone(manifest);
  changed.slices[0].build = { contextRoot: '.', dockerfile: 'Dockerfile', mode: 'shared-monorepo-compatibility' };
  const result = evaluateSliceDeploymentReadiness(changed);
  assert.equal(result.ok, false);
  assert.match(result.slices[0].issues.join(','), /repository_root_build_context_forbidden/);
});

test('all three local images bind source commits and healthy containers', () => {
  const result = evaluateLocalRuntimeEvidence(localRuntimeEvidence, manifest, localOptions);
  assert.equal(result.ok, true);
  assert.equal(result.state, 'PASS_WITH_RELEASE_HOLDS');
  assert.equal(result.slices.length, 3);
});

test('local runtime evidence fails closed when release health is promoted', () => {
  const evidence = structuredClone(localRuntimeEvidence);
  evidence.slices[0].health.release = { statusCode: 200, state: 'PASS' };
  const result = evaluateLocalRuntimeEvidence(evidence, manifest, localOptions);
  assert.equal(result.ok, false);
  assert.match(result.issues.join(','), /local_runtime_release_must_hold/);
});

test('local runtime evidence fails closed when current source tree changes', () => {
  const changedFingerprints = structuredClone(contextFingerprints);
  changedFingerprints['precision-cad'].sha256 = '0'.repeat(64);
  const result = evaluateLocalRuntimeEvidence(localRuntimeEvidence, manifest, {
    ...localOptions,
    contextFingerprints: changedFingerprints,
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.join(','), /local_runtime_source_tree_mismatch:precision-cad/);
});

test('local runtime evidence expires after the declared freshness window', () => {
  const result = evaluateLocalRuntimeEvidence(localRuntimeEvidence, manifest, {
    ...localOptions,
    now: new Date('2026-09-01T00:00:00.000Z'),
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.join(','), /local_runtime_evidence_stale/);
});

test('live staging evidence binds seven successful runtime services and rollback targets', () => {
  const result = evaluateStagingEvidence(stagingEvidence, manifest, { now: evidenceNow });
  assert.equal(result.ok, true);
  assert.equal(result.state, 'PASS_WITH_HOLDS');
  assert.equal(result.scopes.length, 3);
});

test('staging evidence fails closed when an image digest is not immutable', () => {
  const evidence = structuredClone(stagingEvidence);
  evidence.scopes[0].services[0].imageDigest = 'latest';
  const result = evaluateStagingEvidence(evidence, manifest, { now: evidenceNow });
  assert.equal(result.ok, false);
  assert.match(result.issues.join(','), /deployment_digest_invalid/);
});
