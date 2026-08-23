import assert from 'node:assert/strict';
import test from 'node:test';
import staging from '../../docs/evidence/platform-runtime/slice-deployment-staging.json' with { type: 'json' };
import evidence from '../../docs/evidence/platform-runtime/slice-rollback-execution.json' with { type: 'json' };
import { evaluateSliceRollbackEvidence } from './verify-slice-rollback-evidence.mjs';

const stagingSha256 = evidence.stagingEvidenceSha256;
const options = { stagingSha256, now: new Date('2026-08-23T16:30:00.000Z') };

test('captured rollback targets are valid but remain explicitly not executed', () => {
  const result = evaluateSliceRollbackEvidence(evidence, staging, options);
  assert.equal(result.ok, true);
  assert.equal(result.state, 'READY_NOT_EXECUTED');
  assert.equal(result.targetCount, 7);
});

test('rollback evidence rejects a target digest that drifts from staging evidence', () => {
  const changed = structuredClone(evidence);
  changed.targets[0].rollbackTarget.imageDigest = `sha256:${'0'.repeat(64)}`;
  const result = evaluateSliceRollbackEvidence(changed, staging, options);
  assert.equal(result.ok, false);
  assert.match(result.issues.join(','), /rollback_target_binding_mismatch/);
});

test('rollback PASS requires both rollback and restore health observations for all services', () => {
  const completed = structuredClone(evidence);
  completed.execution = 'PASS';
  completed.reason = null;
  completed.targets = completed.targets.map(target => ({
    ...target,
    execution: 'PASS',
    rollbackObservation: { ...target.rollbackTarget, health: 'PASS', observedAt: '2026-08-23T16:22:00.000Z' },
    restoreObservation: { ...target.currentDeployment, health: 'PASS', observedAt: '2026-08-23T16:25:00.000Z' },
  }));
  assert.equal(evaluateSliceRollbackEvidence(completed, staging, options).state, 'PASS');
  completed.targets[3].restoreObservation.health = 'HOLD';
  const failed = evaluateSliceRollbackEvidence(completed, staging, options);
  assert.equal(failed.ok, false);
  assert.match(failed.issues.join(','), /restore_observation.*health_not_passed/);
});
