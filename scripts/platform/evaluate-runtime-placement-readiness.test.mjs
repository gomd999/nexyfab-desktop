import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateRuntimePlacementReadiness } from './evaluate-runtime-placement-readiness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const policy = JSON.parse(await import('node:fs').then(({ readFileSync }) => readFileSync(path.join(root, 'config/platform/runtime-placement.v1.json'), 'utf8')));

function completeEvidence() {
  return {
    schema: 'nexyfab.runtime-placement-evidence.v1',
    observedFrom: '2026-07-01T00:00:00.000Z',
    observedThrough: '2026-07-31T00:00:00.000Z',
    lastSampleAt: '2026-07-31T00:00:00.000Z',
    unexplainedGaps: 0,
    activeRailwayServices: [...policy.targetDeployments.railway],
    cost: {
      railwayMonthlyUsdBefore: 200,
      railwayMonthlyUsdAfter: 80,
      totalMonthlyUsdAfter: 130
    },
    checks: policy.requiredLiveChecks.map((id, index) => ({ id, status: 'PASS', receipt: `sha256:${index.toString(16).padStart(64, '0')}` }))
  };
}

test('missing live evidence remains HOLD and every required check is NOT_RUN', () => {
  const result = evaluateRuntimePlacementReadiness({ root, readLiveEvidence: false });
  assert.equal(result.status, 'HOLD');
  assert.equal(result.evidenceState, 'NOT_RUN');
  assert.ok(result.claims.every((claim) => claim.state === 'NOT_RUN'));
});

test('all live checks, thirty days, reduced cost, and the Railway allowlist are required for PASS', () => {
  const result = evaluateRuntimePlacementReadiness({ root, evidence: completeEvidence(), now: new Date('2026-07-31T12:00:00.000Z') });
  assert.equal(result.status, 'PASS');
  assert.ok(result.claims.every((claim) => claim.state === 'PASS'));
});

test('an extra Railway workload fails closed even when all receipts claim PASS', () => {
  const evidence = completeEvidence();
  evidence.activeRailwayServices.push('studio-web');
  const result = evaluateRuntimePlacementReadiness({ root, evidence, now: new Date('2026-07-31T12:00:00.000Z') });
  assert.equal(result.status, 'HOLD');
  assert.equal(result.claims.find((claim) => claim.id === 'railway-service-allowlist')?.state, 'FAIL');
  assert.equal(result.claims.find((claim) => claim.id === 'forbidden-railway-targets-retired')?.state, 'FAIL');
});

test('twenty-nine days and a missing recovery receipt cannot be promoted', () => {
  const evidence = completeEvidence();
  evidence.observedThrough = '2026-07-30T00:00:00.000Z';
  evidence.checks = evidence.checks.filter((check) => check.id !== 'postgres-backup-restore');
  const result = evaluateRuntimePlacementReadiness({ root, evidence, now: new Date('2026-07-31T12:00:00.000Z') });
  assert.equal(result.status, 'HOLD');
  assert.equal(result.claims.find((claim) => claim.id === 'observation-window')?.state, 'FAIL');
  assert.equal(result.claims.find((claim) => claim.id === 'postgres-backup-restore')?.state, 'NOT_RUN');
});

test('stale samples, malformed receipt hashes, and duplicate check ids fail closed', () => {
  const evidence = completeEvidence();
  evidence.lastSampleAt = '2026-07-29T00:00:00.000Z';
  evidence.checks[0].receipt = 'not-a-hash';
  evidence.checks.push({ ...evidence.checks[1] });
  const result = evaluateRuntimePlacementReadiness({ root, evidence, now: new Date('2026-07-31T12:00:00.000Z') });
  assert.equal(result.status, 'HOLD');
  assert.equal(result.claims.find((claim) => claim.id === 'latest-sample-freshness')?.state, 'FAIL');
  assert.equal(result.claims.find((claim) => claim.id === policy.requiredLiveChecks[0])?.state, 'FAIL');
  assert.equal(result.claims.find((claim) => claim.id === policy.requiredLiveChecks[1])?.state, 'PASS');
  assert.equal(result.claims.find((claim) => claim.id === 'unique-live-check-receipts')?.state, 'FAIL');
});

test('the checked-in operator template evaluates to HOLD rather than a synthetic PASS', async () => {
  const { readFileSync } = await import('node:fs');
  const template = JSON.parse(readFileSync(path.join(root, 'docs/process/templates/runtime-placement-evidence.v1.template.json'), 'utf8'));
  const result = evaluateRuntimePlacementReadiness({ root, evidence: template, now: new Date('2026-08-13T12:00:00.000Z') });
  assert.equal(result.status, 'HOLD');
  assert.ok(policy.requiredLiveChecks.every((id) => result.claims.find((claim) => claim.id === id)?.state === 'NOT_RUN'));
});
