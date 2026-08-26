import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import staging from '../../docs/evidence/platform-runtime/slice-deployment-staging.json' with { type: 'json' };
import evidence from '../../docs/evidence/platform-runtime/slice-rollback-execution.json' with { type: 'json' };
import {
  STAGING_EVIDENCE_CANONICALIZATION,
  evaluateSliceRollbackEvidence,
  sha256File,
} from './verify-slice-rollback-evidence.mjs';

const stagingSha256 = evidence.stagingEvidenceSha256;
const options = { stagingSha256, now: new Date('2026-08-23T16:30:00.000Z') };

test('captured rollback targets are valid but remain explicitly not executed', () => {
  const result = evaluateSliceRollbackEvidence(evidence, staging, options);
  assert.equal(result.ok, true);
  assert.equal(result.state, 'READY_NOT_EXECUTED');
  assert.equal(result.targetCount, 7);
});

test('staging evidence hash is portable across LF and CRLF checkouts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-slice-rollback-'));
  try {
    const lf = path.join(root, 'lf.json');
    const crlf = path.join(root, 'crlf.json');
    fs.writeFileSync(lf, '{\n  "status": "PASS"\n}\n');
    fs.writeFileSync(crlf, '{\r\n  "status": "PASS"\r\n}\r\n');
    assert.equal(sha256File(lf), sha256File(crlf));
    assert.equal(evidence.stagingEvidenceCanonicalization, STAGING_EVIDENCE_CANONICALIZATION);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rollback evidence rejects an undeclared or broadened text binding policy', () => {
  const changed = structuredClone(evidence);
  delete changed.stagingEvidenceCanonicalization;
  assert.ok(evaluateSliceRollbackEvidence(changed, staging, options).issues.includes('rollback_staging_canonicalization_invalid'));
  changed.stagingEvidenceCanonicalization = 'raw';
  assert.ok(evaluateSliceRollbackEvidence(changed, staging, options).issues.includes('rollback_staging_canonicalization_invalid'));
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
