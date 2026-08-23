import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReferenceUtilizationQueues, validateReferenceUtilizationQueues } from './build-reference-utilization-queues.mjs';

const artifact = (relativePath, lane) => ({ relativePath, lineageId: 'robot-5-dof-1', extension: relativePath.split('.').pop(), sizeBytes: 10, sha256: 'a'.repeat(64), automatedCheck: 'probe', fidelity: 'bounded', roles: ['test'], lane, commercialScoreEligible: false, trainingEligible: false });
const manifest = {
  schema: 'nexyfab.reference-utilization-manifest.v1', policy: { sourceReadOnly: true, sourceBytesCopied: false, trainingUseAllowed: false, commercialScoreRequiresApproval: true },
  summary: { assignedFiles: 5, securityExcludedFiles: 0, discoveredFiles: 5, lineages: 1, byLane: { exact_exchange_regression: 1, native_semantics_review_queue: 1, visual_reference: 1, derived_ir_reuse: 1, catalog_only: 1 }, byExtension: { foo: 1, json: 1, png: 1, sldasm: 1, step: 1 } },
  lineages: [{ lineageId: 'robot-5-dof-1', files: 5, bytes: 50, lanes: ['catalog_only', 'derived_ir_reuse', 'exact_exchange_regression', 'native_semantics_review_queue', 'visual_reference'], formats: ['foo', 'json', 'png', 'sldasm', 'step'] }],
  artifacts: [artifact('a.step', 'exact_exchange_regression'), artifact('b.sldasm', 'native_semantics_review_queue'), artifact('c.png', 'visual_reference'), artifact('result/ir/c.json', 'derived_ir_reuse'), artifact('d.foo', 'catalog_only')],
};

test('queues every assigned artifact exactly once and preserves release boundaries', () => {
  const value = buildReferenceUtilizationQueues(manifest);
  assert.deepEqual(value.summary, { queued: 5, automated: 1, nativeReview: 1, humanContext: 1, derivedReuse: 1, backlog: 1, p0Lineages: 1 });
  assert.equal(value.policy.trainingUseAllowed, false);
  assert.equal(validateReferenceUtilizationQueues(value).ok, true);
});
